import { and, desc, eq, gte, lte, sql, sum } from "drizzle-orm";

import {
  gamificationAchievements,
  gamificationBots,
  gamificationBugBlitzEvents,
  gamificationScoreEvents,
  gamificationSeasons,
  gamificationUserScores,
  type Achievement,
  type AchievementCode,
  type ActorKind,
  type Bot,
  type BugBlitzEvent,
  type GamificationSeason,
  type NewAchievement,
  type NewBot,
  type NewBugBlitzEvent,
  type NewGamificationSeason,
  type NewScoreEvent,
  type NewUserScore,
  type ScoreEventKind,
  type ScoreEventSource,
  type UserScore,
} from "../schema";
import type { BotKind } from "../domain/types";
import type { GamificationDb } from "./db";

/**
 * Every read and write Beat-the-Bot performs, against its own six tables
 * through the handle `core/data` supplied.
 *
 * Ported from `src/lib/db/queries/gamification.ts`, which shared one `db`
 * handle with all 98 tables in the app. Three changes, all forced by
 * `docs/architecture/core-scope.md` §6:
 *
 * 1. **`getSeasonLeaderboard` no longer reads `users`.** It used to select
 *    name/email/avatar directly and merge them in. Display data now arrives
 *    from `GamificationHost.resolveActorProfiles`, and the *merge* moved up to
 *    `../domain/leaderboard.ts` so this file is purely this plugin's tables.
 * 2. **`getTeamMembers()` is gone from here** for the same reason — the "show
 *    members with no score row yet at zero" merge needs team membership, which
 *    is core's. It arrives as `listTeamMemberIds`.
 * 3. **`getTestCreator` is gone entirely.** It read `tests`, a core table, so
 *    it became a host method rather than moving.
 *
 * Everything else is the same SQL against renamed tables. Behaviour is held
 * constant (RFC §2).
 */

// ── Seasons ──────────────────────────────────────────────────────────────

export async function getActiveSeason(
  db: GamificationDb,
  teamId: string,
): Promise<GamificationSeason | null> {
  const rows = await db
    .select()
    .from(gamificationSeasons)
    .where(
      and(
        eq(gamificationSeasons.teamId, teamId),
        eq(gamificationSeasons.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getSeasonById(
  db: GamificationDb,
  id: string,
): Promise<GamificationSeason | null> {
  const rows = await db
    .select()
    .from(gamificationSeasons)
    .where(eq(gamificationSeasons.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSeasons(
  db: GamificationDb,
  teamId: string,
): Promise<GamificationSeason[]> {
  return db
    .select()
    .from(gamificationSeasons)
    .where(eq(gamificationSeasons.teamId, teamId))
    .orderBy(desc(gamificationSeasons.startsAt));
}

export async function createSeason(
  db: GamificationDb,
  data: NewGamificationSeason,
): Promise<GamificationSeason> {
  const [row] = await db.insert(gamificationSeasons).values(data).returning();
  return row;
}

export async function endSeasonById(
  db: GamificationDb,
  id: string,
): Promise<void> {
  await db
    .update(gamificationSeasons)
    .set({ status: "ended", endsAt: new Date() })
    .where(eq(gamificationSeasons.id, id));
}

// ── Bug Blitz ────────────────────────────────────────────────────────────

export async function getActiveBugBlitz(
  db: GamificationDb,
  teamId: string,
  now: Date = new Date(),
): Promise<BugBlitzEvent | null> {
  const rows = await db
    .select()
    .from(gamificationBugBlitzEvents)
    .where(
      and(
        eq(gamificationBugBlitzEvents.teamId, teamId),
        lte(gamificationBugBlitzEvents.startsAt, now),
        gte(gamificationBugBlitzEvents.endsAt, now),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listBugBlitzes(
  db: GamificationDb,
  teamId: string,
): Promise<BugBlitzEvent[]> {
  return db
    .select()
    .from(gamificationBugBlitzEvents)
    .where(eq(gamificationBugBlitzEvents.teamId, teamId))
    .orderBy(desc(gamificationBugBlitzEvents.startsAt));
}

export async function createBugBlitz(
  db: GamificationDb,
  data: NewBugBlitzEvent,
): Promise<BugBlitzEvent> {
  const [row] = await db
    .insert(gamificationBugBlitzEvents)
    .values(data)
    .returning();
  return row;
}

export async function updateBugBlitzStatus(
  db: GamificationDb,
  id: string,
  status: BugBlitzEvent["status"],
): Promise<void> {
  await db
    .update(gamificationBugBlitzEvents)
    .set({ status })
    .where(eq(gamificationBugBlitzEvents.id, id));
}

// ── Bots ─────────────────────────────────────────────────────────────────

export async function listBots(
  db: GamificationDb,
  teamId: string,
): Promise<Bot[]> {
  return db
    .select()
    .from(gamificationBots)
    .where(eq(gamificationBots.teamId, teamId));
}

export async function getBotById(
  db: GamificationDb,
  id: string,
): Promise<Bot | null> {
  const rows = await db
    .select()
    .from(gamificationBots)
    .where(eq(gamificationBots.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getBotByKind(
  db: GamificationDb,
  teamId: string,
  kind: BotKind,
): Promise<Bot | null> {
  const rows = await db
    .select()
    .from(gamificationBots)
    .where(
      and(eq(gamificationBots.teamId, teamId), eq(gamificationBots.kind, kind)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertBot(
  db: GamificationDb,
  data: NewBot,
): Promise<Bot> {
  const existing =
    data.teamId && data.kind
      ? await getBotByKind(db, data.teamId, data.kind)
      : null;
  if (existing) return existing;
  const [row] = await db.insert(gamificationBots).values(data).returning();
  return row;
}

/** Seed the three default bots for a team the first time gamification is enabled. */
export async function ensureDefaultBots(
  db: GamificationDb,
  teamId: string,
): Promise<Bot[]> {
  const existing = await listBots(db, teamId);
  if (existing.length >= 3) return existing;
  const wanted: Array<{
    name: string;
    kind: BotKind;
    avatarEmoji: string;
  }> = [
    { name: "Play Agent", kind: "play_agent", avatarEmoji: "🤖" },
    { name: "Generate Agent", kind: "generate_agent", avatarEmoji: "🛸" },
    { name: "MCP Bot", kind: "mcp_server", avatarEmoji: "👾" },
  ];
  const out: Bot[] = [...existing];
  for (const w of wanted) {
    if (existing.find((b) => b.kind === w.kind)) continue;
    const [row] = await db
      .insert(gamificationBots)
      .values({ teamId, ...w })
      .returning();
    out.push(row);
  }
  return out;
}

// ── Score events ─────────────────────────────────────────────────────────

export async function findScoreEvent(
  db: GamificationDb,
  actorKind: ActorKind,
  actorId: string,
  kind: ScoreEventKind,
  sourceType: ScoreEventSource,
  sourceId: string,
) {
  const rows = await db
    .select()
    .from(gamificationScoreEvents)
    .where(
      and(
        eq(gamificationScoreEvents.actorKind, actorKind),
        eq(gamificationScoreEvents.actorId, actorId),
        eq(gamificationScoreEvents.kind, kind),
        eq(gamificationScoreEvents.sourceType, sourceType),
        eq(gamificationScoreEvents.sourceId, sourceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertScoreEvent(
  db: GamificationDb,
  data: NewScoreEvent,
) {
  const [row] = await db
    .insert(gamificationScoreEvents)
    .values(data)
    .returning();
  return row;
}

/** Sum of absolute penalty points charged to an actor in the last 24h for a given kind. */
export async function getDailyPenaltyTotal(
  db: GamificationDb,
  actorKind: ActorKind,
  actorId: string,
  kind: ScoreEventKind,
  windowMs: number = 24 * 60 * 60 * 1000,
): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const rows = await db
    .select({ total: sum(gamificationScoreEvents.delta) })
    .from(gamificationScoreEvents)
    .where(
      and(
        eq(gamificationScoreEvents.actorKind, actorKind),
        eq(gamificationScoreEvents.actorId, actorId),
        eq(gamificationScoreEvents.kind, kind),
        gte(gamificationScoreEvents.createdAt, since),
      ),
    );
  const total = Number(rows[0]?.total ?? 0);
  return Math.abs(total);
}

export async function getRecentScoreEventsForActor(
  db: GamificationDb,
  actorKind: ActorKind,
  actorId: string,
  seasonId: string,
  sinceId?: string,
  limit: number = 50,
) {
  const conditions = [
    eq(gamificationScoreEvents.actorKind, actorKind),
    eq(gamificationScoreEvents.actorId, actorId),
    eq(gamificationScoreEvents.seasonId, seasonId),
  ];
  if (sinceId) {
    const cursor = await db
      .select()
      .from(gamificationScoreEvents)
      .where(eq(gamificationScoreEvents.id, sinceId))
      .limit(1);
    const cursorRow = cursor[0];
    if (cursorRow?.createdAt) {
      conditions.push(
        sql`${gamificationScoreEvents.createdAt} > ${cursorRow.createdAt}`,
      );
    }
  }
  return db
    .select()
    .from(gamificationScoreEvents)
    .where(and(...conditions))
    .orderBy(desc(gamificationScoreEvents.createdAt))
    .limit(limit);
}

// ── User scores (running totals) ────────────────────────────────────────

export async function getUserScoreRow(
  db: GamificationDb,
  seasonId: string,
  actorKind: ActorKind,
  actorId: string,
): Promise<UserScore | null> {
  const rows = await db
    .select()
    .from(gamificationUserScores)
    .where(
      and(
        eq(gamificationUserScores.seasonId, seasonId),
        eq(gamificationUserScores.actorKind, actorKind),
        eq(gamificationUserScores.actorId, actorId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function ensureUserScoreRow(
  db: GamificationDb,
  data: NewUserScore,
): Promise<UserScore> {
  const existing = await getUserScoreRow(
    db,
    data.seasonId,
    data.actorKind,
    data.actorId,
  );
  if (existing) return existing;
  const [row] = await db
    .insert(gamificationUserScores)
    .values(data)
    .returning();
  return row;
}

export async function bumpUserScore(
  db: GamificationDb,
  id: string,
  fields: {
    total: number;
    testsCreated?: number;
    regressionsCaught?: number;
    flakesIncurred?: number;
    lastEventAt: Date;
  },
): Promise<void> {
  await db
    .update(gamificationUserScores)
    .set({
      total: fields.total,
      testsCreated: fields.testsCreated,
      regressionsCaught: fields.regressionsCaught,
      flakesIncurred: fields.flakesIncurred,
      lastEventAt: fields.lastEventAt,
      updatedAt: new Date(),
    })
    .where(eq(gamificationUserScores.id, id));
}

/** Raw score rows for a season, highest first. Enrichment happens in domain/. */
export async function listSeasonScores(
  db: GamificationDb,
  seasonId: string,
): Promise<UserScore[]> {
  return db
    .select()
    .from(gamificationUserScores)
    .where(eq(gamificationUserScores.seasonId, seasonId))
    .orderBy(desc(gamificationUserScores.total));
}

/** Look up the current highest-scoring bot in a season (for beat-the-bot checks). */
export async function getTopBotScore(
  db: GamificationDb,
  seasonId: string,
): Promise<UserScore | null> {
  const rows = await db
    .select()
    .from(gamificationUserScores)
    .where(
      and(
        eq(gamificationUserScores.seasonId, seasonId),
        eq(gamificationUserScores.actorKind, "bot"),
      ),
    )
    .orderBy(desc(gamificationUserScores.total))
    .limit(1);
  return rows[0] ?? null;
}

// ── Achievements ────────────────────────────────────────────────────────

export async function hasAchievement(
  db: GamificationDb,
  seasonId: string,
  actorKind: ActorKind,
  actorId: string,
  code: AchievementCode,
): Promise<boolean> {
  const rows = await db
    .select({ id: gamificationAchievements.id })
    .from(gamificationAchievements)
    .where(
      and(
        eq(gamificationAchievements.seasonId, seasonId),
        eq(gamificationAchievements.actorKind, actorKind),
        eq(gamificationAchievements.actorId, actorId),
        eq(gamificationAchievements.code, code),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function insertAchievement(
  db: GamificationDb,
  data: NewAchievement,
): Promise<Achievement | null> {
  const exists = await hasAchievement(
    db,
    data.seasonId,
    data.actorKind,
    data.actorId,
    data.code,
  );
  if (exists) return null;
  const [row] = await db
    .insert(gamificationAchievements)
    .values(data)
    .returning();
  return row;
}

export async function listRecentAchievements(
  db: GamificationDb,
  teamId: string,
  limit: number = 20,
): Promise<Achievement[]> {
  return db
    .select()
    .from(gamificationAchievements)
    .where(eq(gamificationAchievements.teamId, teamId))
    .orderBy(desc(gamificationAchievements.awardedAt))
    .limit(limit);
}

// ── Deletion (the cascade the database will no longer perform) ──────────

/**
 * Everything this plugin holds for a team. One statement per table, in no
 * particular order — there are no FKs between them, so nothing constrains it.
 * Idempotent by construction.
 */
export async function deleteTeamData(
  db: GamificationDb,
  teamId: string,
): Promise<void> {
  await db
    .delete(gamificationScoreEvents)
    .where(eq(gamificationScoreEvents.teamId, teamId));
  await db
    .delete(gamificationUserScores)
    .where(eq(gamificationUserScores.teamId, teamId));
  await db
    .delete(gamificationAchievements)
    .where(eq(gamificationAchievements.teamId, teamId));
  await db
    .delete(gamificationBugBlitzEvents)
    .where(eq(gamificationBugBlitzEvents.teamId, teamId));
  await db
    .delete(gamificationSeasons)
    .where(eq(gamificationSeasons.teamId, teamId));
  await db.delete(gamificationBots).where(eq(gamificationBots.teamId, teamId));
}
