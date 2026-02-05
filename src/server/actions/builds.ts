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
import { getCurrentSession } from '@/lib/auth';
import { generateDiff } from '@/lib/diff/generator';
import { hashImage } from '@/lib/diff/hasher';
import { sendSlackNotification } from '@/lib/integrations/slack';
import { sendDiscordNotification } from '@/lib/integrations/discord';
import { sendCustomWebhookNotification } from '@/lib/integrations/custom-webhook';
import { postPRComment } from '@/lib/integrations/github-pr';
import { postMRComment } from '@/lib/integrations/gitlab-mr';
import type { Test, TriggerType, BuildStatus, VisualDiffWithTestStatus, DiffClassification, DiffStatus } from '@/lib/db/schema';
import path from 'path';
import { createJob, createPendingJob, startJob, updateJobProgress, completeJob, failJob } from './jobs';

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
    // Fetch from GitLab
    const account = await queries.getGitlabAccount();
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
    // Fetch from GitHub
    const account = await queries.getGithubAccount();
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

const DIFFS_DIR = path.join(process.cwd(), 'public', 'diffs');

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
  runnerId?: string
) {
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

  // Get tests to run
  let tests: Test[];
  if (testIds && testIds.length > 0) {
    tests = await Promise.all(
      testIds.map((id) => queries.getTest(id))
    ).then((results) => results.filter((t): t is Test => t !== undefined));
  } else if (repositoryId) {
    tests = await queries.getTestsByRepo(repositoryId);
  } else {
    tests = await queries.getTests();
  }

  if (tests.length === 0) {
    throw new Error('No tests to run');
  }

  // Get repo for git info via GitHub API
  const repo = repositoryId ? await queries.getRepository(repositoryId) : await queries.getSelectedRepository();
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
  });

  // Try to link to existing PR
  const pr = await queries.getPullRequestByBranch(gitInfo.branch);
  if (pr) {
    await queries.updateBuild(build.id, { pullRequestId: pr.id });
  }

  // Run tests async
  runBuildAsync(build.id, testRun.id, tests, gitInfo.branch, repositoryId, runnerId);

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
  runnerId?: string
) {
  const runner = getRunner(repositoryId);
  const startTime = Date.now();
  const jobId = await createJob('build_run', `Build (${tests.length} tests)`, tests.length, repositoryId, { buildId, testRunId });

  let passedCount = 0;
  let failedCount = 0;
  let changesDetected = 0;
  let flakyCount = 0;
  let processedCount = 0;

  // Get teamId for agent execution
  let teamId: string | undefined;
  if (runnerId && runnerId !== 'local') {
    const session = await getCurrentSession();
    teamId = session?.user?.teamId ?? undefined;
  }

  // Prepare environment and settings for executor
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  const playwrightSettings = await queries.getPlaywrightSettings(repositoryId);

  // Result callback for processing diffs
  const onResult = async (result: { testId: string; status: string; screenshotPath?: string; screenshots: { path: string; label?: string }[]; errorMessage?: string; durationMs?: number; a11yViolations?: { id: string; impact: 'critical' | 'serious' | 'moderate' | 'minor'; description: string; help: string; helpUrl: string; nodes: number }[] }) => {
    processedCount++;

    // Save test result immediately
    const testResult = await queries.createTestResult({
      testRunId,
      testId: result.testId,
      status: result.status,
      screenshotPath: result.screenshotPath,
      screenshots: result.screenshots,
      errorMessage: result.errorMessage,
      durationMs: result.durationMs,
      viewport: '1280x720',
      browser: 'chromium',
      a11yViolations: result.a11yViolations,
    });

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
        screenshot.label
      );
      if (diffResult.classification === 'changed') changesDetected++;
      if (diffResult.classification === 'flaky') flakyCount++;
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

    // Run build-level setup if configured
    if (build?.buildSetupTestId || build?.buildSetupScriptId) {
      await queries.updateBuild(buildId, { setupStatus: 'running' });

      const orchestrator = getSetupOrchestrator();
      // For build-level setup, we need a browser page
      // We'll use a temporary page for setup, then pass variables to tests
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
          // Build setup failed - abort the build
          await queries.updateBuild(buildId, {
            setupStatus: 'failed',
            setupError: setupResult.error,
            setupDurationMs: setupResult.duration,
          });
          throw new Error(`Build setup failed: ${setupResult.error}`);
        }

        // Merge setup variables
        if (setupResult.variables) {
          setupContext.variables = { ...setupContext.variables, ...setupResult.variables };
        }

        await queries.updateBuild(buildId, {
          setupStatus: 'completed',
          setupDurationMs: setupResult.duration,
        });
      } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    } else {
      await queries.updateBuild(buildId, { setupStatus: 'skipped' });
    }

    // Remove page from context (each test gets its own)
    delete setupContext.page;

    // Set the setup context on the runner so tests can access it
    runner.setSetupContext(setupContext);

    // Use executor for agent routing, or direct runner for local
    if (runnerId && runnerId !== 'local' && teamId) {
      // Load runner's maxParallelTests setting
      const remoteRunner = await queries.getRunnerById(runnerId);
      const maxParallelTests = remoteRunner?.maxParallelTests ?? 1;

      await executeTests(tests, testRunId, {
        repositoryId,
        teamId,
        runnerId,
        environmentConfig: envConfig,
        playwrightSettings,
        maxParallelTests,
      }, onProgress, onResult);
    } else {
      // Local uses maxParallelTests from playwrightSettings (set via runner.setSettings)
      await runner.runTests(tests, testRunId, onProgress, onResult);
    }

    // Clear setup context after tests complete
    runner.clearSetupContext();

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
  // Get tests to determine label
  let tests: Test[];
  if (testIds && testIds.length > 0) {
    tests = await Promise.all(
      testIds.map((id) => queries.getTest(id))
    ).then((results) => results.filter((t): t is Test => t !== undefined));
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
async function processNextQueuedBuild(repositoryId?: string | null) {
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
 * Process visual diff for a test result
 */
async function processVisualDiff(
  buildId: string,
  testResultId: string,
  testId: string,
  currentScreenshotPath: string,
  branch: string,
  repositoryId?: string | null,
  stepLabel?: string
): Promise<{ hasChanges: boolean; diffId: string; classification: DiffClassification }> {
  // Get diff sensitivity settings
  const settings = await queries.getDiffSensitivitySettings(repositoryId);
  const unchangedThreshold = settings.unchangedThreshold ?? 1;
  const flakyThreshold = settings.flakyThreshold ?? 10;
  const includeAntiAliasing = settings.includeAntiAliasing ?? false;

  // Helper to classify based on percentage
  const classifyDiff = (pct: number): { classification: DiffClassification; status: DiffStatus } => {
    if (pct < unchangedThreshold) {
      return { classification: 'unchanged', status: 'auto_approved' };
    } else if (pct < flakyThreshold) {
      return { classification: 'flaky', status: 'pending' };
    } else {
      return { classification: 'changed', status: 'pending' };
    }
  };

  // Get active baseline for this test (filtered by stepLabel)
  const baseline = await queries.getActiveBaseline(testId, stepLabel);

  // Check for carry-forward (previously approved identical image)
  const currentHash = hashImage(path.join(process.cwd(), 'public', currentScreenshotPath));
  const matchingBaseline = await queries.getBaselineByHash(testId, currentHash, stepLabel);

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
        path.join(process.cwd(), 'public', plannedScreenshot.imagePath),
        path.join(process.cwd(), 'public', currentPath),
        DIFFS_DIR,
        0.1,
        includeAntiAliasing
      );

      return {
        plannedImagePath: plannedScreenshot.imagePath,
        plannedDiffImagePath: plannedDiffResult.diffImagePath.replace(process.cwd() + '/public', ''),
        plannedPixelDifference: plannedDiffResult.pixelDifference,
        plannedPercentageDifference: plannedDiffResult.percentageDifference.toString(),
      };
    } catch {
      // Planned diff generation failed, just skip planned comparison
      return {
        plannedImagePath: plannedScreenshot.imagePath,
        plannedDiffImagePath: null,
        plannedPixelDifference: null,
        plannedPercentageDifference: null,
      };
    }
  };

  if (matchingBaseline) {
    // Auto-approve: identical to previously approved baseline
    const plannedDiff = await generatePlannedDiff(currentScreenshotPath);

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
    });
    return { hasChanges: false, diffId: diff.id, classification: 'unchanged' };
  }

  // No baseline - this is a new test, requires manual review
  if (!baseline) {
    const plannedDiff = await generatePlannedDiff(currentScreenshotPath);

    const diff = await queries.createVisualDiff({
      buildId,
      testResultId,
      testId,
      stepLabel: stepLabel || null,
      currentImagePath: currentScreenshotPath,
      status: 'pending',
      classification: 'changed',
      pixelDifference: 0,
      percentageDifference: '0',
      metadata: { changedRegions: [], isNewTest: true },
      ...plannedDiff,
    });

    // Baseline will be created when the diff is approved
    return { hasChanges: true, diffId: diff.id, classification: 'changed' };
  }

  // Generate diff against baseline
  try {
    const diffResult = await generateDiff(
      path.join(process.cwd(), 'public', baseline.imagePath),
      path.join(process.cwd(), 'public', currentScreenshotPath),
      DIFFS_DIR,
      0.1,
      includeAntiAliasing
    );

    const pct = diffResult.percentageDifference;
    const { classification, status } = classifyDiff(pct);
    const hasChanges = classification !== 'unchanged';
    const diffImagePath = diffResult.diffImagePath.replace(process.cwd() + '/public', '');

    // Also generate planned diff
    const plannedDiff = await generatePlannedDiff(currentScreenshotPath);

    const diff = await queries.createVisualDiff({
      buildId,
      testResultId,
      testId,
      stepLabel: stepLabel || null,
      baselineImagePath: baseline.imagePath,
      currentImagePath: currentScreenshotPath,
      diffImagePath,
      status,
      classification,
      pixelDifference: diffResult.pixelDifference,
      percentageDifference: diffResult.percentageDifference.toString(),
      metadata: diffResult.metadata,
      ...plannedDiff,
    });

    return { hasChanges, diffId: diff.id, classification };
  } catch {
    // Diff generation failed, mark as pending for review
    const plannedDiff = await generatePlannedDiff(currentScreenshotPath);

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
    gitBranch: testRun?.gitBranch || 'unknown',
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
      const account = await queries.getGithubAccount();
      const repo = data.repositoryId ? await queries.getRepository(data.repositoryId) : null;

      if (account && repo && repo.provider === 'github') {
        // Find open PRs for this branch
        const prs = await getOpenPRsForBranch(
          account.accessToken,
          repo.owner,
          repo.name,
          data.gitBranch
        );

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
      const account = await queries.getGitlabAccount();
      const repo = data.repositoryId ? await queries.getRepository(data.repositoryId) : null;

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
