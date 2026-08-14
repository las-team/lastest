import { eq, inArray } from "drizzle-orm";

import { awardsRepoAwards, type NewRepoAward, type RepoAward } from "../schema";
import type { AwardsDb } from "./db";

export async function getRepoAward(
  orm: AwardsDb,
  repositoryId: string,
): Promise<RepoAward | undefined> {
  const [row] = await orm
    .select()
    .from(awardsRepoAwards)
    .where(eq(awardsRepoAwards.repositoryId, repositoryId));
  return row;
}

export async function listRepoAwards(
  orm: AwardsDb,
  repositoryIds: readonly string[],
): Promise<RepoAward[]> {
  if (repositoryIds.length === 0) return [];
  return orm
    .select()
    .from(awardsRepoAwards)
    .where(inArray(awardsRepoAwards.repositoryId, [...repositoryIds]));
}

export async function upsertRepoAward(
  orm: AwardsDb,
  data: NewRepoAward,
): Promise<RepoAward> {
  await orm
    .insert(awardsRepoAwards)
    .values(data)
    .onConflictDoUpdate({
      target: awardsRepoAwards.repositoryId,
      set: {
        currentTier: data.currentTier,
        highestTier: data.highestTier,
        categories: data.categories,
        proofShareSlug: data.proofShareSlug ?? null,
        lastBuildId: data.lastBuildId ?? null,
        earnedAt: data.earnedAt ?? new Date(),
        lastRecomputedAt: new Date(),
        lastDowngradeAt: data.lastDowngradeAt ?? null,
        lastDowngradeReason: data.lastDowngradeReason ?? null,
      },
    });
  const [row] = await orm
    .select()
    .from(awardsRepoAwards)
    .where(eq(awardsRepoAwards.repositoryId, data.repositoryId));
  return row;
}

/** Used by `deletion.ts`'s `onRepoDeleted` — the FK cascade this replaces. */
export async function deleteRepoAward(
  orm: AwardsDb,
  repositoryId: string,
): Promise<void> {
  await orm
    .delete(awardsRepoAwards)
    .where(eq(awardsRepoAwards.repositoryId, repositoryId));
}
