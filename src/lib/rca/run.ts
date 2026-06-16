/**
 * RCA build pass — classify every changed visual diff in a build as TEST or
 * CODE and persist the verdict into `DiffMetadata.rca`.
 *
 * Runs AFTER the build's Change Map is computed (the code signal lives there),
 * as a best-effort post-build step chained off build finalization. Idempotent:
 * safe to re-run; each call recomputes from the latest stored signals.
 *
 * NOT a server action — invoked only from trusted server contexts (build
 * finalization, the ownership-checked recompute action).
 */

import * as queries from "@/lib/db/queries";
import { db } from "@/lib/db";
import { tests } from "@/lib/db/schema";
import type { DiffMetadata } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { classifyDiffSource } from "@/lib/rca/classify";
import { correlateRegions } from "@/lib/rca/correlate";

/** Classify the build's changed diffs. Returns how many were classified. */
export async function classifyBuildDiffs(buildId: string): Promise<number> {
  const diffs = await queries.getVisualDiffsByBuild(buildId);
  // Only diffs that actually changed are worth attributing; unchanged/0-diff
  // rows have nothing to explain.
  const changed = diffs.filter(
    (d) => d.classification !== "unchanged" && (d.pixelDifference ?? 0) > 0,
  );
  if (!changed.length) return 0;

  const changeMap = await queries.getBuildChangeMap(buildId);

  // Resolve testId → functional area in one query so the classifier can match
  // the diff's surface against the Change Map's code-flagged areas.
  const testIds = [...new Set(changed.map((d) => d.testId))];
  const testRows = testIds.length
    ? await db
        .select({ id: tests.id, areaId: tests.functionalAreaId })
        .from(tests)
        .where(inArray(tests.id, testIds))
    : [];
  const areaByTest = new Map(testRows.map((t) => [t.id, t.areaId]));

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
      await queries.updateVisualDiff(d.id, { metadata });
      count++;
    } catch (e) {
      console.error(`[rca] failed to classify diff ${d.id}:`, e);
    }
  }
  return count;
}
