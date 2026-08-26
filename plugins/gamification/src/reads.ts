import { db } from "./data/db";
import * as q from "./data/queries";
import {
  buildSeasonLeaderboard,
  type LeaderboardRow,
} from "./domain/leaderboard";
import type { BotKind } from "./domain/types";
import { gamificationWiring } from "./wiring";

/**
 * Server-component reads.
 *
 * Deliberately **not** a `"use server"` module. These are called from React
 * server components (`/leaderboard`, `/settings`) which import them directly;
 * making them actions would put a dispatchable POST endpoint on every one for
 * no reason.
 *
 * They replace `queries.getActiveSeason`/`getSeasonLeaderboard`/
 * `getUserScoreRow`/`getActiveBugBlitz` at those call sites, which used to
 * reach the tables through the app's shared `db` handle. The `teamId` argument
 * is the caller's already-authorized team, same contract as `awardScore` —
 * see `./wiring.ts`.
 */

export type { LeaderboardRow };

export async function getActiveSeason(teamId: string) {
  return q.getActiveSeason(db(), teamId);
}

export async function getActiveBugBlitz(teamId: string) {
  return q.getActiveBugBlitz(db(), teamId);
}

export async function getUserScoreRow(
  seasonId: string,
  actorKind: "user" | "bot",
  actorId: string,
) {
  return q.getUserScoreRow(db(), seasonId, actorKind, actorId);
}

export async function listSeasons(teamId: string) {
  return q.listSeasons(db(), teamId);
}

export async function listBugBlitzes(teamId: string) {
  return q.listBugBlitzes(db(), teamId);
}

export async function listRecentAchievements(teamId: string, limit?: number) {
  return q.listRecentAchievements(db(), teamId, limit);
}

/**
 * A team's bot row for an agent kind.
 *
 * Read by app code that stamps `tests.created_by_bot_id` when an agent authors
 * a test. Note `qa-agent` is deliberately *not* among those callers — it is a
 * future plugin, so it passes `createdByAgent` to core's `createTest` instead
 * and lets this feature resolve the id. See `src/lib/db/test-hooks.ts`.
 */
export async function getBotByKind(teamId: string, kind: BotKind) {
  return q.getBotByKind(db(), teamId, kind);
}

export async function getSeasonLeaderboard(
  seasonId: string,
  teamId: string,
  limit: number = 50,
): Promise<LeaderboardRow[]> {
  const { host } = gamificationWiring();
  return buildSeasonLeaderboard(db(), host, seasonId, teamId, limit);
}

/**
 * Who authored a test, in the shape `awardScore` expects.
 *
 * A pass-through to the host: `tests` is a core table, so this feature cannot
 * read it. Kept on this module so the three app call sites
 * (`builds.ts`, `diffs.ts`, `layer-feedback.ts`) that use it to attribute a
 * regression or a flake keep importing one place.
 */
export async function getTestCreator(testId: string) {
  return gamificationWiring().host.getTestCreator(testId);
}
