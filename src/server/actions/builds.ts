'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { getBranchInfo } from '@/lib/github/content';
import { getBranchInfo as getGitLabBranchInfo } from '@/lib/gitlab/content';
import { getOpenPRsForBranch } from '@/lib/github/oauth';
import { getOpenMRsForBranch } from '@/lib/gitlab/oauth';
import { getRunner } from '@/lib/playwright/runner';
import { getServerManager } from '@/lib/playwright/server-manager';
import { getSetupOrchestrator } from '@/lib/setup/setup-orchestrator';
import type { SetupContext } from '@/lib/setup/types';
import { executeTests } from '@/lib/execution/executor';
import { resolveSetupCodeForRunner } from '@/lib/execution/setup-capture';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { generateDiff, generateTextAwareDiffFromPaths, type Rectangle } from '@/lib/diff/generator';
import { hashImage, hashImageWithDimensions } from '@/lib/diff/hasher';
import { PNG } from 'pngjs';
import fs from 'fs';
import { sendSlackNotification } from '@/lib/integrations/slack';
import { sendDiscordNotification } from '@/lib/integrations/discord';
import { sendCustomWebhookNotification } from '@/lib/integrations/custom-webhook';
import { postPRComment } from '@/lib/integrations/github-pr';
import { postMRComment } from '@/lib/integrations/gitlab-mr';
import type { Test, TriggerType, BuildStatus, VisualDiffWithTestStatus, DiffClassification, DiffStatus } from '@/lib/db/schema';
import path from 'path';
import { createJob, createPendingJob, startJob, updateJobProgress, completeJob, failJob } from './jobs';
import { triggerAIDiffAnalysis } from './ai-diffs';
import { forkBaselinesForBranch } from './baselines';
import { STORAGE_DIRS, STORAGE_ROOT, toRelativePath } from '@/lib/storage/paths';
import { compareBranches } from '@/lib/github/content';
import { findAffectedTests } from '@/lib/smart-selection/file-matcher';

interface GitInfo {
  branch: string;
  commit: string;
}

async function getGitInfoFromProvider(repositoryId: string | null): Promise<GitInfo> {
  if (!repositoryId) {
    return { branch: 'unknown', commit: 'unknown' };
  }

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    return { branch: 'unknown', commit: 'unknown' };
  }

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';

  if (repo.provider === 'gitlab') {
    // Fetch from GitLab (team-scoped)
    const account = repo.teamId ? await queries.getGitlabAccountByTeam(repo.teamId) : null;
    if (!account || !repo.gitlabProjectId) {
      return { branch, commit: 'unknown' };
    }

    const branchInfo = await getGitLabBranchInfo(account.accessToken, repo.gitlabProjectId, branch, account.instanceUrl || undefined);
    if (!branchInfo) {
      return { branch, commit: 'unknown' };
    }

    return {
      branch: branchInfo.name,
      commit: branchInfo.commit.id.slice(0, 7),
    };
  } else {
    // Fetch from GitHub (team-scoped)
    const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
    if (!account) {
      return { branch, commit: 'unknown' };
    }

    const branchInfo = await getBranchInfo(account.accessToken, repo.owner, repo.name, branch);
    if (!branchInfo) {
      return { branch, commit: 'unknown' };
    }

    return {
      branch: branchInfo.name,
      commit: branchInfo.commit.sha.slice(0, 7),
    };
  }
}

// Alias for backwards compatibility
async function getGitInfoFromGitHub(repositoryId: string | null): Promise<GitInfo> {
  return getGitInfoFromProvider(repositoryId);
}

/**
 * Compute which tests are affected by code changes on this branch vs default branch.
 * Stores the test IDs on the build record. Non-blocking — callers should catch errors.
 */
async function computeCodeChangeTestIds(
  buildId: string,
  repo: { provider: string; teamId: string | null; owner: string; name: string; defaultBranch: string | null } | null | undefined,
  branch: string,
  repositoryId: string | null | undefined,
) {
  if (!repo || !repositoryId) return;
  if (repo.provider !== 'github') return;
  const defaultBranch = repo.defaultBranch || 'main';
  if (branch === defaultBranch) return;

  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account) return;

  const comparison = await compareBranches(account.accessToken, repo.owner, repo.name, defaultBranch, branch);
  if (!comparison || comparison.files.length === 0) return;

  const changedFiles = comparison.files.map(f => f.filename);
  const affected = await findAffectedTests(changedFiles, repositoryId);
  if (affected.length === 0) return;

  await queries.updateBuild(buildId, {
    codeChangeTestIds: affected.map(a => a.testId),
  });
}

const DIFFS_DIR = STORAGE_DIRS.diffs;

export interface BuildSummary {
  id: string;
  overallStatus: BuildStatus;
  totalTests: number;
  changesDetected: number;
  flakyCount: number;
  failedCount: number;
  passedCount: number;
  elapsedMs: number | null;
  createdAt: Date | null;
  completedAt: Date | null;
  gitBranch: string;
  gitCommit: string;
  pullRequestId: string | null;
  comparisonMode: string | null;
  codeChangeTestIds: string[] | null;
  isMainBranch: boolean;
  diffs: VisualDiffWithTestStatus[];
}

/**
 * Force reset the test runner if stuck in "running" state
 */
export async function forceResetRunner(repositoryId?: string | null) {
  const runner = getRunner(repositoryId);
  await runner.forceReset();
  return { success: true };
}

/**
 * Create and run a new build (queues if tests already running)
 */
export async function createAndRunBuild(
  triggerType: TriggerType = 'manual',
  testIds?: string[],
  repositoryId?: string | null,
  runnerId?: string,
  versionOverrides?: Record<string, string>,
) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  const runner = getRunner(repositoryId);

  // If tests are running, queue this build
  if (runner.isActive()) {
    return queueBuild(triggerType, testIds, repositoryId);
  }

  // Load and set environment config
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  if (envConfig && envConfig.id) {
    runner.setEnvironmentConfig(envConfig);
    const serverManager = getServerManager();
    serverManager.setConfig(envConfig);
  }

  // Load and set playwright settings (viewport, browser, timeouts, etc.)
  const playwrightSettings = await queries.getPlaywrightSettings(repositoryId);
  if (playwrightSettings) {
    runner.setSettings(playwrightSettings);
  }

  // Get tests to run (filter out soft-deleted tests)
  let tests: Test[];
  if (testIds && testIds.length > 0) {
    tests = await Promise.all(
      testIds.map((id) => queries.getTest(id))
    ).then((results) => results.filter((t): t is Test => t !== undefined && !t.deletedAt));
  } else if (repositoryId) {
    tests = await queries.getTestsByRepo(repositoryId);
  } else {
    tests = [];
  }

  if (tests.length === 0) {
    throw new Error('No tests to run');
  }

  // Get repo for git info via GitHub API
  const repo = repositoryId ? await queries.getRepository(repositoryId) : null;
  const gitInfo = await getGitInfoFromGitHub(repositoryId ?? repo?.id ?? null);

  // Create test run
  const testRun = await queries.createTestRun({
    repositoryId: repositoryId ?? repo?.id,
    gitBranch: gitInfo.branch,
    gitCommit: gitInfo.commit,
    startedAt: new Date(),
    status: 'running',
  });

  // Create build
  const build = await queries.createBuild({
    testRunId: testRun.id,
    triggerType,
    overallStatus: 'review_required',
    totalTests: tests.length,
    changesDetected: 0,
    flakyCount: 0,
    failedCount: 0,
    passedCount: 0,
    baseUrl: envConfig?.baseUrl || 'http://localhost:3000',
    comparisonMode: 'vs_both',
  });

  // Try to link to existing PR
  const pr = await queries.getPullRequestByBranch(gitInfo.branch);
  if (pr) {
    await queries.updateBuild(build.id, { pullRequestId: pr.id });
  }

  // Run tests async
  runBuildAsync(build.id, testRun.id, tests, gitInfo.branch, repositoryId, runnerId, versionOverrides);

  // Fire-and-forget: compute code-change affected test IDs
  computeCodeChangeTestIds(build.id, repo, gitInfo.branch, repositoryId).catch(() => {});

  return { buildId: build.id, testRunId: testRun.id, testCount: tests.length };
}

/**
 * Create and run a build from CI (token-authenticated, no session required).
 * Auth is handled by the API route via runner token validation.
 */
export async function createAndRunBuildFromCI(opts: {
  triggerType: TriggerType;
  repositoryId: string;
  runnerId: string;
  gitBranch?: string;
  gitCommit?: string;
}) {
  const { triggerType, repositoryId, runnerId, gitBranch, gitCommit } = opts;
  const runner = getRunner(repositoryId);

  // If tests are running, queue this build
  if (runner.isActive()) {
    return queueBuild(triggerType, undefined, repositoryId);
  }

  // Load and set environment config
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  if (envConfig && envConfig.id) {
    runner.setEnvironmentConfig(envConfig);
    const serverManager = getServerManager();
    serverManager.setConfig(envConfig);
  }

  // Load and set playwright settings
  const playwrightSettings = await queries.getPlaywrightSettings(repositoryId);
  if (playwrightSettings) {
    runner.setSettings(playwrightSettings);
  }

  // Get tests to run (filter out soft-deleted)
  const tests = await queries.getTestsByRepo(repositoryId);
  if (tests.length === 0) {
    throw new Error('No tests to run');
  }

  // Use git info from CI if provided, otherwise fetch from provider
  const gitInfo: GitInfo = (gitBranch || gitCommit)
    ? { branch: gitBranch || 'unknown', commit: gitCommit?.slice(0, 7) || 'unknown' }
    : await getGitInfoFromProvider(repositoryId);

  // Create test run
  const testRun = await queries.createTestRun({
    repositoryId,
    gitBranch: gitInfo.branch,
    gitCommit: gitInfo.commit,
    startedAt: new Date(),
    status: 'running',
  });

  // Create build
  const build = await queries.createBuild({
    testRunId: testRun.id,
    triggerType,
    overallStatus: 'review_required',
    totalTests: tests.length,
    changesDetected: 0,
    flakyCount: 0,
    failedCount: 0,
    passedCount: 0,
    baseUrl: envConfig?.baseUrl || 'http://localhost:3000',
    comparisonMode: 'vs_both',
  });

  // Try to link to existing PR
  const pr = await queries.getPullRequestByBranch(gitInfo.branch);
  if (pr) {
    await queries.updateBuild(build.id, { pullRequestId: pr.id });
  }

  // Run tests async
  runBuildAsync(build.id, testRun.id, tests, gitInfo.branch, repositoryId, runnerId);

  // Fire-and-forget: compute code-change affected test IDs
  const ciRepo = await queries.getRepository(repositoryId);
  computeCodeChangeTestIds(build.id, ciRepo, gitInfo.branch, repositoryId).catch(() => {});

  return { buildId: build.id, testRunId: testRun.id, testCount: tests.length };
}

/**
 * Internal async build runner
 */
async function runBuildAsync(
  buildId: string,
  testRunId: string,
  tests: Test[],
  branch: string,
  repositoryId?: string | null,
  runnerId?: string,
  versionOverrides?: Record<string, string>,
) {
  const runner = getRunner(repositoryId);
  const startTime = Date.now();
  const jobId = await createJob('build_run', `Build (${tests.length} tests)`, tests.length, repositoryId, { buildId, testRunId });

  // Auto-fork baselines for branch builds
  if (repositoryId) {
    const repo = await queries.getRepository(repositoryId);
    const defaultBranch = repo?.defaultBranch || 'main';
    if (branch !== defaultBranch) {
      try {
        const { forked, skipped } = await forkBaselinesForBranch(repositoryId, defaultBranch, branch);
        if (forked > 0) {
          console.log(`[build] Auto-forked ${forked} baselines from ${defaultBranch} → ${branch}`);
        } else if (skipped) {
          console.log(`[build] Branch ${branch} already has baselines, skipping fork`);
        }
      } catch (error) {
        console.error('[build] Auto-fork failed:', error);
      }
    }
  }

  // Apply version overrides — swap test code with specific version's code
  const versionIdMap = new Map<string, string>(); // testId -> testVersionId
  if (versionOverrides) {
    for (const test of tests) {
      const versionId = versionOverrides[test.id];
      if (versionId) {
        const version = await queries.getTestVersionById(versionId);
        if (version) {
          test.code = version.code;
          if (version.name) test.name = version.name;
          if (version.targetUrl) test.targetUrl = version.targetUrl;
          versionIdMap.set(test.id, versionId);
        }
      }
    }
  }

  // Populate versionIdMap for non-overridden tests (latest version)
  for (const test of tests) {
    if (!versionIdMap.has(test.id)) {
      const versions = await queries.getTestVersions(test.id);
      if (versions.length > 0) {
        versionIdMap.set(test.id, versions[0].id);
      }
    }
  }

  // Get gitCommit from testRun for first-build stamping
  const testRun = await queries.getTestRun(testRunId);
  const gitCommit = testRun?.gitCommit ?? null;

  let passedCount = 0;
  let failedCount = 0;
  let changesDetected = 0;
  let flakyCount = 0;
  let processedCount = 0;

  // Get teamId from runner record (not session — session is unavailable in fire-and-forget context)
  let teamId: string | undefined;
  if (runnerId && runnerId !== 'local') {
    const runnerRecord = await queries.getRunnerById(runnerId);
    teamId = runnerRecord?.teamId;
  }

  // Prepare environment and settings for executor
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  const playwrightSettings = await queries.getPlaywrightSettings(repositoryId);

  // Result callback for processing diffs
  const onResult = async (result: { testId: string; status: string; screenshotPath?: string; screenshots: { path: string; label?: string }[]; errorMessage?: string; durationMs?: number; a11yViolations?: { id: string; impact: 'critical' | 'serious' | 'moderate' | 'minor'; description: string; help: string; helpUrl: string; nodes: number }[]; stabilityMetadata?: { frameCount: number; stableFrames: number; maxFrameDiff: number; isStable: boolean }; videoPath?: string; softErrors?: string[] }) => {
    processedCount++;

    // Save test result immediately
    const testResult = await queries.createTestResult({
      testRunId,
      testId: result.testId,
      testVersionId: versionIdMap.get(result.testId) ?? null,
      status: result.status,
      screenshotPath: result.screenshotPath,
      screenshots: result.screenshots,
      errorMessage: result.errorMessage,
      durationMs: result.durationMs,
      viewport: '1280x720',
      browser: 'chromium',
      a11yViolations: result.a11yViolations,
      videoPath: result.videoPath,
      softErrors: result.softErrors,
    });

    // Stamp first build on the test version (idempotent)
    const versionId = versionIdMap.get(result.testId);
    if (versionId) {
      await queries.stampFirstBuild(versionId, buildId, branch, gitCommit);
    }

    if (result.status === 'passed') passedCount++;
    else if (result.status === 'failed' || result.status === 'setup_failed') failedCount++;

    // Build screenshots list: prefer captured screenshots, fall back to single screenshotPath
    const screenshots = result.screenshots.length > 0
      ? result.screenshots
      : result.screenshotPath
        ? [{ path: result.screenshotPath, label: 'final' }]
        : [];

    // Generate visual diff for each screenshot
    for (const screenshot of screenshots) {
      const diffResult = await processVisualDiff(
        buildId,
        testResult.id,
        result.testId,
        screenshot.path,
        branch,
        repositoryId,
        screenshot.label,
        result.stabilityMetadata?.isStable === false
      );
      if (diffResult.classification === 'changed') changesDetected++;
      if (diffResult.classification === 'flaky') flakyCount++;

      // Fire-and-forget AI diff analysis for non-unchanged diffs
      if (diffResult.classification !== 'unchanged') {
        triggerAIDiffAnalysis(diffResult.diffId, repositoryId, jobId).catch(console.error);
      }
    }

    // Create placeholder diff for failed tests with no screenshots
    if (screenshots.length === 0 && (result.status === 'failed' || result.status === 'setup_failed')) {
      await queries.createVisualDiff({
        buildId,
        testResultId: testResult.id,
        testId: result.testId,
        stepLabel: null,
        currentImagePath: null,
        status: 'auto_approved',
        classification: 'unchanged',
        pixelDifference: 0,
        percentageDifference: '0',
        metadata: { changedRegions: [] },
      });
    }

    // Update build progress incrementally
    await updateJobProgress(jobId, processedCount, tests.length);
    await queries.updateBuild(buildId, {
      passedCount,
      failedCount,
      changesDetected,
      flakyCount,
    });
  };

  // Progress callback for parallel execution tracking
  const onProgress = async (progress: { completed: number; total: number; activeCount?: number; activeTests?: string[] }) => {
    await updateJobProgress(jobId, progress.completed, progress.total, {
      activeCount: progress.activeCount,
      activeTests: progress.activeTests,
    });
  };

  try {
    // Configure runner with environment and settings
    if (envConfig?.id) {
      runner.setEnvironmentConfig(envConfig);
      getServerManager().setConfig(envConfig);
    }
    if (playwrightSettings) {
      runner.setSettings(playwrightSettings);
    }

    // Get the build to check for build-level setup
    const build = await queries.getBuild(buildId);
    const baseUrl = envConfig?.baseUrl || 'http://localhost:3000';

    // Initialize setup context
    const setupContext: SetupContext = {
      baseUrl,
      variables: {},
      repositoryId: repositoryId || null,
    };

    // Resolve setup info for remote runner (run setup on the runner, not locally)
    let remoteSetupInfo: { code: string; setupId: string } | undefined;
    const isRemoteRunner = runnerId && runnerId !== 'local' && teamId;

    // Run build-level setup if configured
    if (build?.buildSetupTestId || build?.buildSetupScriptId) {
      if (isRemoteRunner) {
        // Remote runner: resolve setup code locally, but execute it on the runner
        await queries.updateBuild(buildId, { setupStatus: 'running' });

        if (build.buildSetupTestId) {
          const setupTest = await queries.getTest(build.buildSetupTestId);
          if (setupTest) {
            remoteSetupInfo = { code: setupTest.code, setupId: setupTest.id };
          } else {
            console.warn(`[build-setup] Setup test not found: ${build.buildSetupTestId} - skipping`);
          }
        } else if (build.buildSetupScriptId) {
          const setupScript = await queries.getSetupScript(build.buildSetupScriptId);
          if (setupScript && setupScript.type === 'playwright') {
            remoteSetupInfo = { code: setupScript.code, setupId: setupScript.id };
          } else {
            console.warn(`[build-setup] Setup script not found or not playwright type: ${build.buildSetupScriptId} - skipping`);
          }
        }

        if (!remoteSetupInfo) {
          // No valid setup code found, mark as skipped
          await queries.updateBuild(buildId, { setupStatus: 'skipped' });
        }
        // setupStatus will be updated after executor runs setup on the runner
      } else {
        // Local runner: run setup locally with a browser
        await queries.updateBuild(buildId, { setupStatus: 'running' });

        const orchestrator = getSetupOrchestrator();
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        try {
          setupContext.page = page;
          const setupResult = await orchestrator.resolveAndRunSetup(
            build.buildSetupTestId,
            build.buildSetupScriptId,
            page,
            setupContext
          );

          if (!setupResult.success) {
            await queries.updateBuild(buildId, {
              setupStatus: 'failed',
              setupError: setupResult.error,
              setupDurationMs: setupResult.duration,
            });
            throw new Error(`Build setup failed: ${setupResult.error}`);
          }

          if (setupResult.variables) {
            setupContext.variables = { ...setupContext.variables, ...setupResult.variables };
          }

          try {
            const state = await page.context().storageState();
            setupContext.storageState = JSON.stringify(state);
            console.log(`[build-setup] Captured storageState: ${state.cookies.length} cookies, ${state.origins.length} origins`);
          } catch (e) {
            console.warn('[build-setup] Failed to capture storageState:', e);
          }

          await queries.updateBuild(buildId, {
            setupStatus: 'completed',
            setupDurationMs: setupResult.duration,
          });
        } finally {
          await page.close().catch(() => {});
          await browser.close().catch(() => {});
        }
      }
    } else {
      await queries.updateBuild(buildId, { setupStatus: 'skipped' });
    }

    // Remove page from context (each test gets its own)
    delete setupContext.page;

    // Set the setup context on the runner so tests can access it
    runner.setSetupContext(setupContext);

    // Use executor for agent routing, or direct runner for local
    if (isRemoteRunner) {
      // Load runner's maxParallelTests setting
      const remoteRunner = await queries.getRunnerById(runnerId!);
      const maxParallelTests = remoteRunner?.maxParallelTests ?? 1;

      // If no build-level setup, resolve per-test setup code to run on the runner
      // (don't run locally — cookies from a different server instance would be invalid)
      if (!remoteSetupInfo) {
        const resolved = await resolveSetupCodeForRunner(tests);
        if (resolved) {
          remoteSetupInfo = resolved;
          await queries.updateBuild(buildId, { setupStatus: 'running' });
          console.log(`[build] Resolved per-test setup for remote runner: setupId=${resolved.setupId}`);
        }
      }

      try {
        await executeTests(tests, testRunId, {
          repositoryId,
          teamId,
          runnerId,
          environmentConfig: envConfig,
          playwrightSettings,
          maxParallelTests,
          jobId,
          setupInfo: remoteSetupInfo,
          setupContext: {
            storageState: setupContext.storageState,
            variables: setupContext.variables,
          },
        }, onProgress, onResult);

        // If remote setup was used, mark it completed now
        if (remoteSetupInfo) {
          await queries.updateBuild(buildId, { setupStatus: 'completed' });
        }
      } catch (error) {
        // If setup failed on the runner, mark it
        if (remoteSetupInfo && error instanceof Error && error.message.includes('setup')) {
          await queries.updateBuild(buildId, {
            setupStatus: 'failed',
            setupError: error.message,
          });
        }
        throw error;
      }
    } else {
      // Local uses maxParallelTests from playwrightSettings (set via runner.setSettings)
      await runner.runTests(tests, testRunId, onProgress, onResult);
    }

    // Clear setup context after tests complete
    runner.clearSetupContext();

    // Check if this build was cancelled while running
    const currentJob = await queries.getBackgroundJob(jobId);
    if (currentJob?.error === 'Cancelled by user') {
      revalidatePath('/builds');
      revalidatePath('/');
      processNextQueuedBuild(repositoryId);
      return;
    }

    // Update test run status
    const hasFailures = failedCount > 0;
    await queries.updateTestRun(testRunId, {
      completedAt: new Date(),
      status: hasFailures ? 'failed' : 'passed',
    });

    // Update build final metrics and status
    const overallStatus = await queries.computeBuildStatus(buildId);
    await queries.updateBuild(buildId, {
      passedCount,
      failedCount,
      changesDetected,
      flakyCount,
      overallStatus,
      elapsedMs: Date.now() - startTime,
      completedAt: new Date(),
    });
    await completeJob(jobId);

    // Send notifications after build completion
    await sendBuildNotifications({
      buildId,
      status: overallStatus,
      totalTests: tests.length,
      passedCount,
      changesDetected,
      flakyCount,
      failedCount,
      gitBranch: branch,
      repositoryId,
    });
  } catch (error) {
    // Check if this build was cancelled while running — don't overwrite cancelJob's statuses
    const currentJob = await queries.getBackgroundJob(jobId);
    if (currentJob?.error === 'Cancelled by user') {
      runner.clearSetupContext();
    } else {
      await queries.updateTestRun(testRunId, {
        completedAt: new Date(),
        status: 'failed',
      });
      await queries.updateBuild(buildId, {
        overallStatus: 'blocked',
        completedAt: new Date(),
        elapsedMs: Date.now() - startTime,
      });
      await failJob(jobId, error instanceof Error ? error.message : 'Build failed');
      // Clear setup context on error to prevent stale state leaking to future runs
      runner.clearSetupContext();
    }
  }

  revalidatePath('/builds');
  revalidatePath('/');

  // Process next queued build if any
  processNextQueuedBuild(repositoryId);
}

/**
 * Queue a build for later execution
 */
async function queueBuild(
  triggerType: TriggerType = 'manual',
  testIds?: string[],
  repositoryId?: string | null
) {
  // Get tests to determine label (filter out soft-deleted tests)
  let tests: Test[];
  if (testIds && testIds.length > 0) {
    tests = await Promise.all(
      testIds.map((id) => queries.getTest(id))
    ).then((results) => results.filter((t): t is Test => t !== undefined && !t.deletedAt));
  } else if (repositoryId) {
    tests = await queries.getTestsByRepo(repositoryId);
  } else {
    tests = await queries.getTests();
  }

  if (tests.length === 0) {
    throw new Error('No tests to run');
  }

  // Create a pending job
  const jobId = await createPendingJob(
    'build_run',
    `Queued Build (${tests.length} tests)`,
    tests.length,
    repositoryId,
    { triggerType, testIds: testIds || null }
  );

  return {
    buildId: null,
    testRunId: null,
    testCount: tests.length,
    queued: true,
    jobId
  };
}

/**
 * Process the next queued build if any
 */
export async function processNextQueuedBuild(repositoryId?: string | null) {
  const runner = getRunner(repositoryId);

  // Don't process if runner is still active
  if (runner.isActive()) return;

  // Get pending builds
  const pendingJobs = await queries.getPendingBuildJobs(repositoryId);
  if (pendingJobs.length === 0) return;

  const nextJob = pendingJobs[0];
  const metadata = nextJob.metadata as { triggerType?: TriggerType; testIds?: string[] | null } | null;

  // Start the job
  await startJob(nextJob.id);

  // Run the build
  try {
    await createAndRunBuild(
      metadata?.triggerType || 'manual',
      metadata?.testIds || undefined,
      nextJob.repositoryId
    );
  } catch (error) {
    // Job failed to start, mark as failed
    await queries.updateBackgroundJob(nextJob.id, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Failed to start build',
      completedAt: new Date(),
    });
  }
}

/**
 * Process visual diff for a test result.
 * Always compares against all available baselines:
 * - Primary diff: branch baseline (with fallback to main)
 * - Secondary diff: main baseline (skipped when on main branch)
 * - Planned diff: planned/design screenshot (if exists)
 */
async function processVisualDiff(
  buildId: string,
  testResultId: string,
  testId: string,
  currentScreenshotPath: string,
  branch: string,
  repositoryId?: string | null,
  stepLabel?: string,
  isUnstable?: boolean,
): Promise<{ hasChanges: boolean; diffId: string; classification: DiffClassification }> {

  // Get diff sensitivity settings
  const settings = await queries.getDiffSensitivitySettings(repositoryId);
  const unchangedThreshold = settings.unchangedThreshold ?? 1;
  const flakyThreshold = settings.flakyThreshold ?? 10;
  const includeAntiAliasing = settings.includeAntiAliasing ?? false;
  const ignorePageShift = settings.ignorePageShift ?? false;
  const diffEngine = (settings.diffEngine as import('@/lib/db/schema').DiffEngineType) ?? 'pixelmatch';
  const textRegionAwareDiffing = settings.textRegionAwareDiffing ?? false;
  const regionDetectionMode = (settings.regionDetectionMode as import('@/lib/db/schema').RegionDetectionMode) ?? 'grid';

  // Get the repo's default branch
  const repo = repositoryId ? await queries.getRepository(repositoryId) : null;
  const defaultBranch = repo?.defaultBranch || 'main';
  const shouldAutoApprove = repo?.autoApproveDefaultBranch && branch === defaultBranch;

  // Fetch ignore regions for this test
  const testIgnoreRegions = await queries.getIgnoreRegions(testId);
  const ignoreRects: Rectangle[] | undefined = testIgnoreRegions.length > 0
    ? testIgnoreRegions.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
    : undefined;

  // Helper to classify based on percentage
  const classifyDiff = (pct: number): { classification: DiffClassification; status: DiffStatus } => {
    const effectiveFlakyThreshold = isUnstable ? Math.max(flakyThreshold, pct + 1) : flakyThreshold;

    if (pct < unchangedThreshold) {
      if (isUnstable) {
        return { classification: 'flaky', status: 'pending' };
      }
      return { classification: 'unchanged', status: 'auto_approved' };
    } else if (pct < effectiveFlakyThreshold) {
      return { classification: 'flaky', status: 'pending' };
    } else {
      return { classification: 'changed', status: 'pending' };
    }
  };

  // Resolve primary baseline — branch-specific only, no fallback to main
  const baseline = await queries.getBranchBaseline(testId, stepLabel, branch);

  // Check for carry-forward (previously approved identical image)
  // Try dimension-aware hash first, fall back to legacy hash for old baselines
  const currentImageFullPath = path.join(STORAGE_ROOT, currentScreenshotPath);
  const currentHashWithDims = hashImageWithDimensions(currentImageFullPath);
  const currentHash = hashImage(currentImageFullPath);
  const matchingBaseline =
    await queries.getBaselineByHash(testId, currentHashWithDims, stepLabel) ||
    await queries.getBaselineByHash(testId, currentHash, stepLabel);

  // Get planned screenshot if exists (for design comparison)
  const plannedScreenshot = await queries.getPlannedScreenshotByTest(testId, stepLabel || null);

  // Helper to generate planned diff
  const generatePlannedDiff = async (currentPath: string): Promise<{
    plannedImagePath: string | null;
    plannedDiffImagePath: string | null;
    plannedPixelDifference: number | null;
    plannedPercentageDifference: string | null;
  }> => {
    if (!plannedScreenshot) {
      return {
        plannedImagePath: null,
        plannedDiffImagePath: null,
        plannedPixelDifference: null,
        plannedPercentageDifference: null,
      };
    }

    try {
      const plannedDiffResult = await generateDiff(
        path.join(STORAGE_ROOT, plannedScreenshot.imagePath),
        path.join(STORAGE_ROOT, currentPath),
        DIFFS_DIR,
        0.1,
        includeAntiAliasing,
        ignoreRects,
        false,
        diffEngine,
        regionDetectionMode
      );

      return {
        plannedImagePath: plannedScreenshot.imagePath,
        plannedDiffImagePath: toRelativePath(plannedDiffResult.diffImagePath),
        plannedPixelDifference: plannedDiffResult.pixelDifference,
        plannedPercentageDifference: plannedDiffResult.percentageDifference.toString(),
      };
    } catch {
      return {
        plannedImagePath: plannedScreenshot.imagePath,
        plannedDiffImagePath: null,
        plannedPixelDifference: null,
        plannedPercentageDifference: null,
      };
    }
  };

  // Helper to generate main baseline diff (always runs on feature branches)
  const generateMainBaselineDiff = async (currentPath: string): Promise<{
    mainBaselineImagePath: string | null;
    mainDiffImagePath: string | null;
    mainPixelDifference: number | null;
    mainPercentageDifference: string | null;
    mainClassification: DiffClassification | null;
  }> => {
    // Skip when on main branch (branch diff IS the main diff)
    if (branch === defaultBranch) {
      return { mainBaselineImagePath: null, mainDiffImagePath: null, mainPixelDifference: null, mainPercentageDifference: null, mainClassification: null };
    }

    const mainBaseline = await queries.getBranchBaseline(testId, stepLabel, defaultBranch);
    if (!mainBaseline) {
      return { mainBaselineImagePath: null, mainDiffImagePath: null, mainPixelDifference: null, mainPercentageDifference: null, mainClassification: null };
    }

    try {
      const mainDiffResult = await generateDiff(
        path.join(STORAGE_ROOT, mainBaseline.imagePath),
        path.join(STORAGE_ROOT, currentPath),
        DIFFS_DIR,
        0.1,
        includeAntiAliasing,
        ignoreRects,
        ignorePageShift,
        diffEngine,
        regionDetectionMode
      );

      const mainPct = mainDiffResult.percentageDifference;
      const { classification: mainCls } = classifyDiff(mainPct);

      return {
        mainBaselineImagePath: mainBaseline.imagePath,
        mainDiffImagePath: toRelativePath(mainDiffResult.diffImagePath),
        mainPixelDifference: mainDiffResult.pixelDifference,
        mainPercentageDifference: mainDiffResult.percentageDifference.toString(),
        mainClassification: mainCls,
      };
    } catch {
      return {
        mainBaselineImagePath: mainBaseline.imagePath,
        mainDiffImagePath: null,
        mainPixelDifference: null,
        mainPercentageDifference: null,
        mainClassification: null,
      };
    }
  };

  if (matchingBaseline) {
    // Validate carry-forward: verify dimensions match before trusting hash
    let carryForwardValid = false;
    try {
      const currentBuf = fs.readFileSync(path.join(STORAGE_ROOT, currentScreenshotPath));
      const baselineBuf = fs.readFileSync(path.join(STORAGE_ROOT, matchingBaseline.imagePath));
      const currentPng = PNG.sync.read(currentBuf);
      const baselinePng = PNG.sync.read(baselineBuf);
      carryForwardValid = currentPng.width === baselinePng.width && currentPng.height === baselinePng.height;
    } catch {
      // If we can't read either file, fall through to normal diff
      carryForwardValid = false;
    }

    if (carryForwardValid) {
      // Auto-approve: identical to previously approved baseline
      const plannedDiff = await generatePlannedDiff(currentScreenshotPath);
      const mainDiff = await generateMainBaselineDiff(currentScreenshotPath);

      const diff = await queries.createVisualDiff({
        buildId,
        testResultId,
        testId,
        stepLabel: stepLabel || null,
        baselineImagePath: matchingBaseline.imagePath,
        currentImagePath: currentScreenshotPath,
        status: 'auto_approved',
        classification: 'unchanged',
        pixelDifference: 0,
        percentageDifference: '0',
        metadata: { changedRegions: [] },
        ...plannedDiff,
        ...mainDiff,
      });
      return { hasChanges: false, diffId: diff.id, classification: 'unchanged' };
    }
    // Dimensions mismatch — hash is stale/wrong, fall through to normal diff
  }

  // No baseline - this is a new test, requires manual review (or auto-approve on default branch)
  if (!baseline) {
    const plannedDiff = await generatePlannedDiff(currentScreenshotPath);
    const mainDiff = await generateMainBaselineDiff(currentScreenshotPath);

    const diff = await queries.createVisualDiff({
      buildId,
      testResultId,
      testId,
      stepLabel: stepLabel || null,
      currentImagePath: currentScreenshotPath,
      status: shouldAutoApprove ? 'auto_approved' : 'pending',
      classification: 'changed',
      pixelDifference: 0,
      percentageDifference: '0',
      metadata: { changedRegions: [], isNewTest: true },
      ...plannedDiff,
      ...mainDiff,
    });

    if (shouldAutoApprove) {
      const autoHash = hashImageWithDimensions(path.join(STORAGE_ROOT, currentScreenshotPath));
      await queries.deactivateBaselines(testId, stepLabel || null, branch);
      await queries.createBaseline({
        testId,
        stepLabel: stepLabel || null,
        imagePath: currentScreenshotPath,
        imageHash: autoHash,
        branch,
        approvedFromDiffId: diff.id,
      });
    }

    return { hasChanges: !shouldAutoApprove, diffId: diff.id, classification: 'changed' };
  }

  // Generate diff against primary baseline
  try {
    const diffResult = textRegionAwareDiffing
      ? await generateTextAwareDiffFromPaths(
          path.join(STORAGE_ROOT, baseline.imagePath),
          path.join(STORAGE_ROOT, currentScreenshotPath),
          DIFFS_DIR,
          {
            textRegionThreshold: (settings.textRegionThreshold ?? 30) / 100,
            nonTextThreshold: 0.1,
            textRegionPadding: settings.textRegionPadding ?? 4,
            includeAntiAliasing,
            textDetectionGranularity: (settings.textDetectionGranularity as 'word' | 'line' | 'block') ?? 'word',
            diffEngine,
          },
          ignoreRects,
          regionDetectionMode,
        )
      : await generateDiff(
          path.join(STORAGE_ROOT, baseline.imagePath),
          path.join(STORAGE_ROOT, currentScreenshotPath),
          DIFFS_DIR,
          0.1,
          includeAntiAliasing,
          ignoreRects,
          ignorePageShift,
          diffEngine,
          regionDetectionMode
        );

    const pct = diffResult.percentageDifference;
    const { classification, status } = classifyDiff(pct);
    const effectiveStatus = shouldAutoApprove ? 'auto_approved' : status;
    const hasChanges = shouldAutoApprove ? false : classification !== 'unchanged';
    const diffImagePath = toRelativePath(diffResult.diffImagePath);

    // Strip absolute paths from aligned shift images before DB storage
    const metadata = diffResult.metadata;
    if (metadata.pageShift?.alignedBaselineImagePath) {
      metadata.pageShift.alignedBaselineImagePath = toRelativePath(metadata.pageShift.alignedBaselineImagePath);
    }
    if (metadata.pageShift?.alignedCurrentImagePath) {
      metadata.pageShift.alignedCurrentImagePath = toRelativePath(metadata.pageShift.alignedCurrentImagePath);
    }
    if (metadata.pageShift?.alignedDiffImagePath) {
      metadata.pageShift.alignedDiffImagePath = toRelativePath(metadata.pageShift.alignedDiffImagePath);
    }

    const plannedDiff = await generatePlannedDiff(currentScreenshotPath);
    const mainDiff = await generateMainBaselineDiff(currentScreenshotPath);

    const diff = await queries.createVisualDiff({
      buildId,
      testResultId,
      testId,
      stepLabel: stepLabel || null,
      baselineImagePath: baseline.imagePath,
      currentImagePath: currentScreenshotPath,
      diffImagePath,
      status: effectiveStatus,
      classification,
      pixelDifference: diffResult.pixelDifference,
      percentageDifference: diffResult.percentageDifference.toString(),
      metadata,
      ...plannedDiff,
      ...mainDiff,
    });

    if (shouldAutoApprove && classification !== 'unchanged') {
      const autoHash = hashImageWithDimensions(path.join(STORAGE_ROOT, currentScreenshotPath));
      await queries.deactivateBaselines(testId, stepLabel || null, branch);
      await queries.createBaseline({
        testId,
        stepLabel: stepLabel || null,
        imagePath: currentScreenshotPath,
        imageHash: autoHash,
        branch,
        approvedFromDiffId: diff.id,
      });
    }

    return { hasChanges, diffId: diff.id, classification };
  } catch {
    // Diff generation failed, mark as pending for review
    const plannedDiff = await generatePlannedDiff(currentScreenshotPath);
    const mainDiff = await generateMainBaselineDiff(currentScreenshotPath);

    const diff = await queries.createVisualDiff({
      buildId,
      testResultId,
      testId,
      stepLabel: stepLabel || null,
      baselineImagePath: baseline.imagePath,
      currentImagePath: currentScreenshotPath,
      status: 'pending',
      classification: 'changed',
      pixelDifference: -1,
      percentageDifference: '-1',
      metadata: { changedRegions: [] },
      ...plannedDiff,
      ...mainDiff,
    });
    return { hasChanges: true, diffId: diff.id, classification: 'changed' };
  }
}

/**
 * Get build summary with all metrics
 */
export async function getBuildSummary(buildId: string): Promise<BuildSummary | null> {
  const build = await queries.getBuild(buildId);
  if (!build) return null;

  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const diffs = await queries.getVisualDiffsWithTestStatus(buildId);

  // Determine if build is on the default branch
  const repo = testRun?.repositoryId ? await queries.getRepository(testRun.repositoryId) : null;
  const defaultBranch = repo?.defaultBranch || 'main';
  const gitBranch = testRun?.gitBranch || 'unknown';

  return {
    id: build.id,
    overallStatus: build.overallStatus as BuildStatus,
    totalTests: build.totalTests ?? 0,
    changesDetected: build.changesDetected ?? 0,
    flakyCount: build.flakyCount ?? 0,
    failedCount: build.failedCount ?? 0,
    passedCount: build.passedCount ?? 0,
    elapsedMs: build.elapsedMs,
    createdAt: build.createdAt,
    completedAt: build.completedAt,
    pullRequestId: build.pullRequestId,
    comparisonMode: build.comparisonMode,
    codeChangeTestIds: (build.codeChangeTestIds as string[] | null) ?? null,
    isMainBranch: gitBranch === defaultBranch,
    gitBranch,
    gitCommit: testRun?.gitCommit || 'unknown',
    diffs,
  };
}

/**
 * Get recent builds for dashboard
 */
export async function getRecentBuilds(limit = 5) {
  return queries.getRecentBuilds(limit);
}

/**
 * Get recent builds for a specific repository
 */
export async function getRecentBuildsByRepo(repositoryId: string, limit = 5) {
  return queries.getBuildsByRepo(repositoryId, limit);
}

/**
 * Get all builds
 */
export async function getBuilds(limit = 10) {
  return queries.getBuilds(limit);
}

/**
 * Get builds for a specific repository
 */
export async function getBuildsByRepo(repositoryId: string, limit = 10) {
  return queries.getBuildsByRepo(repositoryId, limit);
}

/**
 * Get build by ID
 */
export async function getBuild(buildId: string) {
  return queries.getBuild(buildId);
}

/**
 * Get latest build changes for the run dashboard
 */
export interface BuildChanges {
  topChanges: { testName: string; percentageDifference: number }[];
  passingDelta: number | null; // +/- compared to previous baseline build
}

export async function getLatestBuildChanges(repositoryId: string): Promise<BuildChanges | null> {
  const recentBuilds = await queries.getBuildsByRepo(repositoryId, 10);
  if (recentBuilds.length === 0) return null;

  const latestBuild = recentBuilds[0];

  // Get visual diffs for the latest build, sorted by percentage difference
  const diffs = await queries.getVisualDiffsWithTestStatus(latestBuild.id);
  const topChanges = diffs
    .filter(d => d.percentageDifference && parseFloat(d.percentageDifference) > 0)
    .sort((a, b) => parseFloat(b.percentageDifference!) - parseFloat(a.percentageDifference!))
    .slice(0, 5)
    .map(d => ({
      testName: d.testName || 'Unknown test',
      percentageDifference: parseFloat(d.percentageDifference!),
    }));

  // Find passing delta: compare latest build's passedCount to the previous baseline build
  let passingDelta: number | null = null;
  const baselineBuild = recentBuilds.find(
    (b, i) => i > 0 && b.overallStatus === 'safe_to_merge'
  );
  if (baselineBuild && latestBuild.passedCount != null && baselineBuild.passedCount != null) {
    passingDelta = (latestBuild.passedCount ?? 0) - (baselineBuild.passedCount ?? 0);
  }

  return { topChanges, passingDelta };
}

/**
 * Send notifications (Slack and/or GitHub PR comment) after build completion
 */
async function sendBuildNotifications(data: {
  buildId: string;
  status: BuildStatus;
  totalTests: number;
  passedCount: number;
  changesDetected: number;
  flakyCount: number;
  failedCount: number;
  gitBranch: string;
  repositoryId?: string | null;
}) {
  const build = await queries.getBuild(data.buildId);
  if (!build) return;

  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const notificationSettings = await queries.getNotificationSettings(data.repositoryId);

  // Get base URL for links (default to localhost for now)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const buildUrl = `${baseUrl}/builds/${data.buildId}`;

  // Send Slack notification
  if (notificationSettings.slackEnabled && notificationSettings.slackWebhookUrl) {
    try {
      await sendSlackNotification(notificationSettings.slackWebhookUrl, {
        buildId: data.buildId,
        status: data.status,
        totalTests: data.totalTests,
        passedCount: data.passedCount,
        changesDetected: data.changesDetected,
        flakyCount: data.flakyCount,
        failedCount: data.failedCount,
        gitBranch: data.gitBranch,
        gitCommit: testRun?.gitCommit || 'unknown',
        buildUrl,
      });
    } catch (error) {
      console.error('Failed to send Slack notification:', error);
    }
  }

  // Send Discord notification
  if (notificationSettings.discordEnabled && notificationSettings.discordWebhookUrl) {
    try {
      const result = await sendDiscordNotification(notificationSettings.discordWebhookUrl, {
        buildId: data.buildId,
        status: data.status,
        totalTests: data.totalTests,
        passedCount: data.passedCount,
        changesDetected: data.changesDetected,
        flakyCount: data.flakyCount,
        failedCount: data.failedCount,
        gitBranch: data.gitBranch,
        gitCommit: testRun?.gitCommit || 'unknown',
        buildUrl,
      });
      console.log('[Notifications] Discord result:', result);
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
    }
  }

  // Send custom webhook notification
  if (notificationSettings.customWebhookEnabled && notificationSettings.customWebhookUrl) {
    try {
      let headers: Record<string, string> | undefined;
      if (notificationSettings.customWebhookHeaders) {
        try {
          headers = JSON.parse(notificationSettings.customWebhookHeaders);
        } catch {
          console.error('Failed to parse custom webhook headers');
        }
      }

      const result = await sendCustomWebhookNotification(
        {
          url: notificationSettings.customWebhookUrl,
          method: (notificationSettings.customWebhookMethod as 'POST' | 'PUT') || 'POST',
          headers,
        },
        {
          buildId: data.buildId,
          status: data.status,
          totalTests: data.totalTests,
          passedCount: data.passedCount,
          changesDetected: data.changesDetected,
          flakyCount: data.flakyCount,
          failedCount: data.failedCount,
          gitBranch: data.gitBranch,
          gitCommit: testRun?.gitCommit || 'unknown',
          buildUrl,
        }
      );
      console.log('[Notifications] Custom webhook result:', result);
    } catch (error) {
      console.error('Failed to send custom webhook notification:', error);
    }
  }

  // Post GitHub PR comment
  if (notificationSettings.githubPrCommentsEnabled) {
    try {
      const repo = data.repositoryId ? await queries.getRepository(data.repositoryId) : null;
      const account = repo?.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;

      if (account && repo && repo.provider === 'github') {
        // Find open PRs for this branch
        const prs = await getOpenPRsForBranch(
          account.accessToken,
          repo.owner,
          repo.name,
          data.gitBranch
        );

        // Compute branch-specific counts for enhanced PR comment
        const buildDiffs = await queries.getVisualDiffsWithTestStatus(data.buildId);
        const mainDriftCount = buildDiffs.filter(d =>
          d.mainPercentageDifference && parseFloat(d.mainPercentageDifference) > 0
        ).length;
        const branchAcceptedCount = buildDiffs.filter(d => d.status === 'approved').length;

        for (const pr of prs) {
          await postPRComment(
            account.accessToken,
            repo.owner,
            repo.name,
            pr.number,
            {
              buildId: data.buildId,
              status: data.status,
              totalTests: data.totalTests,
              passedCount: data.passedCount,
              changesDetected: data.changesDetected,
              flakyCount: data.flakyCount,
              failedCount: data.failedCount,
              buildUrl,
              comparisonMode: build.comparisonMode,
              mainDriftCount,
              branchAcceptedCount,
            }
          );
        }
      }
    } catch (error) {
      console.error('Failed to post GitHub PR comment:', error);
    }
  }

  // Post GitLab MR comment
  if (notificationSettings.gitlabMrCommentsEnabled) {
    try {
      const repo = data.repositoryId ? await queries.getRepository(data.repositoryId) : null;
      const account = repo?.teamId ? await queries.getGitlabAccountByTeam(repo.teamId) : null;

      if (account && repo && repo.provider === 'gitlab' && repo.gitlabProjectId) {
        // Find open MRs for this branch
        const mrs = await getOpenMRsForBranch(
          account.accessToken,
          repo.gitlabProjectId,
          data.gitBranch,
          account.instanceUrl || undefined
        );

        for (const mr of mrs) {
          await postMRComment(
            account.accessToken,
            repo.gitlabProjectId,
            mr.iid,
            {
              buildId: data.buildId,
              status: data.status,
              totalTests: data.totalTests,
              passedCount: data.passedCount,
              changesDetected: data.changesDetected,
              flakyCount: data.flakyCount,
              failedCount: data.failedCount,
              buildUrl,
            },
            account.instanceUrl || undefined
          );
        }
      }
    } catch (error) {
      console.error('Failed to post GitLab MR comment:', error);
    }
  }
}

/**
 * Save compose config (selected tests + version overrides) for a branch
 */
export async function saveComposeConfig(
  repositoryId: string,
  branch: string,
  selectedTestIds: string[],
  excludedTestIds: string[],
  versionOverrides: Record<string, string>,
) {
  await requireRepoAccess(repositoryId);
  await queries.upsertComposeConfig(repositoryId, branch, { selectedTestIds, excludedTestIds, versionOverrides });
  revalidatePath('/compose');
  revalidatePath('/run');
}

/**
 * Get all tests with their version history for the compose page
 */
export async function getTestsWithVersions(repositoryId: string) {
  await requireRepoAccess(repositoryId);

  const repoTests = await queries.getTestsByRepo(repositoryId);
  const testsWithVersions = await Promise.all(
    repoTests.map(async (test) => {
      const versions = await queries.getTestVersions(test.id);
      return {
        ...test,
        versions: versions.slice(0, 10), // Last 10 versions
      };
    })
  );

  // Group by functional area
  const areas = await queries.getFunctionalAreas();
  const areaMap = new Map(areas.map(a => [a.id, a.name]));

  return testsWithVersions.map(t => ({
    ...t,
    functionalAreaName: t.functionalAreaId ? areaMap.get(t.functionalAreaId) ?? null : null,
  }));
}
