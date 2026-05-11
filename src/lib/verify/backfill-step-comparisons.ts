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

  // Dedupe by (testResultId, stepLabel) so a re-run only fills missing
  // step rows, never duplicates existing ones. stepLabel=null collapses to
  // the literal sentinel "__none__" so the null case has a stable key.
  const stepKey = (testResultId: string | null, stepLabel: string | null) =>
    `${testResultId ?? '__null__'}::${stepLabel ?? '__none__'}`;
  const haveByResultStep = new Set<string>();
  for (const s of existing) haveByResultStep.add(stepKey(s.testResultId, s.stepLabel));

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const tr of testResults) {
    if (!tr.testId) { skipped++; continue; }

    try {
      const [visualDiffs, prevResult] = await Promise.all([
        queries.getVisualDiffsByTestResult(tr.id),
        queries.getPreviousTestResultForTest(tr.testId, build.testRunId),
      ]);

      // Group visual diffs by stepLabel. Each group becomes one
      // step_comparison row — multi-step tests surface as one card per
      // step. Empty visual_diffs still produces ONE null-step row so
      // executor-failed tests with no screenshots still show up.
      const byStep = new Map<string | null, typeof visualDiffs>();
      for (const d of visualDiffs) {
        const key = d.stepLabel ?? null;
        if (!byStep.has(key)) byStep.set(key, []);
        byStep.get(key)!.push(d);
      }
      if (byStep.size === 0) byStep.set(null, []);

      const baselinePayload = prevResult ? {
        consoleErrors: prevResult.consoleErrors ?? null,
        networkRequests: prevResult.networkRequests ?? null,
        a11yViolations: prevResult.a11yViolations ?? null,
        urlTrajectory: prevResult.urlTrajectory ?? null,
        webVitals: prevResult.webVitals ?? null,
        extractedVariables: prevResult.extractedVariables ?? null,
      } : null;
      const currentPayload = {
        consoleErrors: tr.consoleErrors ?? null,
        networkRequests: tr.networkRequests ?? null,
        a11yViolations: tr.a11yViolations ?? null,
        urlTrajectory: tr.urlTrajectory ?? null,
        webVitals: tr.webVitals ?? null,
        extractedVariables: tr.extractedVariables ?? null,
      };

      for (const [stepLabel, groupDiffs] of byStep) {
        if (haveByResultStep.has(stepKey(tr.id, stepLabel))) {
          skipped++;
          continue;
        }
        // Multiple diffs in one stepLabel group (rare: multi-browser,
        // retries) — largest pixel delta wins as the canonical visual.
        const primary = groupDiffs
          .slice()
          .sort((a, b) => (b.pixelDifference ?? 0) - (a.pixelDifference ?? 0))[0];

        const verdict = scoreMultiLayer({
          baseline: baselinePayload,
          current: currentPayload,
          visualDiff: primary ? {
            pixelDifference: primary.pixelDifference ?? 0,
            percentageDifference: primary.percentageDifference,
            id: primary.id,
          } : null,
        });

        await queries.createStepComparison({
          buildId,
          testId: tr.testId,
          testResultId: tr.id,
          visualDiffId: primary?.id ?? null,
          stepIndex: null,
          stepLabel,
          verdict: verdict.verdict,
          evidence: verdict.evidence,
          layers: verdict.layers,
        });
        created++;
      }
    } catch (err) {
      console.error('[verify-backfill] failed to score', { testResultId: tr.id, err: err instanceof Error ? err.message : String(err) });
      failed++;
    }
  }

  return { created, skipped, failed };
}
