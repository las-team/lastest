/**
 * Core diff mutation logic — extracted from `src/server/actions/diffs.ts`
 * so it cannot be reached as a Next.js Server Action RPC. This file
 * deliberately omits the `'use server'` directive: callers must be other
 * server-side code (server actions, API route handlers) that have already
 * authenticated and verified ownership.
 *
 * Auth invariant: NONE of the functions below verify the caller's team
 * owns the entity. The caller is responsible for `requireDiffOwnership`
 * / `requireBuildOwnership` before invoking these.
 */
import { revalidatePath } from 'next/cache';
import path from 'path';
import * as queries from '@/lib/db/queries';
import { hashImageWithDimensions } from '@/lib/diff/hasher';
import { STORAGE_ROOT } from '@/lib/storage/paths';

/**
 * Approve a single visual diff — core logic, no auth check.
 * Called by both session-authenticated and token-authenticated paths.
 */
export async function approveDiffCore(diffId: string, approvedBy?: string) {
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) throw new Error('Diff not found');
  if (!diff.currentImagePath) throw new Error('Cannot approve diff without screenshot');

  // Update diff status (preserve original baselineImagePath for historical comparison)
  await queries.updateVisualDiff(diffId, {
    status: 'approved',
    approvedBy: approvedBy || 'user',
    approvedAt: new Date(),
  });

  // Update baseline with the approved image
  const currentHash = hashImageWithDimensions(
    path.join(STORAGE_ROOT, diff.currentImagePath)
  );

  // Get the test run to find the branch
  const testResult = diff.testResultId
    ? await queries.getTestResultById(diff.testResultId)
    : null;
  const testRun = testResult?.testRunId
    ? await queries.getTestRun(testResult.testRunId)
    : null;
  const branch = testRun?.gitBranch || 'main';

  // Determine the browser from the diff record (defaults to chromium for legacy diffs)
  const browser = diff.browser || 'chromium';

  // Branch-scoped approval: only deactivate/create baselines for THIS branch + browser
  // Main baselines are only updated via PR merge promotion or direct main builds
  await queries.deactivateBaselines(diff.testId, diff.stepLabel, branch, browser);
  await queries.createBaseline({
    testId: diff.testId,
    stepLabel: diff.stepLabel,
    imagePath: diff.currentImagePath,
    imageHash: currentHash,
    branch,
    browser,
    approvedFromDiffId: diffId,
  });

  // Update build status
  if (diff.buildId) {
    const newStatus = await queries.computeBuildStatus(diff.buildId);
    await queries.updateBuild(diff.buildId, { overallStatus: newStatus });
  }

  revalidatePath('/builds');
  revalidatePath(`/builds/${diff.buildId}`);

  return { success: true };
}

/**
 * Reject a visual diff — core logic, no auth check.
 */
export async function rejectDiffCore(diffId: string) {
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) throw new Error('Diff not found');

  await queries.updateVisualDiff(diffId, {
    status: 'rejected',
  });

  // Update build status to blocked
  if (diff.buildId) {
    await queries.updateBuild(diff.buildId, { overallStatus: 'blocked' });
  }

  revalidatePath('/builds');
  revalidatePath(`/builds/${diff.buildId}`);

  return { success: true };
}

/**
 * Approve all pending diffs in a build — core logic, no auth check.
 */
export async function approveAllDiffsCore(buildId: string, approvedBy?: string) {
  const pendingDiffs = await queries.getPendingDiffsByBuild(buildId);

  for (const diff of pendingDiffs) {
    await approveDiffCore(diff.id, approvedBy);
  }

  revalidatePath('/builds');
  revalidatePath(`/builds/${buildId}`);

  return { approvedCount: pendingDiffs.length };
}

/**
 * Batch approve selected diffs — core logic, no auth check.
 */
export async function batchApproveDiffsCore(diffIds: string[], approvedBy?: string) {
  for (const diffId of diffIds) {
    await approveDiffCore(diffId, approvedBy);
  }

  revalidatePath('/builds');

  return { approvedCount: diffIds.length };
}

/**
 * Batch reject selected diffs — core logic, no auth check.
 */
export async function batchRejectDiffsCore(diffIds: string[]) {
  for (const diffId of diffIds) {
    await rejectDiffCore(diffId);
  }

  revalidatePath('/builds');

  return { rejectedCount: diffIds.length };
}

/**
 * Extract the step label from a screenshot filename.
 * Filenames follow the pattern: {runId}-{testId}-{stepLabel}.png
 * where runId and testId are UUIDs (5 dash-separated hex groups each = 10 parts).
 */
function extractStepLabelFromPath(imagePath: string): string | null {
  const filename = imagePath.split('/').pop();
  if (!filename) return null;
  const parts = filename.split('-');
  if (parts.length <= 10) return null;
  return parts.slice(10).join('-').replace('.png', '') || null;
}

/**
 * Get a single diff with full details — core logic, no auth check.
 */
export async function getDiffCore(diffId: string) {
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) return null;

  // Get test details
  const test = await queries.getTest(diff.testId);

  // Get error message and a11y violations from test result
  let errorMessage: string | null = null;
  let a11yViolations: import('@/lib/db/schema').A11yViolation[] | null = null;
  let consoleErrors: string[] | null = null;
  let networkRequests: import('@/lib/db/schema').NetworkRequest[] | null = null;
  let networkBodiesPath: string | null = null;
  if (diff.testResultId) {
    const testResult = await queries.getTestResultById(diff.testResultId);
    errorMessage = testResult?.errorMessage ?? null;
    a11yViolations = testResult?.a11yViolations ?? null;
    consoleErrors = testResult?.consoleErrors ?? null;
    networkRequests = testResult?.networkRequests ?? null;
    networkBodiesPath = testResult?.networkBodiesPath ?? null;
  }

  // Hide network requests if network interception is off or error mode is 'ignore'
  if (networkRequests && test) {
    const pwSettings = await queries.getPlaywrightSettings(test.repositoryId);
    if (!pwSettings?.enableNetworkInterception || pwSettings?.networkErrorMode === 'ignore') {
      networkRequests = null;
      networkBodiesPath = null;
    }
  }

  // Look up planned screenshot if not already on the diff
  let plannedImagePath = diff.plannedImagePath;
  const plannedDiffImagePath = diff.plannedDiffImagePath;
  const plannedPixelDifference = diff.plannedPixelDifference;
  const plannedPercentageDifference = diff.plannedPercentageDifference;

  if (!plannedImagePath && diff.currentImagePath) {
    const stepLabel = extractStepLabelFromPath(diff.currentImagePath);
    if (stepLabel) {
      const planned = await queries.getPlannedScreenshotByTest(diff.testId, stepLabel);
      if (planned) {
        plannedImagePath = planned.imagePath;
      }
    }
  }

  return {
    ...diff,
    plannedImagePath,
    plannedDiffImagePath,
    plannedPixelDifference,
    plannedPercentageDifference,
    errorMessage,
    a11yViolations: a11yViolations ?? null,
    consoleErrors,
    networkRequests,
    networkBodiesPath,
    test: test ?? null,
  };
}
