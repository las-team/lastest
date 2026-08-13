import { and, asc, count, eq, gte, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";

import { playgroundAchievements, type PlaygroundAchievement } from "../schema";
import type { PlaygroundDb } from "./db";

/**
 * Every read and write the playground performs, against its own single table
 * through the handle `core/data` supplied.
 *
 * Ported from `src/lib/db/queries/playground.ts`, which shared one `db` handle
 * with all 98 tables in the app. Two changes, both forced by
 * `docs/architecture/core-scope.md` §6:
 *
 * 1. **The `innerJoin(users)` in the leaderboard aggregate is gone.** A plugin
 *    may not read a core table, so `LeaderboardRow` no longer carries `name`.
 *    See the note on `listLeaderboardRows` for the one behavioural subtlety
 *    that join was carrying besides the name.
 * 2. **`deleteUserData` exists at all.** It is the replacement for the
 *    `ON DELETE CASCADE` FK to `users.id` that the schema no longer has.
 *
 * Everything else is the same SQL. Behaviour is held constant (RFC §2).
 */

/**
 * Idempotent upsert of earned achievements. Already-known (userId,
 * achievementId) pairs are silently skipped via the unique index — the
 * returned count covers newly inserted rows only ("accepted").
 */
export async function insertAchievements(
  db: PlaygroundDb,
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

export async function listAchievementsByUser(
  db: PlaygroundDb,
  userId: string,
): Promise<PlaygroundAchievement[]> {
  return db
    .select()
    .from(playgroundAchievements)
    .where(eq(playgroundAchievements.userId, userId))
    .orderBy(asc(playgroundAchievements.createdAt));
}

/** New rows accepted for a user since `since` — drives the hourly velocity cap. */
export async function countAchievementsSince(
  db: PlaygroundDb,
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

/** One row per user holding ≥1 achievement, with the full held-id set. */
export interface LeaderboardRow {
  userId: string;
  achievementIds: string[];
  /** max(created_at) — when the user reached their current total (tie-breaker). */
  lastEarnedAt: Date | string | null;
}

/**
 * The board's raw input. Points and bonuses are computed in JS against the
 * vendored registry (`../registry.ts`) so retired ids stop scoring without a
 * backfill.
 *
 * **The dropped `innerJoin(users)` was doing two jobs, not one.** It supplied
 * the display name — now `PlaygroundHost.resolveUsers` — and it silently
 * *excluded* rows whose user no longer exists. `../domain/leaderboard.ts`
 * reproduces the second job by dropping any id the host does not return, so a
 * row orphaned before the deletion hook existed still cannot appear on a
 * public board.
 */
export async function listLeaderboardRows(
  db: PlaygroundDb,
): Promise<LeaderboardRow[]> {
  return db
    .select({
      userId: playgroundAchievements.userId,
      achievementIds: sql<
        string[]
      >`array_agg(${playgroundAchievements.achievementId})`,
      lastEarnedAt: sql<
        Date | string | null
      >`max(${playgroundAchievements.createdAt})`,
    })
    .from(playgroundAchievements)
    .groupBy(playgroundAchievements.userId);
}

/**
 * The cascade the database will no longer perform — see `../deletion.ts`.
 *
 * One statement, because the plugin owns exactly one table and every row in it
 * hangs off the user directly. Idempotent by construction.
 */
export async function deleteUserData(
  db: PlaygroundDb,
  userId: string,
): Promise<void> {
  await db
    .delete(playgroundAchievements)
    .where(eq(playgroundAchievements.userId, userId));
}
