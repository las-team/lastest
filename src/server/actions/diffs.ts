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
 * Get a single diff with full details
 */
export async function getDiff(diffId: string) {
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) return null;

  // Get test details
  const test = await queries.getTest(diff.testId);

  return {
    ...diff,
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
