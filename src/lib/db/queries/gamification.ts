import { db } from '../index';
import {
  bots,
  gamificationSeasons,
  bugBlitzEvents,
  scoreEvents,
  userScores,
  achievements,
  users,
  tests,
} from '../schema';
import type {
  NewBot,
  NewGamificationSeason,
  NewBugBlitzEvent,
  NewScoreEvent,
  NewUserScore,
  NewAchievement,
  ScoreEventKind,
  ScoreEventSource,
  ActorKind,
  GamificationSeason,
  BugBlitzEvent,
  UserScore,
  Bot,
  Achievement,
  AchievementCode,
} from '../schema';
import { and, desc, eq, gte, inArray, lte, sql, sum } from 'drizzle-orm';

// ── Seasons ──────────────────────────────────────────────────────────────

export async function getActiveSeason(teamId: string): Promise<GamificationSeason | null> {
  const rows = await db
    .select()
    .from(gamificationSeasons)
    .where(and(eq(gamificationSeasons.teamId, teamId), eq(gamificationSeasons.status, 'active')))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSeasonById(id: string): Promise<GamificationSeason | null> {
  const rows = await db.select().from(gamificationSeasons).where(eq(gamificationSeasons.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listSeasons(teamId: string): Promise<GamificationSeason[]> {
  return db
    .select()
    .from(gamificationSeasons)
    .where(eq(gamificationSeasons.teamId, teamId))
    .orderBy(desc(gamificationSeasons.startsAt));
}

export async function createSeason(data: NewGamificationSeason): Promise<GamificationSeason> {
  const [row] = await db.insert(gamificationSeasons).values(data).returning();
  return row;
}

export async function endSeasonById(id: string): Promise<void> {
  await db
    .update(gamificationSeasons)
    .set({ status: 'ended', endsAt: new Date() })
    .where(eq(gamificationSeasons.id, id));
}

// ── Bug Blitz ────────────────────────────────────────────────────────────

export async function getActiveBugBlitz(teamId: string, now: Date = new Date()): Promise<BugBlitzEvent | null> {
  const rows = await db
    .select()
    .from(bugBlitzEvents)
    .where(
      and(
        eq(bugBlitzEvents.teamId, teamId),
        lte(bugBlitzEvents.startsAt, now),
        gte(bugBlitzEvents.endsAt, now),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listBugBlitzes(teamId: string): Promise<BugBlitzEvent[]> {
  return db
    .select()
    .from(bugBlitzEvents)
    .where(eq(bugBlitzEvents.teamId, teamId))
    .orderBy(desc(bugBlitzEvents.startsAt));
}

export async function createBugBlitz(data: NewBugBlitzEvent): Promise<BugBlitzEvent> {
  const [row] = await db.insert(bugBlitzEvents).values(data).returning();
  return row;
}

export async function updateBugBlitzStatus(id: string, status: 'scheduled' | 'active' | 'ended'): Promise<void> {
  await db.update(bugBlitzEvents).set({ status }).where(eq(bugBlitzEvents.id, id));
}

// ── Bots ─────────────────────────────────────────────────────────────────

export async function listBots(teamId: string): Promise<Bot[]> {
  return db.select().from(bots).where(eq(bots.teamId, teamId));
}

export async function getBotById(id: string): Promise<Bot | null> {
  const rows = await db.select().from(bots).where(eq(bots.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getBotByKind(teamId: string, kind: 'play_agent' | 'generate_agent' | 'mcp_server'): Promise<Bot | null> {
  const rows = await db
    .select()
    .from(bots)
    .where(and(eq(bots.teamId, teamId), eq(bots.kind, kind)))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertBot(data: NewBot): Promise<Bot> {
  const existing = data.teamId && data.kind ? await getBotByKind(data.teamId, data.kind) : null;
  if (existing) return existing;
  const [row] = await db.insert(bots).values(data).returning();
  return row;
}

/** Seed the three default bots for a team the first time gamification is enabled. */
export async function ensureDefaultBots(teamId: string): Promise<Bot[]> {
  const existing = await listBots(teamId);
  if (existing.length >= 3) return existing;
  const wanted: Array<{ name: string; kind: NewBot['kind']; avatarEmoji: string }> = [
    { name: 'Play Agent', kind: 'play_agent', avatarEmoji: '🤖' },
    { name: 'Generate Agent', kind: 'generate_agent', avatarEmoji: '🛸' },
    { name: 'MCP Bot', kind: 'mcp_server', avatarEmoji: '👾' },
  ];
  const out: Bot[] = [...existing];
  for (const w of wanted) {
    if (existing.find((b) => b.kind === w.kind)) continue;
    const [row] = await db.insert(bots).values({ teamId, ...w }).returning();
    out.push(row);
  }
  return out;
}

// ── Score events ─────────────────────────────────────────────────────────

export async function findScoreEvent(
  actorKind: ActorKind,
  actorId: string,
  kind: ScoreEventKind,
  sourceType: ScoreEventSource,
  sourceId: string,
) {
  const rows = await db
    .select()
    .from(scoreEvents)
    .where(
      and(
        eq(scoreEvents.actorKind, actorKind),
        eq(scoreEvents.actorId, actorId),
        eq(scoreEvents.kind, kind),
        eq(scoreEvents.sourceType, sourceType),
        eq(scoreEvents.sourceId, sourceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertScoreEvent(data: NewScoreEvent) {
  const [row] = await db.insert(scoreEvents).values(data).returning();
  return row;
}

/** Sum of absolute penalty points charged to an actor in the last 24h for a given kind. */
export async function getDailyPenaltyTotal(
  actorKind: ActorKind,
  actorId: string,
  kind: ScoreEventKind,
  windowMs: number = 24 * 60 * 60 * 1000,
): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const rows = await db
    .select({ total: sum(scoreEvents.delta) })
    .from(scoreEvents)
    .where(
      and(
        eq(scoreEvents.actorKind, actorKind),
        eq(scoreEvents.actorId, actorId),
        eq(scoreEvents.kind, kind),
        gte(scoreEvents.createdAt, since),
      ),
    );
  const total = Number(rows[0]?.total ?? 0);
  return Math.abs(total);
}

export async function getRecentScoreEventsForActor(
  actorKind: ActorKind,
  actorId: string,
  seasonId: string,
  sinceId?: string,
  limit: number = 50,
) {
  const conditions = [
    eq(scoreEvents.actorKind, actorKind),
    eq(scoreEvents.actorId, actorId),
    eq(scoreEvents.seasonId, seasonId),
  ];
  if (sinceId) {
    const cursor = await db.select().from(scoreEvents).where(eq(scoreEvents.id, sinceId)).limit(1);
    const cursorRow = cursor[0];
    if (cursorRow?.createdAt) conditions.push(sql`${scoreEvents.createdAt} > ${cursorRow.createdAt}`);
  }
  return db
    .select()
    .from(scoreEvents)
    .where(and(...conditions))
    .orderBy(desc(scoreEvents.createdAt))
    .limit(limit);
}

// ── User scores (running totals) ────────────────────────────────────────

export async function getUserScoreRow(
  seasonId: string,
  actorKind: ActorKind,
  actorId: string,
): Promise<UserScore | null> {
  const rows = await db
    .select()
    .from(userScores)
    .where(
      and(
        eq(userScores.seasonId, seasonId),
        eq(userScores.actorKind, actorKind),
        eq(userScores.actorId, actorId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function ensureUserScoreRow(data: NewUserScore): Promise<UserScore> {
  const existing = await getUserScoreRow(data.seasonId, data.actorKind, data.actorId);
  if (existing) return existing;
  const [row] = await db.insert(userScores).values(data).returning();
  return row;
}

export async function bumpUserScore(
  id: string,
  fields: { total: number; testsCreated?: number; regressionsCaught?: number; flakesIncurred?: number; lastEventAt: Date },
): Promise<void> {
  await db
    .update(userScores)
    .set({
      total: fields.total,
      testsCreated: fields.testsCreated,
      regressionsCaught: fields.regressionsCaught,
      flakesIncurred: fields.flakesIncurred,
      lastEventAt: fields.lastEventAt,
      updatedAt: new Date(),
    })
    .where(eq(userScores.id, id));
}

// ── Leaderboard ─────────────────────────────────────────────────────────

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

/**
 * Read the leaderboard for a season. Joins users & bots for display info.
 * Limit applied post-enrichment; caller appends viewer's own row if outside top-N.
 */
export async function getSeasonLeaderboard(seasonId: string, limit: number = 50): Promise<LeaderboardRow[]> {
  const scores = await db
    .select()
    .from(userScores)
    .where(eq(userScores.seasonId, seasonId))
    .orderBy(desc(userScores.total))
    .limit(limit);

  const userIds = scores.filter((s) => s.actorKind === 'user').map((s) => s.actorId);
  const botIds = scores.filter((s) => s.actorKind === 'bot').map((s) => s.actorId);

  const [userRows, botRows] = await Promise.all([
    userIds.length > 0
      ? db.select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([] as { id: string; name: string | null; email: string; avatarUrl: string | null }[]),
    botIds.length > 0
      ? db.select().from(bots).where(inArray(bots.id, botIds))
      : Promise.resolve([] as Bot[]),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const botMap = new Map(botRows.map((b) => [b.id, b]));

  return scores.map((s, idx): LeaderboardRow => {
    if (s.actorKind === 'user') {
      const u = userMap.get(s.actorId);
      return {
        rank: idx + 1,
        actorKind: 'user',
        actorId: s.actorId,
        displayName: u?.name || u?.email || 'Unknown',
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
      actorKind: 'bot',
      actorId: s.actorId,
      displayName: b?.name || 'Bot',
      avatarUrl: null,
      avatarEmoji: b?.avatarEmoji ?? '🤖',
      total: s.total,
      testsCreated: s.testsCreated,
      regressionsCaught: s.regressionsCaught,
      flakesIncurred: s.flakesIncurred,
    };
  });
}

/** Look up the current highest-scoring bot in a season (for beat-the-bot checks). */
export async function getTopBotScore(seasonId: string): Promise<UserScore | null> {
  const rows = await db
    .select()
    .from(userScores)
    .where(and(eq(userScores.seasonId, seasonId), eq(userScores.actorKind, 'bot')))
    .orderBy(desc(userScores.total))
    .limit(1);
  return rows[0] ?? null;
}

// ── Achievements ────────────────────────────────────────────────────────

export async function hasAchievement(
  seasonId: string,
  actorKind: ActorKind,
  actorId: string,
  code: AchievementCode,
): Promise<boolean> {
  const rows = await db
    .select({ id: achievements.id })
    .from(achievements)
    .where(
      and(
        eq(achievements.seasonId, seasonId),
        eq(achievements.actorKind, actorKind),
        eq(achievements.actorId, actorId),
        eq(achievements.code, code),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function insertAchievement(data: NewAchievement): Promise<Achievement | null> {
  const exists = await hasAchievement(data.seasonId, data.actorKind, data.actorId, data.code);
  if (exists) return null;
  const [row] = await db.insert(achievements).values(data).returning();
  return row;
}

export async function listRecentAchievements(teamId: string, limit: number = 20): Promise<Achievement[]> {
  return db
    .select()
    .from(achievements)
    .where(eq(achievements.teamId, teamId))
    .orderBy(desc(achievements.awardedAt))
    .limit(limit);
}

// ── Test creator lookup (for regression_caught + flake_penalty attribution) ──

/**
 * Returns the actor (user or bot) that authored a test, in the shape that
 * awardScore() expects (`{ kind, id }`). Null if the test has no attribution.
 */
export async function getTestCreator(
  testId: string,
): Promise<{ kind: ActorKind; id: string } | null> {
  const rows = await db
    .select({
      createdByUserId: tests.createdByUserId,
      createdByBotId: tests.createdByBotId,
    })
    .from(tests)
    .where(eq(tests.id, testId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.createdByUserId) return { kind: 'user', id: row.createdByUserId };
  if (row.createdByBotId) return { kind: 'bot', id: row.createdByBotId };
  return null;
}
