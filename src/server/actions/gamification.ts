'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { emitAndPersistActivityEvent } from '@/lib/db/queries/activity-events';
import { requireTeamAccess, requireTeamAdmin } from '@/lib/auth';
import {
  SCORE_RULES,
  applyMultiplier,
  BEAT_BOT_TIERS,
} from '@/lib/gamification/rules';
import type {
  ActorKind,
  ScoreEventKind,
  ScoreEventSource,
  NewUserScore,
  NewScoreEvent,
  UserScore,
  AchievementCode,
} from '@/lib/db/schema';

// ── Types ────────────────────────────────────────────────────────────────

export interface AwardInput {
  teamId: string;
  kind: ScoreEventKind;
  actor: { kind: ActorKind; id: string };
  sourceType: ScoreEventSource;
  sourceId: string;
  /** Optional richer detail stored on the score event. */
  detail?: Record<string, unknown>;
  /** Override the reason string on the event. */
  reason?: string;
  /** Override path to revalidate after the award. */
  revalidate?: string[];
}

export interface AwardResult {
  awarded: boolean;
  reason?: string;
  delta?: number;
  newTotal?: number;
  newEventId?: string;
  achievementUnlocked?: AchievementCode | null;
  beatBot?: { botName: string; beatBy: number } | null;
}

// ── Internal: flag check ────────────────────────────────────────────────

async function gamificationActiveForTeam(teamId: string): Promise<boolean> {
  const team = await queries.getTeam(teamId);
  return !!team?.gamificationEnabled;
}

// ── Internal: ensure a season exists when a team first earns points ─────

async function ensureSeasonForTeam(teamId: string) {
  const existing = await queries.getActiveSeason(teamId);
  if (existing) return existing;
  return queries.createSeason({
    teamId,
    name: 'Season 1',
    startsAt: new Date(),
    status: 'active',
  });
}

// ── Core primitive: awardScore ──────────────────────────────────────────

/**
 * Award points to an actor. Idempotent on (actor, kind, sourceType, sourceId).
 * Short-circuits silently if the team doesn't have gamification enabled.
 * All side effects (activity event, achievement, beat-the-bot) are best-effort:
 * any failure is swallowed so we never break the calling business flow.
 */
export async function awardScore(input: AwardInput): Promise<AwardResult> {
  try {
    const { teamId, kind, actor, sourceType, sourceId, detail, reason, revalidate } = input;

    // 1. Feature gate
    if (!(await gamificationActiveForTeam(teamId))) {
      return { awarded: false, reason: 'gamification_disabled' };
    }

    const rule = SCORE_RULES[kind];
    if (!rule) return { awarded: false, reason: 'unknown_rule' };

    // 2. Idempotency — short-circuit if this (actor, kind, source) already awarded
    const existing = await queries.findScoreEvent(actor.kind, actor.id, kind, sourceType, sourceId);
    if (existing) return { awarded: false, reason: 'already_awarded' };

    // 3. Season + blitz lookup
    const season = await ensureSeasonForTeam(teamId);
    const blitz = await queries.getActiveBugBlitz(teamId);
    const multiplier = blitz?.multiplier ?? 100;

    // 4. Daily-cap check for penalties
    let baseDelta = rule.base;
    if (rule.dailyCap && baseDelta < 0) {
      const spent = await queries.getDailyPenaltyTotal(actor.kind, actor.id, kind);
      const headroom = rule.dailyCap - spent;
      if (headroom <= 0) return { awarded: false, reason: 'daily_cap_reached' };
      // Cap the outgoing penalty so we never exceed the limit.
      if (Math.abs(baseDelta) > headroom) baseDelta = -headroom;
    }

    const delta = applyMultiplier(baseDelta, multiplier);
    if (delta === 0) return { awarded: false, reason: 'zero_delta' };

    // 5. Ensure a running-total row exists
    const scoreRow = await queries.ensureUserScoreRow({
      teamId,
      seasonId: season.id,
      actorKind: actor.kind,
      actorId: actor.id,
    } as NewUserScore);

    const previousTotal = scoreRow.total;

    // 6. Insert ledger row
    const event = await queries.insertScoreEvent({
      teamId,
      seasonId: season.id,
      bugBlitzId: blitz?.id ?? null,
      actorKind: actor.kind,
      actorId: actor.id,
      kind,
      delta,
      baseDelta,
      multiplier,
      sourceType,
      sourceId,
      reason: reason ?? rule.reason,
      detail: detail ?? null,
    } as NewScoreEvent);

    // 7. Bump running totals
    const newTotal = previousTotal + delta;
    await queries.bumpUserScore(scoreRow.id, {
      total: newTotal,
      testsCreated: scoreRow.testsCreated + (kind === 'test_created' ? 1 : 0),
      regressionsCaught: scoreRow.regressionsCaught + (kind === 'regression_caught' ? 1 : 0),
      flakesIncurred: scoreRow.flakesIncurred + (kind === 'flake_penalty' ? 1 : 0),
      lastEventAt: new Date(),
    });

    // 8. First-time achievement hook
    let achievementUnlocked: AchievementCode | null = null;
    if (rule.firstTimeAchievement) {
      const unlocked = await queries.insertAchievement({
        teamId,
        seasonId: season.id,
        actorKind: actor.kind,
        actorId: actor.id,
        code: rule.firstTimeAchievement,
        detail: { triggeredBy: kind, sourceId },
      });
      if (unlocked) achievementUnlocked = unlocked.code;
    }

    // 9. Beat-the-bot check (only for users, only if delta is positive)
    let beatBot: { botName: string; beatBy: number } | null = null;
    if (actor.kind === 'user' && delta > 0) {
      beatBot = await runBeatBotCheck({
        teamId,
        seasonId: season.id,
        userId: actor.id,
        previousTotal,
        newTotal,
      });
    }

    // 10. Persist activity feed rows (fire-and-forget — best-effort)
    try {
      await emitAndPersistActivityEvent({
        teamId,
        repositoryId: null,
        sessionId: null,
        sourceType: 'play_agent',
        eventType: delta >= 0 ? 'score:awarded' : 'score:penalty',
        agentType: null,
        stepId: null,
        summary: `${actor.kind === 'bot' ? '🤖 ' : ''}${reason ?? rule.reason} (${delta >= 0 ? '+' : ''}${delta})`,
        detail: {
          actorKind: actor.kind,
          actorId: actor.id,
          kind,
          delta,
          multiplier,
          seasonId: season.id,
          newTotal,
          ...(detail ?? {}),
        },
        artifactType: 'score',
        artifactId: event.id,
        artifactLabel: rule.reason,
        promptLogId: null,
        durationMs: null,
      });

      if (achievementUnlocked) {
        await emitAndPersistActivityEvent({
          teamId,
          repositoryId: null,
          sessionId: null,
          sourceType: 'play_agent',
          eventType: 'achievement:unlocked',
          agentType: null,
          stepId: null,
          summary: `🏆 Achievement unlocked: ${achievementUnlocked}`,
          detail: { actorKind: actor.kind, actorId: actor.id, code: achievementUnlocked },
          artifactType: 'score',
          artifactId: event.id,
          artifactLabel: achievementUnlocked,
          promptLogId: null,
          durationMs: null,
        });
      }

      if (beatBot) {
        await emitAndPersistActivityEvent({
          teamId,
          repositoryId: null,
          sessionId: null,
          sourceType: 'play_agent',
          eventType: 'beat_the_bot',
          agentType: null,
          stepId: null,
          summary: `★ You beat ${beatBot.botName} by ${beatBot.beatBy}!`,
          detail: { actorKind: actor.kind, actorId: actor.id, ...beatBot },
          artifactType: 'score',
          artifactId: event.id,
          artifactLabel: beatBot.botName,
          promptLogId: null,
          durationMs: null,
        });
      }
    } catch (err) {
      console.error('[gamification] failed to emit activity event', err);
    }

    // 11. Revalidate paths (non-fatal if called outside a request)
    const paths = revalidate ?? ['/leaderboard'];
    for (const p of paths) {
      try {
        revalidatePath(p);
      } catch {}
    }

    return {
      awarded: true,
      delta,
      newTotal,
      newEventId: event.id,
      achievementUnlocked,
      beatBot,
    };
  } catch (err) {
    console.error('[gamification] awardScore failed', err);
    return { awarded: false, reason: 'error' };
  }
}

// ── Beat-the-bot check ──────────────────────────────────────────────────

async function runBeatBotCheck(args: {
  teamId: string;
  seasonId: string;
  userId: string;
  previousTotal: number;
  newTotal: number;
}): Promise<{ botName: string; beatBy: number } | null> {
  const topBot = await queries.getTopBotScore(args.seasonId);
  if (!topBot) return null;
  const botTotal = topBot.total;

  // Only fire on the transition: previously ≤ bot total, now > bot total
  if (!(args.previousTotal <= botTotal && args.newTotal > botTotal)) return null;

  const bot = await queries.getBotById(topBot.actorId);
  const botName = bot?.name ?? 'Bot';
  const beatBy = args.newTotal - botTotal;

  // Unlock any qualifying beat-bot achievement tier
  for (const tier of BEAT_BOT_TIERS) {
    if (beatBy >= tier.minMargin) {
      await queries.insertAchievement({
        teamId: args.teamId,
        seasonId: args.seasonId,
        actorKind: 'user',
        actorId: args.userId,
        code: tier.code,
        detail: { botName, beatBy, tierLabel: tier.label },
      });
    }
  }

  return { botName, beatBy };
}

// ── Admin actions: seasons ──────────────────────────────────────────────

export async function startNewSeason(name: string) {
  const session = await requireTeamAdmin();
  const teamId = session.team.id;

  // End any active season first
  const active = await queries.getActiveSeason(teamId);
  if (active) {
    await queries.endSeasonById(active.id);
    await emitAndPersistActivityEvent({
      teamId, repositoryId: null, sessionId: null,
      sourceType: 'play_agent', eventType: 'season:ended',
      agentType: null, stepId: null,
      summary: `Season "${active.name}" ended`,
      detail: { seasonId: active.id },
      artifactType: 'score', artifactId: active.id, artifactLabel: active.name,
      promptLogId: null, durationMs: null,
    }).catch(() => {});
  }

  const season = await queries.createSeason({
    teamId, name, startsAt: new Date(), status: 'active',
  });

  await emitAndPersistActivityEvent({
    teamId, repositoryId: null, sessionId: null,
    sourceType: 'play_agent', eventType: 'season:started',
    agentType: null, stepId: null,
    summary: `Season "${name}" started ★`,
    detail: { seasonId: season.id },
    artifactType: 'score', artifactId: season.id, artifactLabel: name,
    promptLogId: null, durationMs: null,
  }).catch(() => {});

  revalidatePath('/leaderboard');
  revalidatePath('/settings');
  return season;
}

export async function endCurrentSeason() {
  const session = await requireTeamAdmin();
  const active = await queries.getActiveSeason(session.team.id);
  if (!active) return null;
  await queries.endSeasonById(active.id);

  await emitAndPersistActivityEvent({
    teamId: session.team.id, repositoryId: null, sessionId: null,
    sourceType: 'play_agent', eventType: 'season:ended',
    agentType: null, stepId: null,
    summary: `Season "${active.name}" ended`,
    detail: { seasonId: active.id },
    artifactType: 'score', artifactId: active.id, artifactLabel: active.name,
    promptLogId: null, durationMs: null,
  }).catch(() => {});

  revalidatePath('/leaderboard');
  revalidatePath('/settings');
  return active;
}

// ── Admin actions: bug blitz ────────────────────────────────────────────

export async function startBugBlitz(data: { name: string; durationHours: number; multiplier: number }) {
  const session = await requireTeamAdmin();
  const season = await ensureSeasonForTeam(session.team.id);

  const startsAt = new Date();
  const endsAt = new Date(Date.now() + data.durationHours * 60 * 60 * 1000);

  const blitz = await queries.createBugBlitz({
    teamId: session.team.id,
    seasonId: season.id,
    name: data.name,
    startsAt,
    endsAt,
    multiplier: Math.max(100, Math.min(500, Math.round(data.multiplier))),
    status: 'active',
  });

  await emitAndPersistActivityEvent({
    teamId: session.team.id, repositoryId: null, sessionId: null,
    sourceType: 'play_agent', eventType: 'blitz:started',
    agentType: null, stepId: null,
    summary: `🐛 Bug Blitz "${data.name}" started — ${(blitz.multiplier / 100).toFixed(1)}× points!`,
    detail: { blitzId: blitz.id, multiplier: blitz.multiplier, endsAt: endsAt.toISOString() },
    artifactType: 'score', artifactId: blitz.id, artifactLabel: data.name,
    promptLogId: null, durationMs: null,
  }).catch(() => {});

  revalidatePath('/leaderboard');
  revalidatePath('/settings');
  return blitz;
}

export async function endBugBlitz(blitzId: string) {
  await requireTeamAdmin();
  await queries.updateBugBlitzStatus(blitzId, 'ended');
  revalidatePath('/leaderboard');
  revalidatePath('/settings');
  return { success: true };
}

// ── Admin actions: feature toggle ───────────────────────────────────────

export async function toggleGamification(enabled: boolean) {
  const session = await requireTeamAdmin();
  await queries.updateTeam(session.team.id, { gamificationEnabled: enabled });
  if (enabled) {
    // Seed default bots the first time it's enabled, and ensure a season.
    await queries.ensureDefaultBots(session.team.id);
    await ensureSeasonForTeam(session.team.id);
  }
  revalidatePath('/settings');
  revalidatePath('/leaderboard');
  return { enabled };
}

// ── Read-side: current viewer's score card ─────────────────────────────

export async function getViewerGamificationSnapshot() {
  const session = await requireTeamAccess();
  const team = session.team;
  if (!team.gamificationEnabled) return null;

  const season = await queries.getActiveSeason(team.id);
  if (!season) return null;

  const blitz = await queries.getActiveBugBlitz(team.id);
  const row = await queries.getUserScoreRow(season.id, 'user', session.user.id);

  return {
    seasonId: season.id,
    seasonName: season.name,
    total: row?.total ?? 0,
    testsCreated: row?.testsCreated ?? 0,
    regressionsCaught: row?.regressionsCaught ?? 0,
    flakesIncurred: row?.flakesIncurred ?? 0,
    blitz: blitz
      ? { id: blitz.id, name: blitz.name, multiplier: blitz.multiplier, endsAt: blitz.endsAt }
      : null,
  };
}

// ── Read-side: leaderboard for the page ─────────────────────────────────

export async function getLeaderboardSnapshot(): Promise<{
  seasonName: string;
  rows: Array<UserScore & { displayName: string; avatarUrl: string | null; avatarEmoji: string | null; rank: number }>;
  viewerActorId: string | null;
  blitz: { name: string; multiplier: number; endsAt: Date | null } | null;
} | null> {
  const session = await requireTeamAccess();
  if (!session.team.gamificationEnabled) return null;
  const season = await queries.getActiveSeason(session.team.id);
  if (!season) return null;

  const leaderboard = await queries.getSeasonLeaderboard(season.id, session.team.id, 10);
  const rows = leaderboard.map((lb) => ({
    id: `${lb.actorKind}:${lb.actorId}`,
    teamId: session.team.id,
    seasonId: season.id,
    actorKind: lb.actorKind,
    actorId: lb.actorId,
    total: lb.total,
    testsCreated: lb.testsCreated,
    regressionsCaught: lb.regressionsCaught,
    flakesIncurred: lb.flakesIncurred,
    lastEventAt: null,
    createdAt: null,
    updatedAt: null,
    displayName: lb.displayName,
    avatarUrl: lb.avatarUrl,
    avatarEmoji: lb.avatarEmoji,
    rank: lb.rank,
  })) as unknown as Array<UserScore & { displayName: string; avatarUrl: string | null; avatarEmoji: string | null; rank: number }>;

  const blitz = await queries.getActiveBugBlitz(session.team.id);

  return {
    seasonName: season.name,
    rows,
    viewerActorId: session.user.id,
    blitz: blitz ? { name: blitz.name, multiplier: blitz.multiplier, endsAt: blitz.endsAt } : null,
  };
}
