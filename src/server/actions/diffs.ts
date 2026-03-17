'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess } from '@/lib/auth';
import { hashImageWithDimensions } from '@/lib/diff/hasher';
import { generateDiff, type Rectangle } from '@/lib/diff/generator';
import type { DiffEngineType, RegionDetectionMode } from '@/lib/db/schema';
import fs from 'fs';
import path from 'path';
import { STORAGE_ROOT, STORAGE_DIRS, toRelativePath } from '@/lib/storage/paths';

/**
 * Approve a single visual diff
 */
export async function approveDiff(diffId: string, approvedBy?: string) {
  await requireTeamAccess();
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
 * Reject a visual diff
 */
export async function rejectDiff(diffId: string) {
  await requireTeamAccess();
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
  await requireTeamAccess();
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
  await requireTeamAccess();
  for (const diffId of diffIds) {
    await approveDiff(diffId, approvedBy);
  }

  revalidatePath('/builds');

  return { approvedCount: diffIds.length };
}

/**
 * Batch reject selected diffs
 */
export async function batchRejectDiffs(diffIds: string[]) {
  await requireTeamAccess();
  for (const diffId of diffIds) {
    await rejectDiff(diffId);
  }

  revalidatePath('/builds');

  return { rejectedCount: diffIds.length };
}

/**
 * Get diffs for a build
 */
export async function getDiffsByBuild(buildId: string) {
  await requireTeamAccess();
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
  await requireTeamAccess();
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) return null;

  // Get test details
  const test = await queries.getTest(diff.testId);

  // Get error message and a11y violations from test result
  let errorMessage: string | null = null;
  let a11yViolations: import('@/lib/db/schema').A11yViolation[] | null = null;
  if (diff.testResultId) {
    const testResult = await queries.getTestResultById(diff.testResultId);
    errorMessage = testResult?.errorMessage ?? null;
    a11yViolations = testResult?.a11yViolations ?? null;
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
    test: test ?? null,
  };
}

/**
 * Get pending diffs count for a build
 */
export async function getPendingDiffsCount(buildId: string) {
  await requireTeamAccess();
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
  await requireTeamAccess();
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
  await requireTeamAccess();
  await queries.deleteIgnoreRegion(regionId);
  return { success: true };
}

/**
 * Get ignore regions for a test
 */
export async function getIgnoreRegions(testId: string) {
  await requireTeamAccess();
  return queries.getIgnoreRegions(testId);
}

/**
 * Undo an approval (revert to pending)
 */
export async function undoApproval(diffId: string) {
  await requireTeamAccess();
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
  await requireTeamAccess();
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
  await requireTeamAccess();
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
  await requireTeamAccess();
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
 * Add a todo to a diff (replaces reject workflow)
 */
export async function addDiffTodo(diffId: string, description: string) {
  const session = await requireTeamAccess();
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) throw new Error('Diff not found');

  // Set diff status to 'todo'
  await queries.updateVisualDiff(diffId, { status: 'todo' });

  // Resolve branch + repo from build → test run
  const build = diff.buildId ? await queries.getBuild(diff.buildId) : null;
  const buildTestRun = build?.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const branch = buildTestRun?.gitBranch || 'main';
  const repositoryId = buildTestRun?.repositoryId || null;

  // Create the review todo
  await queries.createReviewTodo({
    repositoryId,
    diffId,
    buildId: diff.buildId,
    testId: diff.testId,
    branch,
    description,
    status: 'open',
    createdBy: session.user?.email || 'user',
  });

  // Recompute build status
  if (diff.buildId) {
    const newStatus = await queries.computeBuildStatus(diff.buildId);
    await queries.updateBuild(diff.buildId, { overallStatus: newStatus });
  }

  revalidatePath('/builds');
  revalidatePath(`/builds/${diff.buildId}`);
  revalidatePath('/review');

  return { success: true };
}

/**
 * Batch add todos to selected diffs
 */
export async function batchAddDiffTodos(diffIds: string[], description: string) {
  await requireTeamAccess();
  for (const diffId of diffIds) {
    await addDiffTodo(diffId, description);
  }

  revalidatePath('/builds');
  revalidatePath('/review');

  return { todoCount: diffIds.length };
}

/**
 * Reject all pending diffs in a build
 */
export async function rejectAllDiffs(buildId: string) {
  await requireTeamAccess();
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
  await requireTeamAccess();
  return queries.getAIDiffSummaryForBuild(buildId);
}

/**
 * Get step label suggestions for a test (distinct active baseline step labels)
 */
export async function getStepLabelSuggestions(testId: string): Promise<string[]> {
  await requireTeamAccess();
  return queries.getStepLabelsForTest(testId);
}

/**
 * Update a diff's step label and re-diff against the matching baseline
 */
export async function updateStepLabelAndRediff(diffId: string, newStepLabel: string | null) {
  await requireTeamAccess();
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) throw new Error('Diff not found');

  // Short-circuit if label unchanged
  if ((diff.stepLabel ?? null) === (newStepLabel ?? null)) {
    return { success: true, changed: false };
  }

  // Resolve branch/repo context (same pattern as approveDiff)
  const testResult = diff.testResultId
    ? await queries.getTestResultById(diff.testResultId)
    : null;
  const testRun = testResult?.testRunId
    ? await queries.getTestRun(testResult.testRunId)
    : null;
  const branch = testRun?.gitBranch || 'main';
  const repositoryId = testRun?.repositoryId || null;
  const repo = repositoryId ? await queries.getRepository(repositoryId) : null;
  const defaultBranch = repo?.defaultBranch || 'main';

  // Get diff sensitivity settings
  const settings = await queries.getDiffSensitivitySettings(repositoryId);
  const unchangedThreshold = settings.unchangedThreshold ?? 1;
  const flakyThreshold = settings.flakyThreshold ?? 10;
  const includeAntiAliasing = settings.includeAntiAliasing ?? false;
  const ignorePageShift = settings.ignorePageShift ?? false;
  const diffEngine = (settings.diffEngine as DiffEngineType) ?? 'pixelmatch';
  const regionDetectionMode = (settings.regionDetectionMode as RegionDetectionMode) ?? 'grid';

  // Fetch ignore regions
  const testIgnoreRegions = await queries.getIgnoreRegions(diff.testId);
  const ignoreRects: Rectangle[] | undefined = testIgnoreRegions.length > 0
    ? testIgnoreRegions.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
    : undefined;

  // Look up baseline: branch-specific first, then fallback to default branch
  const baseline =
    await queries.getBranchBaseline(diff.testId, newStepLabel, branch) ??
    await queries.getActiveBaseline(diff.testId, newStepLabel, branch, defaultBranch);

  const baselineExists = baseline && fs.existsSync(path.join(STORAGE_ROOT, baseline.imagePath));
  const currentExists = diff.currentImagePath && fs.existsSync(path.join(STORAGE_ROOT, diff.currentImagePath));

  if (baselineExists && currentExists) {
    // Re-diff against found baseline
    const diffResult = await generateDiff(
      path.join(STORAGE_ROOT, baseline!.imagePath),
      path.join(STORAGE_ROOT, diff.currentImagePath!),
      STORAGE_DIRS.diffs,
      0.1,
      includeAntiAliasing,
      ignoreRects,
      ignorePageShift,
      diffEngine,
      regionDetectionMode,
    );

    const pct = diffResult.percentageDifference;
    let classification: 'unchanged' | 'flaky' | 'changed';
    if (pct < unchangedThreshold) {
      classification = 'unchanged';
    } else if (pct < flakyThreshold) {
      classification = 'flaky';
    } else {
      classification = 'changed';
    }

    // Strip absolute paths from aligned shift images
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

    await queries.updateVisualDiff(diffId, {
      stepLabel: newStepLabel,
      baselineImagePath: baseline.imagePath,
      diffImagePath: toRelativePath(diffResult.diffImagePath),
      pixelDifference: diffResult.pixelDifference,
      percentageDifference: diffResult.percentageDifference.toString(),
      classification,
      status: classification === 'unchanged' ? 'auto_approved' : 'pending',
      metadata,
    });
  } else {
    // No baseline found — mark as new screenshot
    await queries.updateVisualDiff(diffId, {
      stepLabel: newStepLabel,
      baselineImagePath: null,
      diffImagePath: null,
      pixelDifference: 0,
      percentageDifference: '0',
      classification: 'changed',
      status: 'pending',
      metadata: { changedRegions: [], isNewTest: true },
    });
  }

  // Recompute build status
  if (diff.buildId) {
    const newStatus = await queries.computeBuildStatus(diff.buildId);
    await queries.updateBuild(diff.buildId, { overallStatus: newStatus });
  }

  revalidatePath('/builds');
  if (diff.buildId) {
    revalidatePath(`/builds/${diff.buildId}`);
    revalidatePath(`/builds/${diff.buildId}/diff/${diffId}`);
  }

  return { success: true, changed: true };
}
