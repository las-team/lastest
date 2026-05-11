/**
 * Verify phase (v1.14+) — recovery path.
 *
 * runBuildAsync's onResult writes a step_comparison row per test_result as
 * each test finishes. When the build crashes mid-flight (overall_status =
 * 'blocked' with results landed) the per-result block can leave a partial
 * or empty set of step_comparisons — and without those rows, /verify/<id>
 * has nothing to render.
 *
 * This module rebuilds step_comparisons from data we already have: the
 * persisted test_results + visual_diffs. It's idempotent (re-running on a
 * build that already has full coverage is a no-op) and best-effort
 * (per-test failures don't block siblings). Called by the verify page on
 * demand when stepComparisons is empty but test_results are not.
 */

import * as queries from '@/lib/db/queries';
import { scoreMultiLayer } from '@/lib/comparison/scorer';

export interface BackfillResult {
  created: number;
  skipped: number;
  failed: number;
}

export async function ensureStepComparisonsForBuild(buildId: string): Promise<BackfillResult> {
  const build = await queries.getBuild(buildId);
  if (!build?.testRunId) return { created: 0, skipped: 0, failed: 0 };

  const [existing, testResults] = await Promise.all([
    queries.getStepComparisonsByBuild(buildId),
    queries.getTestResultsByRun(build.testRunId),
  ]);

  // Index existing rows by testResultId so we only fill gaps.
  const haveByResult = new Set<string>();
  for (const s of existing) if (s.testResultId) haveByResult.add(s.testResultId);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const tr of testResults) {
    if (!tr.testId) { skipped++; continue; }
    if (haveByResult.has(tr.id)) { skipped++; continue; }

    try {
      const [visualDiffs, prevResult] = await Promise.all([
        queries.getVisualDiffsByTestResult(tr.id),
        queries.getPreviousTestResultForTest(tr.testId, build.testRunId),
      ]);

      // Match runBuildAsync's choice: the diff with the largest pixel delta
      // wins as the primary visual signal. Keeps verdicts consistent with
      // builds that scored at execution time.
      const primaryVisual = visualDiffs
        .slice()
        .sort((a, b) => (b.pixelDifference ?? 0) - (a.pixelDifference ?? 0))[0];

      const verdict = scoreMultiLayer({
        baseline: prevResult ? {
          consoleErrors: prevResult.consoleErrors ?? null,
          networkRequests: prevResult.networkRequests ?? null,
          a11yViolations: prevResult.a11yViolations ?? null,
          urlTrajectory: prevResult.urlTrajectory ?? null,
          webVitals: prevResult.webVitals ?? null,
          extractedVariables: prevResult.extractedVariables ?? null,
        } : null,
        current: {
          consoleErrors: tr.consoleErrors ?? null,
          networkRequests: tr.networkRequests ?? null,
          a11yViolations: tr.a11yViolations ?? null,
          urlTrajectory: tr.urlTrajectory ?? null,
          webVitals: tr.webVitals ?? null,
          extractedVariables: tr.extractedVariables ?? null,
        },
        visualDiff: primaryVisual ? {
          pixelDifference: primaryVisual.pixelDifference ?? 0,
          percentageDifference: primaryVisual.percentageDifference,
          id: primaryVisual.id,
        } : null,
      });

      await queries.createStepComparison({
        buildId,
        testId: tr.testId,
        testResultId: tr.id,
        visualDiffId: primaryVisual?.id ?? null,
        stepIndex: null,
        stepLabel: primaryVisual?.stepLabel ?? null,
        verdict: verdict.verdict,
        evidence: verdict.evidence,
        layers: verdict.layers,
      });
      created++;
    } catch (err) {
      console.error('[verify-backfill] failed to score', { testResultId: tr.id, err: err instanceof Error ? err.message : String(err) });
      failed++;
    }
  }

  return { created, skipped, failed };
}
