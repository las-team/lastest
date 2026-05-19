'use server';

import * as queries from '@/lib/db/queries';

/**
 * Auto-approve "0-diff" verification cases at build completion.
 *
 * A step comparison with `verdict='green'` and no `evidence` items means the
 * test ran cleanly with no diff captured — equivalent to a passing verification.
 * To prevent these from sitting in the Done column with `0 layer decisions`,
 * we persist a `step_layer_feedback` row with `status='auto_approved'` for the
 * canonical 'visual' layer. That makes the verified-count tally up on the
 * board without requiring the reviewer to click through each one.
 *
 * Hard runner failures (status='failed' / 'setup_failed') are explicitly
 * skipped — they share the verdict='green' + no-evidence shape (failure
 * before any screenshot was captured), but they must surface as Broken
 * until a reviewer signs off, not be silently auto-verified.
 *
 * Idempotent: skips any step that already has feedback for the visual layer.
 */
export async function autoApproveZeroDiffCases(buildId: string): Promise<{ approved: number }> {
  const stepRows = await queries.getStepComparisonsByBuild(buildId);
  if (stepRows.length === 0) return { approved: 0 };

  // Pre-load failed test_result ids so we can drop them in one pass. Pulling
  // them via the build's testRunId keeps this to a single query regardless
  // of how many steps the build has.
  const build = await queries.getBuild(buildId).catch(() => null);
  const failedResultIds = new Set<string>();
  if (build?.testRunId) {
    const results = await queries.getTestResultsByRun(build.testRunId).catch(() => []);
    for (const r of results) {
      if (r.status === 'failed' || r.status === 'setup_failed') failedResultIds.add(r.id);
    }
  }

  let approved = 0;
  for (const step of stepRows) {
    if (step.verdict !== 'green') continue;
    if (step.evidence && step.evidence.length > 0) continue;
    if (step.testResultId && failedResultIds.has(step.testResultId)) continue;
    const existing = await queries.getLayerFeedback(step.id, 'visual').catch(() => null);
    if (existing) continue;
    await queries.upsertLayerFeedback({
      stepComparisonId: step.id,
      buildId,
      layer: 'visual',
      status: 'auto_approved',
      decidedBy: 'system:auto-approve-zero-diff',
    });
    approved++;
  }
  return { approved };
}
