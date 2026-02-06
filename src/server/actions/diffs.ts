'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { hashImage } from '@/lib/diff/hasher';
import path from 'path';

/**
 * Approve a single visual diff
 */
export async function approveDiff(diffId: string, approvedBy?: string) {
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) throw new Error('Diff not found');

  // Update diff status
  await queries.updateVisualDiff(diffId, {
    status: 'approved',
    approvedBy: approvedBy || 'user',
    approvedAt: new Date(),
  });

  // Update baseline with the approved image
  const currentHash = hashImage(
    path.join(process.cwd(), 'public', diff.currentImagePath)
  );

  // Get the test run to find the branch
  const testResult = diff.testResultId
    ? await queries.getTestResultsByRun(diff.testResultId).then((r) => r[0])
    : null;
  const testRun = testResult?.testRunId
    ? await queries.getTestRun(testResult.testRunId)
    : null;
  const branch = testRun?.gitBranch || 'main';

  // Deactivate old baselines and create new one (including stepLabel for multi-step tests)
  await queries.deactivateBaselines(diff.testId, diff.stepLabel);
  await queries.createBaseline({
    testId: diff.testId,
    stepLabel: diff.stepLabel,
    imagePath: diff.currentImagePath,
    imageHash: currentHash,
    branch,
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
 * Reject a visual diff
 */
export async function rejectDiff(diffId: string) {
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
 * Approve all pending diffs in a build
 */
export async function approveAllDiffs(buildId: string, approvedBy?: string) {
  const pendingDiffs = await queries.getPendingDiffsByBuild(buildId);

  for (const diff of pendingDiffs) {
    await approveDiff(diff.id, approvedBy);
  }

  revalidatePath('/builds');
  revalidatePath(`/builds/${buildId}`);

  return { approvedCount: pendingDiffs.length };
}

/**
 * Batch approve selected diffs
 */
export async function batchApproveDiffs(diffIds: string[], approvedBy?: string) {
  for (const diffId of diffIds) {
    await approveDiff(diffId, approvedBy);
  }

  revalidatePath('/builds');

  return { approvedCount: diffIds.length };
}

/**
 * Get diffs for a build
 */
export async function getDiffsByBuild(buildId: string) {
  return queries.getVisualDiffsByBuild(buildId);
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
 * Get a single diff with full details
 */
export async function getDiff(diffId: string) {
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) return null;

  // Get test details
  const test = await queries.getTest(diff.testId);

  // Look up planned screenshot if not already on the diff
  let plannedImagePath = diff.plannedImagePath;
  let plannedDiffImagePath = diff.plannedDiffImagePath;
  let plannedPixelDifference = diff.plannedPixelDifference;
  let plannedPercentageDifference = diff.plannedPercentageDifference;

  if (!plannedImagePath) {
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
    test: test ?? null,
  };
}

/**
 * Get pending diffs count for a build
 */
export async function getPendingDiffsCount(buildId: string) {
  const pending = await queries.getPendingDiffsByBuild(buildId);
  return pending.length;
}

/**
 * Add an ignore region to a test
 */
export async function addIgnoreRegion(
  testId: string,
  region: { x: number; y: number; width: number; height: number },
  reason?: string
) {
  return queries.createIgnoreRegion({
    testId,
    ...region,
    reason,
  });
}

/**
 * Remove an ignore region
 */
export async function removeIgnoreRegion(regionId: string) {
  await queries.deleteIgnoreRegion(regionId);
  return { success: true };
}

/**
 * Get ignore regions for a test
 */
export async function getIgnoreRegions(testId: string) {
  return queries.getIgnoreRegions(testId);
}

/**
 * Undo an approval (revert to pending)
 */
export async function undoApproval(diffId: string) {
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) throw new Error('Diff not found');

  // Only allow undo of recently approved diffs
  if (diff.status !== 'approved') {
    throw new Error('Can only undo approved diffs');
  }

  await queries.updateVisualDiff(diffId, {
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
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
 * Accept all diffs where AI recommends 'approve' and status is still 'pending'
 */
export async function acceptAIApprovals(buildId: string, approvedBy?: string) {
  const approvable = await queries.getPendingAIApprovableDiffs(buildId);

  for (const diff of approvable) {
    await approveDiff(diff.id, approvedBy || 'ai-recommendation');
  }

  revalidatePath('/builds');
  revalidatePath(`/builds/${buildId}`);

  return { approvedCount: approvable.length };
}

/**
 * Accept selected AI-recommended diffs
 */
export async function acceptSelectedAIApprovals(diffIds: string[], approvedBy?: string) {
  for (const diffId of diffIds) {
    await approveDiff(diffId, approvedBy || 'ai-recommendation');
  }

  revalidatePath('/builds');

  return { approvedCount: diffIds.length };
}

/**
 * Discard AI recommendations for all diffs in a build (keeps status unchanged)
 */
export async function discardAIRecommendations(buildId: string) {
  const diffs = await queries.getVisualDiffsByBuild(buildId);

  for (const diff of diffs) {
    if (diff.aiRecommendation || diff.aiAnalysis) {
      await queries.updateVisualDiff(diff.id, {
        aiRecommendation: null,
        aiAnalysis: null,
        aiAnalysisStatus: null,
      });
    }
  }

  revalidatePath('/builds');
  revalidatePath(`/builds/${buildId}`);

  return { success: true };
}

/**
 * Reject all pending diffs in a build
 */
export async function rejectAllDiffs(buildId: string) {
  const pendingDiffs = await queries.getPendingDiffsByBuild(buildId);

  for (const diff of pendingDiffs) {
    await rejectDiff(diff.id);
  }

  revalidatePath('/builds');
  revalidatePath(`/builds/${buildId}`);

  return { rejectedCount: pendingDiffs.length };
}

/**
 * Get AI diff summary counts for a build
 */
export async function getAIDiffSummary(buildId: string) {
  return queries.getAIDiffSummaryForBuild(buildId);
}
