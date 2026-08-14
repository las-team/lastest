import * as q from "../data/queries";
import type { GamificationDb } from "../data/db";
import type { GamificationHost } from "../host";
import type {
  ActorKind,
  AchievementCode,
  NewScoreEvent,
  NewUserScore,
  ScoreEventKind,
  ScoreEventSource,
} from "../schema";
import { BEAT_BOT_TIERS, SCORE_RULES, applyMultiplier } from "./rules";

/**
 * `awardScore` and the beat-the-bot check — the engine, lifted out of
 * `src/server/actions/gamification.ts`.
 *
 * It is a plain async function taking `(db, host, input)` rather than a
 * `"use server"` export, and that separation is the one real improvement in
 * this migration beyond the move: the action file is now a thin authorization
 * + wiring shell over this, and this is callable from a test with two stubs.
 * The pre-migration version could only be exercised through Next.js's action
 * dispatcher against a live database, which is why it had no unit tests at all
 * despite being the feature's entire business logic.
 *
 * Behaviour is held constant, including the parts that look like bugs and are
 * not: every side effect after the ledger write is best-effort and swallowed,
 * because scoring must never break the business flow that triggered it.
 */

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

/** Ensure a season exists when a team first earns points. */
export async function ensureSeasonForTeam(db: GamificationDb, teamId: string) {
  const existing = await q.getActiveSeason(db, teamId);
  if (existing) return existing;
  return q.createSeason(db, {
    teamId,
    name: "Season 1",
    startsAt: new Date(),
    status: "active",
  });
}

/**
 * Award points to an actor. Idempotent on (actor, kind, sourceType, sourceId).
 * Short-circuits silently if the team doesn't have gamification enabled.
 * All side effects (activity event, achievement, beat-the-bot) are best-effort:
 * any failure is swallowed so we never break the calling business flow.
 *
 * `teamId` arrives already authorized by the caller — see `../wiring.ts` for
 * why this plugin takes it on trust rather than resolving a scope of its own.
 */
export async function awardScore(
  db: GamificationDb,
  host: GamificationHost,
  input: AwardInput,
): Promise<AwardResult> {
  try {
    const {
      teamId,
      kind,
      actor,
      sourceType,
      sourceId,
      detail,
      reason,
      revalidate,
    } = input;

    // 1. Feature gate
    if (!(await host.isEnabledForTeam(teamId))) {
      return { awarded: false, reason: "gamification_disabled" };
    }

    const rule = SCORE_RULES[kind];
    if (!rule) return { awarded: false, reason: "unknown_rule" };

    // 2. Idempotency — short-circuit if this (actor, kind, source) already awarded
    const existing = await q.findScoreEvent(
      db,
      actor.kind,
      actor.id,
      kind,
      sourceType,
      sourceId,
    );
    if (existing) return { awarded: false, reason: "already_awarded" };

    // 3. Season + blitz lookup
    const season = await ensureSeasonForTeam(db, teamId);
    const blitz = await q.getActiveBugBlitz(db, teamId);
    const multiplier = blitz?.multiplier ?? 100;

    // 4. Daily-cap check for penalties
    let baseDelta = rule.base;
    if (rule.dailyCap && baseDelta < 0) {
      const spent = await q.getDailyPenaltyTotal(
        db,
        actor.kind,
        actor.id,
        kind,
      );
      const headroom = rule.dailyCap - spent;
      if (headroom <= 0) return { awarded: false, reason: "daily_cap_reached" };
      // Cap the outgoing penalty so we never exceed the limit.
      if (Math.abs(baseDelta) > headroom) baseDelta = -headroom;
    }

    const delta = applyMultiplier(baseDelta, multiplier);
    if (delta === 0) return { awarded: false, reason: "zero_delta" };

    // 5. Ensure a running-total row exists
    const scoreRow = await q.ensureUserScoreRow(db, {
      teamId,
      seasonId: season.id,
      actorKind: actor.kind,
      actorId: actor.id,
    } as NewUserScore);

    const previousTotal = scoreRow.total;

    // 6. Insert ledger row
    const event = await q.insertScoreEvent(db, {
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
    await q.bumpUserScore(db, scoreRow.id, {
      total: newTotal,
      testsCreated: scoreRow.testsCreated + (kind === "test_created" ? 1 : 0),
      regressionsCaught:
        scoreRow.regressionsCaught + (kind === "regression_caught" ? 1 : 0),
      flakesIncurred:
        scoreRow.flakesIncurred + (kind === "flake_penalty" ? 1 : 0),
      lastEventAt: new Date(),
    });

    // 8. First-time achievement hook
    let achievementUnlocked: AchievementCode | null = null;
    if (rule.firstTimeAchievement) {
      const unlocked = await q.insertAchievement(db, {
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
    if (actor.kind === "user" && delta > 0) {
      beatBot = await runBeatBotCheck(db, {
        teamId,
        seasonId: season.id,
        userId: actor.id,
        previousTotal,
        newTotal,
      });
    }

    // 10. Persist activity feed rows (fire-and-forget — best-effort)
    try {
      await host.emitActivityEvent({
        teamId,
        eventType: delta >= 0 ? "score:awarded" : "score:penalty",
        summary: `${actor.kind === "bot" ? "🤖 " : ""}${reason ?? rule.reason} (${delta >= 0 ? "+" : ""}${delta})`,
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
        artifactId: event.id,
        artifactLabel: rule.reason,
      });

      if (achievementUnlocked) {
        await host.emitActivityEvent({
          teamId,
          eventType: "achievement:unlocked",
          summary: `🏆 Achievement unlocked: ${achievementUnlocked}`,
          detail: {
            actorKind: actor.kind,
            actorId: actor.id,
            code: achievementUnlocked,
          },
          artifactId: event.id,
          artifactLabel: achievementUnlocked,
        });
      }

      if (beatBot) {
        await host.emitActivityEvent({
          teamId,
          eventType: "beat_the_bot",
          summary: `★ You beat ${beatBot.botName} by ${beatBot.beatBy}!`,
          detail: { actorKind: actor.kind, actorId: actor.id, ...beatBot },
          artifactId: event.id,
          artifactLabel: beatBot.botName,
        });
      }
    } catch (err) {
      console.error("[gamification] failed to emit activity event", err);
    }

    // 11. Revalidate paths (non-fatal if called outside a request)
    host.revalidate(revalidate ?? ["/leaderboard"]);

    return {
      awarded: true,
      delta,
      newTotal,
      newEventId: event.id,
      achievementUnlocked,
      beatBot,
    };
  } catch (err) {
    console.error("[gamification] awardScore failed", err);
    return { awarded: false, reason: "error" };
  }
}

async function runBeatBotCheck(
  db: GamificationDb,
  args: {
    teamId: string;
    seasonId: string;
    userId: string;
    previousTotal: number;
    newTotal: number;
  },
): Promise<{ botName: string; beatBy: number } | null> {
  const topBot = await q.getTopBotScore(db, args.seasonId);
  if (!topBot) return null;
  const botTotal = topBot.total;

  // Only fire on the transition: previously ≤ bot total, now > bot total
  if (!(args.previousTotal <= botTotal && args.newTotal > botTotal)) {
    return null;
  }

  const bot = await q.getBotById(db, topBot.actorId);
  const botName = bot?.name ?? "Bot";
  const beatBy = args.newTotal - botTotal;

  // Unlock any qualifying beat-bot achievement tier
  for (const tier of BEAT_BOT_TIERS) {
    if (beatBy >= tier.minMargin) {
      await q.insertAchievement(db, {
        teamId: args.teamId,
        seasonId: args.seasonId,
        actorKind: "user",
        actorId: args.userId,
        code: tier.code,
        detail: { botName, beatBy, tierLabel: tier.label },
      });
    }
  }

  return { botName, beatBy };
}
