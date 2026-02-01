'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { getBranchInfo } from '@/lib/github/content';
import { getRunner } from '@/lib/playwright/runner';
import { getServerManager } from '@/lib/playwright/server-manager';
import { generateDiff } from '@/lib/diff/generator';
import { hashImage } from '@/lib/diff/hasher';
import type { Test, TriggerType, BuildStatus, VisualDiffWithTestStatus, DiffClassification, DiffStatus } from '@/lib/db/schema';
import path from 'path';
import { createJob, createPendingJob, startJob, updateJobProgress, completeJob, failJob } from './jobs';

interface GitInfo {
  branch: string;
  commit: string;
}

async function getGitInfoFromGitHub(repositoryId: string | null): Promise<GitInfo> {
  if (!repositoryId) {
    return { branch: 'unknown', commit: 'unknown' };
  }

  const account = await queries.getGithubAccount();
  const repo = await queries.getRepository(repositoryId);

  if (!account || !repo) {
    return { branch: 'unknown', commit: 'unknown' };
  }

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';
  const branchInfo = await getBranchInfo(account.accessToken, repo.owner, repo.name, branch);

  if (!branchInfo) {
    return { branch, commit: 'unknown' };
  }

  return {
    branch: branchInfo.name,
    commit: branchInfo.commit.sha.slice(0, 7),
  };
}

const SCREENSHOTS_DIR = path.join(process.cwd(), 'public', 'screenshots');
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
  repositoryId?: string | null
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
  runBuildAsync(build.id, testRun.id, tests, gitInfo.branch, repositoryId);

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
  repositoryId?: string | null
) {
  const runner = getRunner(repositoryId);
  const startTime = Date.now();
  const jobId = await createJob('build_run', `Build (${tests.length} tests)`, tests.length, repositoryId, { buildId, testRunId });

  let passedCount = 0;
  let failedCount = 0;
  let changesDetected = 0;
  let flakyCount = 0;
  let processedCount = 0;

  try {
    await runner.runTests(tests, testRunId, undefined, async (result) => {
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
      });

      if (result.status === 'passed') passedCount++;
      else if (result.status === 'failed') failedCount++;

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
    });

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
  const baseline = await queries.getActiveBaseline(testId, branch, stepLabel);

  // Check for carry-forward (previously approved identical image)
  const currentHash = hashImage(path.join(process.cwd(), 'public', currentScreenshotPath));
  const matchingBaseline = await queries.getBaselineByHash(testId, currentHash, stepLabel);

  if (matchingBaseline) {
    // Auto-approve: identical to previously approved baseline
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
    });
    return { hasChanges: false, diffId: diff.id, classification: 'unchanged' };
  }

  // No baseline - this is a new test, auto-approve as initial
  if (!baseline) {
    const diff = await queries.createVisualDiff({
      buildId,
      testResultId,
      testId,
      stepLabel: stepLabel || null,
      currentImagePath: currentScreenshotPath,
      status: 'auto_approved',
      classification: 'unchanged',
      pixelDifference: 0,
      percentageDifference: '0',
      metadata: { changedRegions: [] },
    });

    // Create initial baseline
    await queries.createBaseline({
      testId,
      stepLabel: stepLabel || null,
      imagePath: currentScreenshotPath,
      imageHash: currentHash,
      branch,
      approvedFromDiffId: diff.id,
    });

    return { hasChanges: false, diffId: diff.id, classification: 'unchanged' };
  }

  // Generate diff against baseline
  try {
    const diffResult = await generateDiff(
      path.join(process.cwd(), 'public', baseline.imagePath),
      path.join(process.cwd(), 'public', currentScreenshotPath),
      DIFFS_DIR
    );

    const pct = diffResult.percentageDifference;
    const { classification, status } = classifyDiff(pct);
    const hasChanges = classification !== 'unchanged';
    const diffImagePath = diffResult.diffImagePath.replace(process.cwd() + '/public', '');

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
    });

    return { hasChanges, diffId: diff.id, classification };
  } catch (error) {
    // Diff generation failed, mark as pending for review
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
