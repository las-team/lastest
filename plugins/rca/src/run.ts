/**
 * RCA build pass — classify every changed visual diff in a build as TEST or
 * CODE and persist the verdict into `DiffMetadata.rca`.
 *
 * Runs AFTER the build's Change Map is computed (the code signal lives there),
 * as a best-effort post-build step chained off build finalization. Idempotent:
 * safe to re-run; each call recomputes from the latest stored signals.
 *
 * NOT a server action — invoked only from trusted server contexts (build
 * finalization, the ownership-checked recompute action in `./actions.ts`).
 * Every read and write goes through the injected {@link RcaHost}; this module
 * holds no database handle, which is what the `rca::db` violation used to be.
 */

import type { DiffMetadata } from "@lastest/eb-protocol";

import { classifyDiffSource } from "./classify";
import { correlateRegions } from "./correlate";
import type { RcaHost } from "./host";

/** Classify the build's changed diffs. Returns how many were classified. */
export async function classifyBuildDiffs(
  host: RcaHost,
  buildId: string,
): Promise<number> {
  const diffs = await host.listBuildVisualDiffs(buildId);
  // Only diffs that actually changed are worth attributing; unchanged/0-diff
  // rows have nothing to explain.
  const changed = diffs.filter(
    (d) => d.classification !== "unchanged" && (d.pixelDifference ?? 0) > 0,
  );
  if (!changed.length) return 0;

  const changeMap = await host.getBuildChangeMap(buildId);

  // Resolve testId → functional area in one call so the classifier can match
  // the diff's surface against the Change Map's code-flagged areas.
  const testIds = [...new Set(changed.map((d) => d.testId))];
  const areaByTest = testIds.length
    ? await host.getTestAreaIds(testIds)
    : new Map<string, string | null>();

  // Which of these tests have ever executed successfully (a green run in their
  // history). A test with no passed result has no trustworthy baseline, so RCA
  // leans its diffs toward test-error.
  const everPassedTests = await host.getTestsWithAnyPassedResult(testIds);

  const now = new Date().toISOString();
  let count = 0;
  for (const d of changed) {
    try {
      const verdict = classifyDiffSource(
        {
          metadata: d.metadata,
          changeMap,
          testId: d.testId,
          areaId: areaByTest.get(d.testId) ?? null,
          percentageDifference: d.percentageDifference,
          everPassed: everPassedTests.has(d.testId),
        },
        now,
      );
      // Element-level region→cause mapping for the interactive RCA UI. Only
      // possible where a DOM diff was captured; otherwise stays empty.
      const regionCauses = correlateRegions({
        changedRegions: d.metadata?.changedRegions,
        domDiff: d.metadata?.domDiff,
      });
      const metadata: DiffMetadata = {
        ...(d.metadata ?? { changedRegions: [] }),
        rca: regionCauses.length ? { ...verdict, regionCauses } : verdict,
      };
      await host.updateDiffMetadata(d.id, metadata);
      count++;
    } catch (e) {
      console.error(`[rca] failed to classify diff ${d.id}:`, e);
    }
  }
  return count;
}
