import { listBots, listSeasonScores } from "../data/queries";
import type { GamificationDb } from "../data/db";
import type { GamificationHost } from "../host";
import type { ActorKind, UserScore } from "../schema";

/**
 * Season leaderboard assembly.
 *
 * Was the back half of `getSeasonLeaderboard()` in
 * `src/lib/db/queries/gamification.ts`, where it sat *inside* a query module
 * and reached three ways at once: this feature's `user_scores` and `bots`, and
 * core's `users` (a direct `select` on name/email/avatar) and `getTeamMembers`.
 *
 * Splitting it out is what let the query module become purely this plugin's
 * tables. The enrichment is not a query — it is a merge of three sources — and
 * putting it here rather than behind two more host methods keeps the port at
 * "give me profiles" and "give me member ids" instead of "give me a
 * leaderboard".
 *
 * Behaviour held constant, including the two things that are easy to lose:
 * team members and bots with **no score row yet** are merged in at zero points
 * so a new team's board is not empty, and the `limit` is applied *after* that
 * merge and after the re-sort, so ranks are contiguous.
 */

export interface LeaderboardRow {
  rank: number;
  actorKind: ActorKind;
  actorId: string;
  displayName: string;
  avatarUrl: string | null;
  avatarEmoji: string | null;
  total: number;
  testsCreated: number;
  regressionsCaught: number;
  flakesIncurred: number;
}

/** A zero-score stand-in for an actor that has not scored this season. */
function stub(
  teamId: string,
  seasonId: string,
  actorKind: ActorKind,
  actorId: string,
): UserScore {
  return {
    id: `stub:${actorKind}:${actorId}`,
    teamId,
    seasonId,
    actorKind,
    actorId,
    total: 0,
    testsCreated: 0,
    regressionsCaught: 0,
    flakesIncurred: 0,
    lastEventAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function buildSeasonLeaderboard(
  db: GamificationDb,
  host: GamificationHost,
  seasonId: string,
  teamId: string,
  limit: number = 50,
): Promise<LeaderboardRow[]> {
  const scores = await listSeasonScores(db, seasonId);

  // Merge in team members & bots that have no score rows yet (show with 0).
  const scoredKeys = new Set(scores.map((s) => `${s.actorKind}:${s.actorId}`));
  const [memberIds, allBots] = await Promise.all([
    host.listTeamMemberIds(teamId),
    listBots(db, teamId),
  ]);
  for (const memberId of memberIds) {
    if (!scoredKeys.has(`user:${memberId}`)) {
      scores.push(stub(teamId, seasonId, "user", memberId));
    }
  }
  for (const bot of allBots) {
    if (!scoredKeys.has(`bot:${bot.id}`)) {
      scores.push(stub(teamId, seasonId, "bot", bot.id));
    }
  }
  scores.sort((a, b) => b.total - a.total);
  const limited = scores.slice(0, limit);

  const userIds = limited
    .filter((s) => s.actorKind === "user")
    .map((s) => s.actorId);
  const botIds = new Set(
    limited.filter((s) => s.actorKind === "bot").map((s) => s.actorId),
  );

  // One batched lookup instead of the `select … from users` this used to do
  // inline. `core-scope.md` §6: a plugin may not read a core table at all.
  const profiles =
    userIds.length > 0
      ? await host.resolveActorProfiles(userIds)
      : new Map<string, never>();
  const botMap = new Map(
    allBots.filter((b) => botIds.has(b.id)).map((b) => [b.id, b]),
  );

  return limited.map((s, idx): LeaderboardRow => {
    if (s.actorKind === "user") {
      const u = profiles.get(s.actorId);
      return {
        rank: idx + 1,
        actorKind: "user",
        actorId: s.actorId,
        displayName: u?.name || u?.email || "Unknown",
        avatarUrl: u?.avatarUrl ?? null,
        avatarEmoji: null,
        total: s.total,
        testsCreated: s.testsCreated,
        regressionsCaught: s.regressionsCaught,
        flakesIncurred: s.flakesIncurred,
      };
    }
    const b = botMap.get(s.actorId);
    return {
      rank: idx + 1,
      actorKind: "bot",
      actorId: s.actorId,
      displayName: b?.name || "Bot",
      avatarUrl: null,
      avatarEmoji: b?.avatarEmoji ?? "🤖",
      total: s.total,
      testsCreated: s.testsCreated,
      regressionsCaught: s.regressionsCaught,
      flakesIncurred: s.flakesIncurred,
    };
  });
}
