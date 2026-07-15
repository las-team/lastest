import { db } from "../index";
import { playgroundAchievements, users } from "../schema";
import type { PlaygroundAchievement } from "../schema";
import { eq, and, asc, gte, sql, count } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// ============================================
// Playground achievements (score & leaderboard)
// ============================================

/**
 * Idempotent upsert of earned achievements. Already-known (userId,
 * achievementId) pairs are silently skipped via the unique index — the
 * returned count covers newly inserted rows only ("accepted").
 */
export async function insertPlaygroundAchievements(
  userId: string,
  rows: { achievementId: string; points: number; earnedAt: Date }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();
  const inserted = await db
    .insert(playgroundAchievements)
    .values(
      rows.map((r) => ({
        id: uuid(),
        userId,
        achievementId: r.achievementId,
        points: r.points,
        earnedAt: r.earnedAt,
        createdAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [
        playgroundAchievements.userId,
        playgroundAchievements.achievementId,
      ],
    })
    .returning({ id: playgroundAchievements.id });
  return inserted.length;
}

export async function getPlaygroundAchievementsByUser(
  userId: string,
): Promise<PlaygroundAchievement[]> {
  return db
    .select()
    .from(playgroundAchievements)
    .where(eq(playgroundAchievements.userId, userId))
    .orderBy(asc(playgroundAchievements.createdAt));
}

/** New rows accepted for a user since `since` — drives the hourly velocity cap. */
export async function countPlaygroundAchievementsSince(
  userId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(playgroundAchievements)
    .where(
      and(
        eq(playgroundAchievements.userId, userId),
        gte(playgroundAchievements.createdAt, since),
      ),
    );
  return row?.value ?? 0;
}

export interface PlaygroundLeaderboardRow {
  userId: string;
  name: string | null;
  achievementIds: string[];
  /** max(created_at) — when the user reached their current total (tie-breaker). */
  lastEarnedAt: Date | string | null;
}

/**
 * One row per user holding ≥1 achievement, with the full held-id set.
 * Points/bonuses are computed in JS against the vendored registry
 * (src/lib/playground/registry.ts) so retired ids stop scoring without a
 * backfill.
 */
export async function getPlaygroundLeaderboardRows(): Promise<
  PlaygroundLeaderboardRow[]
> {
  return db
    .select({
      userId: playgroundAchievements.userId,
      name: users.name,
      achievementIds: sql<
        string[]
      >`array_agg(${playgroundAchievements.achievementId})`,
      lastEarnedAt: sql<
        Date | string | null
      >`max(${playgroundAchievements.createdAt})`,
    })
    .from(playgroundAchievements)
    .innerJoin(users, eq(users.id, playgroundAchievements.userId))
    .groupBy(playgroundAchievements.userId, users.name);
}
