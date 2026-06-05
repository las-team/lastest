/**
 * Build-level Change Map queries (Verify phase, v1.14+).
 *
 * One row per build, computed once at build completion and cached.
 */

import { db } from "../index";
import { buildChangeMaps } from "../schema";
import type { ChangeMap } from "../schema";
import { eq } from "drizzle-orm";

export async function getBuildChangeMap(
  buildId: string,
): Promise<ChangeMap | null> {
  const [row] = await db
    .select()
    .from(buildChangeMaps)
    .where(eq(buildChangeMaps.buildId, buildId));
  return row?.payload ?? null;
}

export async function upsertBuildChangeMap(
  buildId: string,
  payload: ChangeMap,
): Promise<void> {
  const computedAt = new Date();
  await db
    .insert(buildChangeMaps)
    .values({ buildId, payload, computedAt })
    .onConflictDoUpdate({
      target: buildChangeMaps.buildId,
      set: { payload, computedAt },
    });
}

export async function deleteBuildChangeMap(buildId: string): Promise<void> {
  await db.delete(buildChangeMaps).where(eq(buildChangeMaps.buildId, buildId));
}
