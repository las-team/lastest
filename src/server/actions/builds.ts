'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { getGitInfo } from '@/lib/git/utils';
import { getRunner } from '@/lib/playwright/runner';
import { getServerManager } from '@/lib/playwright/server-manager';
import { generateDiff } from '@/lib/diff/generator';
import { hashImage } from '@/lib/diff/hasher';
import type { Test, TriggerType, BuildStatus, VisualDiffWithTestStatus, DiffClassification, DiffStatus } from '@/lib/db/schema';
import path from 'path';

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
 * Create and run a new build
 */
export async function createAndRunBuild(
  triggerType: TriggerType = 'manual',
  testIds?: string[],
  repositoryId?: string | null
) {
  const runner = getRunner(repositoryId);

  if (runner.isActive()) {
    throw new Error('Tests already running');
  }

  // Load and set environment config
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  if (envConfig && envConfig.id) {
    runner.setEnvironmentConfig(envConfig);
    const serverManager = getServerManager();
    serverManager.setConfig(envConfig);
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

  // Create test run
  const gitInfo = await getGitInfo();
  const testRun = await queries.createTestRun({
    repositoryId: repositoryId ?? undefined,
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

  try {
    const results = await runner.runTests(tests, testRunId);

    let passedCount = 0;
    let failedCount = 0;
    let changesDetected = 0;
    let flakyCount = 0;

    for (const result of results) {
      // Save test result
      const testResult = await queries.createTestResult({
        testRunId,
        testId: result.testId,
        status: result.status,
        screenshotPath: result.screenshotPath,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
        viewport: '1280x720',
        browser: 'chromium',
      });

      if (result.status === 'passed') passedCount++;
      else if (result.status === 'failed') failedCount++;

      // Generate visual diff if screenshot exists
      if (result.screenshotPath) {
        const diffResult = await processVisualDiff(
          buildId,
          testResult.id,
          result.testId,
          result.screenshotPath,
          branch,
          repositoryId
        );
        if (diffResult.hasChanges) changesDetected++;
        if (diffResult.classification === 'flaky') flakyCount++;
      }
    }

    // Update test run status
    const hasFailures = failedCount > 0;
    await queries.updateTestRun(testRunId, {
      completedAt: new Date(),
      status: hasFailures ? 'failed' : 'passed',
    });

    // Update build metrics and status
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
  }

  revalidatePath('/builds');
  revalidatePath('/');
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
  repositoryId?: string | null
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

  // Get active baseline for this test
  const baseline = await queries.getActiveBaseline(testId, branch);

  // Check for carry-forward (previously approved identical image)
  const currentHash = hashImage(path.join(process.cwd(), 'public', currentScreenshotPath));
  const matchingBaseline = await queries.getBaselineByHash(testId, currentHash);

  if (matchingBaseline) {
    // Auto-approve: identical to previously approved baseline
    const diff = await queries.createVisualDiff({
      buildId,
      testResultId,
      testId,
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
      currentImagePath: currentScreenshotPath,
      status: 'pending',
      classification: 'changed',
      pixelDifference: 0,
      percentageDifference: '0',
      metadata: { changedRegions: [] },
    });

    // Create initial baseline
    await queries.createBaseline({
      testId,
      imagePath: currentScreenshotPath,
      imageHash: currentHash,
      branch,
      approvedFromDiffId: diff.id,
    });

    return { hasChanges: false, diffId: diff.id, classification: 'changed' };
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
