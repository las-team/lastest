/**
 * Leaderboard computation for the /playground score API.
 *
 * The DB stores one row per (user, achievement); scoring against the vendored
 * registry (points + per-exercise completion bonuses) happens here so the
 * board reflects registry retirements without a data backfill. Rank order:
 * points DESC, then earliest last-achievement ASC — on a points tie, whoever
 * got there first wins.
 */

import * as queries from "@/lib/db/queries";
import type { PlaygroundLeaderboardRow } from "@/lib/db/queries/playground";
import { DEFAULT_PLAYGROUND } from "@/lib/db/schema";
import { scoreFor } from "./registry";

export interface BoardEntry {
  userId: string;
  name: string | null;
  points: number;
  completedExercises: number;
  rank: number;
}

/** Pure ranking over aggregated rows — exported for unit tests. */
export function rankBoard(rows: PlaygroundLeaderboardRow[]): BoardEntry[] {
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

// 60s in-process cache — the board is read far more than it changes, and
// single-process semantics match the deployment shape (see rate-limit/limiter).
let cache: { board: BoardEntry[]; at: number } | null = null;

export async function getBoard(): Promise<BoardEntry[]> {
  const now = Date.now();
  if (cache && now - cache.at < DEFAULT_PLAYGROUND.leaderboardCacheTtlMs) {
    return cache.board;
  }
  const board = rankBoard(await queries.getPlaygroundLeaderboardRows());
  cache = { board, at: now };
  return board;
}

/** Call after accepting new achievements so responses reflect the push. */
export function invalidateBoardCache() {
  cache = null;
}
