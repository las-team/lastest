/**
 * Leaderboard computation for the /playground score API.
 *
 * The table stores one row per (user, achievement); scoring against the
 * vendored registry (points + per-exercise completion bonuses) happens here so
 * the board reflects registry retirements without a data backfill. Rank order:
 * points DESC, then earliest last-achievement ASC — on a points tie, whoever
 * got there first wins.
 *
 * ### What the plugin boundary changed here
 *
 * The aggregate used to `innerJoin(users)` for the display name. A plugin may
 * not read a core table (`core-scope.md` §6), so names now arrive from
 * `PlaygroundHost.resolveUsers` and are merged in *before* ranking — which is
 * where the join used to sit, so ranks stay contiguous and identical.
 *
 * That join was also, quietly, a filter: a row whose user no longer exists
 * matched nothing and vanished. `hydrate` below reproduces that by dropping
 * any id the host does not return. Worth keeping even though `deletion.ts`
 * now reaps those rows, because rows orphaned *before* the hook existed would
 * otherwise surface on a public board.
 *
 * The cost is one extra round trip per cache miss instead of one join — paid
 * at most once per `leaderboardCacheTtlMs`, over a set of ids that is already
 * in memory.
 */

import { PLAYGROUND_CONFIG } from "../config";
import { listLeaderboardRows, type LeaderboardRow } from "../data/queries";
import { db } from "../data/db";
import { scoreFor } from "../registry";
import { playgroundWiring } from "../wiring";

export interface BoardEntry {
  userId: string;
  name: string | null;
  points: number;
  completedExercises: number;
  rank: number;
}

/** A raw aggregate row with its author's display name attached. */
export type NamedLeaderboardRow = LeaderboardRow & { name: string | null };

/** Pure ranking over aggregated rows — exported for unit tests. */
export function rankBoard(rows: NamedLeaderboardRow[]): BoardEntry[] {
  const scored = rows
    .map((row) => {
      const { points, completedExercises } = scoreFor(
        new Set(row.achievementIds),
      );
      return {
        userId: row.userId,
        name: row.name,
        points,
        completedExercises,
        // Missing timestamp sorts last among equals — it can't claim "first".
        lastEarnedMs: row.lastEarnedAt
          ? new Date(row.lastEarnedAt).getTime()
          : Number.POSITIVE_INFINITY,
      };
    })
    // A user holding only retired ids scores 0 and never appears on the board.
    .filter((u) => u.points > 0)
    .sort((a, b) => b.points - a.points || a.lastEarnedMs - b.lastEarnedMs);

  return scored.map(({ lastEarnedMs: _drop, ...entry }, i) => ({
    ...entry,
    rank: i + 1,
  }));
}

/**
 * Attach display names, dropping rows whose user core does not know about.
 * The replacement for what `innerJoin(users)` used to do — see the file
 * header.
 */
async function hydrate(rows: LeaderboardRow[]): Promise<NamedLeaderboardRow[]> {
  if (rows.length === 0) return [];
  const users = await playgroundWiring().host.resolveUsers(
    rows.map((r) => r.userId),
  );
  return rows.flatMap((row) => {
    const user = users.get(row.userId);
    return user ? [{ ...row, name: user.name }] : [];
  });
}

// 60s in-process cache — the board is read far more than it changes, and
// single-process semantics match the deployment shape (see rate-limit/limiter).
let cache: { board: BoardEntry[]; at: number } | null = null;

export async function getBoard(): Promise<BoardEntry[]> {
  const now = Date.now();
  if (cache && now - cache.at < PLAYGROUND_CONFIG.leaderboardCacheTtlMs) {
    return cache.board;
  }
  const board = rankBoard(await hydrate(await listLeaderboardRows(db())));
  cache = { board, at: now };
  return board;
}

/** Call after accepting new achievements so responses reflect the push. */
export function invalidateBoardCache() {
  cache = null;
}
