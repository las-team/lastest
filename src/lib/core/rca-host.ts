import "server-only";

import type {
  RcaChangeMap,
  RcaHost,
  RcaVisualDiff,
} from "@lastest/plugin-rca/host";
import type { DiffMetadata } from "@lastest/eb-protocol";

import { resolveRepoIdForBuild } from "@/lib/change-map/compute";
import * as queries from "@/lib/db/queries";

/**
 * The app's fill for `RcaHost`.
 *
 * Six thin adapters over the existing query layer. Nothing here is new
 * behaviour — each method is the call the pre-plugin `src/lib/rca/run.ts` made
 * inline, moved to the one side of the boundary that is allowed to make it.
 *
 * `getTestAreaIds` is the only one that is not a pass-through, and it is the
 * point of the whole exercise: it replaces a raw
 * `db.select().from(tests).where(inArray(...))` that used to sit in feature
 * code, which is what `pnpm arch` counted as the `rca::db` violation.
 */
export const appRcaHost: RcaHost = {
  async listBuildVisualDiffs(buildId: string): Promise<RcaVisualDiff[]> {
    const diffs = await queries.getVisualDiffsByBuild(buildId);
    return diffs.map((d) => ({
      id: d.id,
      testId: d.testId,
      metadata: d.metadata,
      classification: d.classification,
      pixelDifference: d.pixelDifference,
      percentageDifference: d.percentageDifference,
    }));
  },

  async getBuildChangeMap(buildId: string): Promise<RcaChangeMap | null> {
    return (await queries.getBuildChangeMap(buildId)) ?? null;
  },

  async getTestAreaIds(testIds: string[]): Promise<Map<string, string | null>> {
    if (!testIds.length) return new Map();
    const rows = await queries.getTestFunctionalAreaIds(testIds);
    return new Map(rows.map((t) => [t.id, t.areaId]));
  },

  async getTestsWithAnyPassedResult(testIds: string[]): Promise<Set<string>> {
    return queries.getTestsWithAnyPassedResult(testIds);
  },

  async updateDiffMetadata(
    diffId: string,
    metadata: DiffMetadata,
  ): Promise<void> {
    await queries.updateVisualDiff(diffId, { metadata });
  },

  async resolveRepoIdForBuild(buildId: string): Promise<string | null> {
    return resolveRepoIdForBuild(buildId);
  },
};
