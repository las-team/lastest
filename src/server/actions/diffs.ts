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
import { awardScore } from '@/server/actions/gamification';
import { buildVisualDiffIssue, createVisualDiffIssue } from '@/lib/integrations/github-issues';

// Cross-team protection: ignore/focus regions are scoped to (testId, stepLabel),
// but the test row already pins the owning repository. Verify the caller's team
// owns that repo before any mutation — `requireTeamAccess` only proves a team
// exists, not that it owns this particular test.
async function requireTestOwnership(testId: string) {
  const session = await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) throw new Error('Test not found');
  if (!test.repositoryId) throw new Error('Forbidden: Test has no repository');
  const repo = await queries.getRepository(test.repositoryId);
  if (!repo || repo.teamId !== session.team.id) {
    throw new Error('Forbidden: Test does not belong to your team');
  }
  return { session, test, repo };
}

async function requireDiffOwnership(diffId: string) {
  const session = await requireTeamAccess();
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) throw new Error('Diff not found');
  const test = await queries.getTest(diff.testId);
  if (!test || !test.repositoryId) throw new Error('Forbidden: Diff has no repository');
  const repo = await queries.getRepository(test.repositoryId);
  if (!repo || repo.teamId !== session.team.id) {
    throw new Error('Forbidden: Diff does not belong to your team');
  }
  return { session, diff, test, repo };
}

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

export async function approveDiff(diffId: string, approvedBy?: string) {
  const session = await requireTeamAccess();
  // Snapshot the diff BEFORE approval so we can see its classification.
  const diffBefore = await queries.getVisualDiff(diffId);
  const result = await approveDiffCore(diffId, approvedBy);

  // Gamification: reward the approver for a real change, and credit the test's
  // creator with catching a regression. Only fires when classification='changed'
  // so auto-approved or flaky diffs don't generate awards. Idempotent on diffId.
  if (session.team && diffBefore && diffBefore.status === 'pending') {
    awardScore({
      teamId: session.team.id,
      kind: 'diff_approved_as_change',
      actor: { kind: 'user', id: session.user.id },
      sourceType: 'diff',
      sourceId: diffId,
      detail: { testId: diffBefore.testId },
    }).catch((err) => console.error('[gamification] diff_approved_as_change failed', err));

    queries
      .getTestCreator(diffBefore.testId)
      .then((creator) => {
        if (!creator) return;
        awardScore({
          teamId: session.team.id,
          kind: 'regression_caught',
          actor: creator,
          sourceType: 'diff',
          sourceId: diffId,
          detail: { testId: diffBefore.testId },
        }).catch((err) => console.error('[gamification] regression_caught failed', err));
      })
      .catch(() => {});
  }

  return result;
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

export async function rejectDiff(diffId: string) {
  await requireTeamAccess();
  return rejectDiffCore(diffId);
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

export async function approveAllDiffs(buildId: string, approvedBy?: string) {
  await requireTeamAccess();
  return approveAllDiffsCore(buildId, approvedBy);
}

/**
 * Test-level "Promote latest run as baseline" — approves every pending diff
 * for one test result. Wraps the same logic as the build-page Approve All
 * button but scoped to a single run. See mwhis review #21.
 */
export async function promoteTestResultBaselines(testResultId: string, approvedBy?: string) {
  await requireTeamAccess();
  const diffs = await queries.getVisualDiffsByTestResult(testResultId);
  const pending = diffs.filter(d => d.status !== 'approved' && d.status !== 'auto_approved');
  for (const d of pending) {
    await approveDiffCore(d.id, approvedBy);
  }
  revalidatePath('/tests');
  return { approvedCount: pending.length };
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

export async function batchApproveDiffs(diffIds: string[], approvedBy?: string) {
  await requireTeamAccess();
  return batchApproveDiffsCore(diffIds, approvedBy);
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

export async function batchRejectDiffs(diffIds: string[]) {
  await requireTeamAccess();
  return batchRejectDiffsCore(diffIds);
}

/**
 * Get diffs for a build (raw, unordered)
 */
export async function getDiffsByBuild(buildId: string) {
  await requireTeamAccess();
  return queries.getVisualDiffsByBuild(buildId);
}

/**
 * Get diffs for a build sorted by test/step for navigation.
 * Failed/changed/flaky tests first, then by test name → step label (natural sort).
 */
export async function getSortedDiffsByBuild(buildId: string) {
  await requireTeamAccess();
  const diffs = await queries.getVisualDiffsWithTestStatus(buildId);

  // Per-test tier: tier 0 if any diff in test is failed/rejected
  const testTiers = new Map<string, number>();
  for (const d of diffs) {
    const tier = d.testResultStatus === 'failed' || d.status === 'rejected' ? 0
      : d.status === 'pending' && d.testResultStatus !== 'failed' ? 1
      : 2;
    const prev = testTiers.get(d.testId) ?? 2;
    if (tier < prev) testTiers.set(d.testId, tier);
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  return diffs.sort((a, b) => {
    const tierDiff = (testTiers.get(a.testId) ?? 2) - (testTiers.get(b.testId) ?? 2);
    if (tierDiff !== 0) return tierDiff;
    const nameCmp = (a.testName || '').localeCompare(b.testName || '');
    if (nameCmp !== 0) return nameCmp;
    return collator.compare(a.stepLabel || '', b.stepLabel || '');
  });
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

export async function getDiff(diffId: string) {
  await requireTeamAccess();
  return getDiffCore(diffId);
}

/**
 * Multi-layer step comparison for a visual diff (v1.13). Returns null when
 * no comparison was scored — usually because there was no prior run to diff
 * against. Authenticated; visual-diff ownership is implicit via getDiff.
 */
export async function getMultiLayerComparisonForDiff(diffId: string) {
  await requireTeamAccess();
  const comparison = await queries.getStepComparisonByVisualDiff(diffId);
  return comparison ?? null;
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
 * Add an ignore region to a test step
 */
export async function addIgnoreRegion(
  testId: string,
  stepLabel: string | null,
  region: { x: number; y: number; width: number; height: number },
  reason?: string
) {
  await requireTestOwnership(testId);
  return queries.createIgnoreRegion({
    testId,
    stepLabel,
    ...region,
    reason,
  });
}

/**
 * Remove an ignore region
 */
export async function removeIgnoreRegion(regionId: string) {
  const session = await requireTeamAccess();
  const region = await queries.getIgnoreRegionById(regionId);
  if (!region) throw new Error('Ignore region not found');
  const test = await queries.getTest(region.testId);
  if (!test?.repositoryId) throw new Error('Forbidden: Region has no repository');
  const repo = await queries.getRepository(test.repositoryId);
  if (!repo || repo.teamId !== session.team.id) {
    throw new Error('Forbidden: Ignore region does not belong to your team');
  }
  await queries.deleteIgnoreRegion(regionId);
  return { success: true };
}

/**
 * Get ignore regions for a test step
 */
export async function getIgnoreRegions(testId: string, stepLabel: string | null) {
  await requireTestOwnership(testId);
  return queries.getIgnoreRegions(testId, stepLabel);
}

/**
 * Add an ignore region from the diff page. Resolves (testId, stepLabel) from
 * the diff, then triggers recalculation so the UI reflects the new mask
 * immediately. Ignore regions are per-step — only this diff is affected.
 */
export async function addIgnoreRegionForDiff(
  diffId: string,
  region: { x: number; y: number; width: number; height: number },
  reason?: string,
) {
  const { diff } = await requireDiffOwnership(diffId);

  const created = await queries.createIgnoreRegion({
    testId: diff.testId,
    stepLabel: diff.stepLabel ?? null,
    ...region,
    reason,
  });

  await recalculateDiff(diffId, diff.stepLabel ?? null);
  return created;
}

/**
 * Remove an ignore region. Triggers recalculation for the owning diff
 * if one is provided so the UI updates in-place.
 */
export async function removeIgnoreRegionForDiff(regionId: string, diffId?: string) {
  const session = await requireTeamAccess();
  const region = await queries.getIgnoreRegionById(regionId);
  if (!region) throw new Error('Ignore region not found');
  const test = await queries.getTest(region.testId);
  if (!test?.repositoryId) throw new Error('Forbidden: Region has no repository');
  const repo = await queries.getRepository(test.repositoryId);
  if (!repo || repo.teamId !== session.team.id) {
    throw new Error('Forbidden: Ignore region does not belong to your team');
  }
  await queries.deleteIgnoreRegion(regionId);
  if (diffId) {
    const diff = await queries.getVisualDiff(diffId);
    if (diff && diff.testId === region.testId) {
      await recalculateDiff(diffId, diff.stepLabel ?? null);
    }
  }
  return { success: true };
}

/**
 * Get ignore regions for this diff's specific (testId, stepLabel).
 */
export async function getIgnoreRegionsForDiff(diffId: string) {
  const { diff } = await requireDiffOwnership(diffId);
  return queries.getIgnoreRegions(diff.testId, diff.stepLabel ?? null);
}

/**
 * Add a focus region to a specific (testId, stepLabel) screenshot.
 * Focus regions define a positive mask — only pixels inside any focus rect participate
 * in the diff. Without focus regions, the whole image is checked (default behavior).
 * Triggers a recalculation of the diff so the UI reflects the new mask immediately.
 */
export async function addFocusRegion(
  diffId: string,
  region: { x: number; y: number; width: number; height: number },
) {
  const { diff } = await requireDiffOwnership(diffId);

  const created = await queries.createFocusRegion({
    testId: diff.testId,
    stepLabel: diff.stepLabel ?? null,
    ...region,
  });

  await recalculateDiff(diffId, diff.stepLabel ?? null);
  return created;
}

/**
 * Remove a focus region by id. Triggers recalculation for the owning diff
 * if one is provided so the UI updates in-place.
 */
export async function removeFocusRegion(regionId: string, diffId?: string) {
  const session = await requireTeamAccess();
  const region = await queries.getFocusRegionById(regionId);
  if (!region) throw new Error('Focus region not found');
  const test = await queries.getTest(region.testId);
  if (!test?.repositoryId) throw new Error('Forbidden: Region has no repository');
  const repo = await queries.getRepository(test.repositoryId);
  if (!repo || repo.teamId !== session.team.id) {
    throw new Error('Forbidden: Focus region does not belong to your team');
  }
  await queries.deleteFocusRegion(regionId);
  if (diffId) {
    const diff = await queries.getVisualDiff(diffId);
    if (diff && diff.testId === region.testId) {
      await recalculateDiff(diffId, diff.stepLabel ?? null);
    }
  }
  return { success: true };
}

/**
 * Get focus regions for the (testId, stepLabel) owning this diff.
 */
export async function getFocusRegionsForDiff(diffId: string) {
  const { diff } = await requireDiffOwnership(diffId);
  return queries.getFocusRegions(diff.testId, diff.stepLabel ?? null);
}

/**
 * List all focus regions for a test, across every stepLabel.
 * Used by the test-detail criteria tab to show which screenshots are restricted.
 */
export async function listFocusRegionsByTest(testId: string) {
  await requireTestOwnership(testId);
  return queries.getFocusRegionsByTest(testId);
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
 * Submit the current diff as an issue in the team's configured issue tracker.
 * Idempotent: if an issue was already created for this diff, returns the
 * existing URL instead of opening a duplicate.
 */
export async function submitDiffAsIssue(
  diffId: string,
): Promise<{ success: boolean; issueUrl?: string; alreadyExists?: boolean; error?: string }> {
  const session = await requireTeamAccess();

  const diff = await queries.getVisualDiff(diffId);
  if (!diff) return { success: false, error: 'Diff not found' };

  // Idempotency: don't double-submit
  if (diff.issueUrl) {
    return { success: true, issueUrl: diff.issueUrl, alreadyExists: true };
  }

  // Resolve repo + branch + commit via build → testRun
  const build = diff.buildId ? await queries.getBuild(diff.buildId) : null;
  const testRun = build?.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repositoryId = testRun?.repositoryId || null;
  const repo = repositoryId ? await queries.getRepository(repositoryId) : null;
  if (!repo) return { success: false, error: 'Repository not found for this diff' };

  // Tenant check — same pattern as requireRepoAccess but inline so we can
  // surface a friendlier error instead of throwing.
  if (repo.teamId !== session.team.id) {
    return { success: false, error: 'Forbidden: repository does not belong to your team' };
  }

  // Resolve provider preference. Per-repo first, then global.
  const notif = await queries.getNotificationSettings(repo.id);
  const provider = notif.issueTrackerProvider || 'github';

  if (provider !== 'github') {
    return { success: false, error: `Issue tracker "${provider}" is not yet supported. Switch to GitHub in Settings.` };
  }

  if (repo.provider !== 'github' || !repo.owner || !repo.name) {
    return { success: false, error: 'This repository is not linked to GitHub. Connect a GitHub repository in Settings.' };
  }

  const ghAccount = await queries.getGithubAccountByTeam(session.team.id);
  if (!ghAccount?.accessToken) {
    return { success: false, error: 'GitHub is not connected for this team. Connect it in Settings.' };
  }

  // Enrich with test + test result context for the issue body
  const test = await queries.getTest(diff.testId);
  const functionalArea = test?.functionalAreaId
    ? await queries.getFunctionalArea(test.functionalAreaId)
    : null;
  let errorMessage: string | null = null;
  let consoleErrors: string[] | null = null;
  let a11yViolations: import('@/lib/db/schema').A11yViolation[] | null = null;
  if (diff.testResultId) {
    const tr = await queries.getTestResultById(diff.testResultId);
    errorMessage = tr?.errorMessage ?? null;
    consoleErrors = tr?.consoleErrors ?? null;
    a11yViolations = tr?.a11yViolations ?? null;
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_BASE_URL ||
    'http://localhost:3000';

  const payload = buildVisualDiffIssue({
    diff: { ...diff, errorMessage, consoleErrors, a11yViolations },
    test: test ? { name: test.name } : null,
    functionalAreaName: functionalArea?.name ?? null,
    build: { id: diff.buildId },
    branch: testRun?.gitBranch ?? null,
    commit: testRun?.gitCommit ?? null,
    repoFullName: repo.fullName,
    reporterEmail: session.user.email,
    baseUrl,
  });

  const result = await createVisualDiffIssue(
    ghAccount.accessToken,
    repo.owner,
    repo.name,
    payload,
  );

  if (!result.success || !result.issueUrl) {
    return { success: false, error: result.error || 'Failed to create GitHub issue' };
  }

  await queries.setDiffIssue(diffId, result.issueUrl, 'github');

  revalidatePath('/builds');
  if (diff.buildId) {
    revalidatePath(`/builds/${diff.buildId}`);
    revalidatePath(`/builds/${diff.buildId}/diff/${diffId}`);
  }

  return { success: true, issueUrl: result.issueUrl };
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

  // Gamification: reward the reviewer for triaging, and credit the test's
  // creator with catching a regression. Idempotent on diffId.
  if (session.team) {
    awardScore({
      teamId: session.team.id,
      kind: 'diff_approved_as_change',
      actor: { kind: 'user', id: session.user.id },
      sourceType: 'diff',
      sourceId: diffId,
      detail: { testId: diff.testId },
    }).catch((err) => console.error('[gamification] diff_todo_triage failed', err));

    queries
      .getTestCreator(diff.testId)
      .then((creator) => {
        if (!creator) return;
        awardScore({
          teamId: session.team.id,
          kind: 'regression_caught',
          actor: creator,
          sourceType: 'diff',
          sourceId: diffId,
          detail: { testId: diff.testId },
        }).catch((err) => console.error('[gamification] regression_caught_todo failed', err));
      })
      .catch(() => {});
  }

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

  await recalculateDiff(diffId, newStepLabel);
  return { success: true, changed: true };
}

/**
 * Re-run diff for a given (diffId, stepLabel) using current ignore + focus regions.
 * Used by step-label rename, focus-region add/remove, and any other mutation that
 * invalidates the current diff result without changing the underlying screenshot.
 * Caller is responsible for auth; this function re-fetches baselines, settings, and
 * masks, then persists the new diff result and build status.
 */
async function recalculateDiff(diffId: string, stepLabel: string | null): Promise<void> {
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) throw new Error('Diff not found');

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

  // Fetch per-step ignore + focus regions for this screenshot
  const stepIgnoreRegions = await queries.getIgnoreRegions(diff.testId, stepLabel);
  const ignoreRects: Rectangle[] | undefined = stepIgnoreRegions.length > 0
    ? stepIgnoreRegions.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
    : undefined;
  const stepFocusRegions = await queries.getFocusRegions(diff.testId, stepLabel);
  const focusRects: Rectangle[] | undefined = stepFocusRegions.length > 0
    ? stepFocusRegions.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
    : undefined;

  // Look up baseline: branch-specific first, then fallback to default branch
  const baseline =
    await queries.getBranchBaseline(diff.testId, stepLabel, branch) ??
    await queries.getActiveBaseline(diff.testId, stepLabel, branch, defaultBranch);

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
      focusRects,
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
      stepLabel,
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
      stepLabel,
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
}
