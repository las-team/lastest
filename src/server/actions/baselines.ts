'use server';

import * as queries from '@/lib/db/queries';

/**
 * Fork baselines from one branch to another.
 * Copies active baselines from source branch to target branch.
 * Shares image files (no file duplication).
 * Skips if target branch already has baselines for this repo.
 */
export async function forkBaselinesForBranch(
  repositoryId: string,
  fromBranch: string,
  toBranch: string
): Promise<{ forked: number; skipped: boolean }> {
  // Check if target branch already has baselines
  const existingBaselines = await queries.getBaselinesByBranch(repositoryId, toBranch);
  if (existingBaselines.length > 0) {
    return { forked: 0, skipped: true };
  }

  // Get all active baselines from source branch
  const sourceBaselines = await queries.getBaselinesByBranch(repositoryId, fromBranch);
  if (sourceBaselines.length === 0) {
    return { forked: 0, skipped: false };
  }

  // Copy each baseline to the new branch (share image files)
  let forked = 0;
  for (const baseline of sourceBaselines) {
    await queries.createBaseline({
      repositoryId: baseline.repositoryId,
      testId: baseline.testId,
      stepLabel: baseline.stepLabel,
      imagePath: baseline.imagePath, // Shared — no file duplication
      imageHash: baseline.imageHash,
      branch: toBranch,
      approvedFromDiffId: baseline.approvedFromDiffId,
    });
    forked++;
  }

  return { forked, skipped: false };
}

/**
 * Merge baselines from a feature branch to a target branch (e.g., on PR merge).
 * Only promotes baselines where the image hash differs from the target branch.
 * Deactivates old target baselines and creates new ones.
 */
export async function mergeBaselinesFromBranch(
  repositoryId: string,
  fromBranch: string,
  toBranch: string
): Promise<{ promoted: number; unchanged: number }> {
  const sourceBaselines = await queries.getBaselinesByBranch(repositoryId, fromBranch);
  const targetBaselines = await queries.getBaselinesByBranch(repositoryId, toBranch);

  // Build a lookup map for target baselines: key = testId:stepLabel
  const targetMap = new Map<string, typeof targetBaselines[0]>();
  for (const b of targetBaselines) {
    const key = `${b.testId}:${b.stepLabel || ''}`;
    targetMap.set(key, b);
  }

  let promoted = 0;
  let unchanged = 0;

  for (const source of sourceBaselines) {
    const key = `${source.testId}:${source.stepLabel || ''}`;
    const existing = targetMap.get(key);

    if (existing && existing.imageHash === source.imageHash) {
      // Identical — no promotion needed
      unchanged++;
      continue;
    }

    // Deactivate old target baseline and create new one
    await queries.deactivateBaselines(source.testId, source.stepLabel, toBranch);
    await queries.createBaseline({
      repositoryId: source.repositoryId,
      testId: source.testId,
      stepLabel: source.stepLabel,
      imagePath: source.imagePath,
      imageHash: source.imageHash,
      branch: toBranch,
      approvedFromDiffId: source.approvedFromDiffId,
    });
    promoted++;
  }

  return { promoted, unchanged };
}

/**
 * Cleanup branch-specific baselines after merge.
 * Deactivates all baselines for the given branch.
 */
export async function cleanupBranchBaselines(
  repositoryId: string,
  branch: string
): Promise<{ deactivated: number }> {
  const branchBaselines = await queries.getBaselinesByBranch(repositoryId, branch);

  for (const baseline of branchBaselines) {
    await queries.deactivateBaselines(baseline.testId, baseline.stepLabel, branch);
  }

  return { deactivated: branchBaselines.length };
}
