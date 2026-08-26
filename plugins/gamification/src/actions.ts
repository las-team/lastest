"use server";

import { db } from "./data/db";
import * as q from "./data/queries";
import {
  awardScore as runAward,
  ensureSeasonForTeam,
  type AwardInput,
  type AwardResult,
} from "./domain/scoring";
// NOTE: do NOT re-export those two types from this file. See the header.
import type { BotKind } from "./domain/types";
import { gamificationPlugin } from "./index";
import { gamificationWiring } from "./wiring";

/**
 * The feature's server actions.
 *
 * Was `src/server/actions/gamification.ts`. What changed is the shape, not the
 * behaviour: the scoring engine moved to `./domain/scoring.ts` and this file is
 * now authorization + wiring. Every admin action begins with
 * `host.requireTeamAdmin()`, which *returns* the authorized team id — so there
 * is no team id in scope to act on until the check has passed, and forgetting
 * it is a type error rather than a security hole (recipe §3.1).
 *
 * Spike S1: a `"use server"` module inside a `transpilePackages` package
 * produces real, dispatchable action ids. Two traps live here, and this
 * migration found the second one:
 *
 * 1. `export { x } from "./y"` compiles to a module with **no** exports.
 * 2. **`export type { … }` compiles to a runtime action export.** This file
 *    briefly re-exported `AwardInput`/`AwardResult` for convenience and the
 *    production build failed on every page —
 *    "Export AwardInput doesn't exist in target module" — because Next.js
 *    assigns an action id per export name *before* types are erased, then
 *    cannot resolve them. `pnpm types` and `pnpm lint` both pass; only
 *    `pnpm build` catches it. Types belong on a non-action module: these two
 *    are exported from `./domain/scoring` and re-exported by `./index.ts`.
 */

/**
 * The signed-in caller and the team they are acting for, or null when there
 * is no session (a background path, or a signed-out visitor).
 *
 * Replaces the host's retired `currentActor` method: `contextFor` with no
 * scope request falls through to the app's `requireTeamAccess()`, and
 * `ctx.actor` carries the user. The catch is deliberate and matches the old
 * contract — both call sites treat "no session" as "nothing to attribute"
 * rather than an error, and on background paths the session lookup itself
 * throws (`headers()` outside a request).
 */
async function currentViewer(): Promise<{
  userId: string;
  teamId: string;
} | null> {
  const { runtime } = gamificationWiring();
  try {
    const ctx = await runtime.contextFor(gamificationPlugin);
    return ctx.actor ? { userId: ctx.actor.userId, teamId: ctx.team.id } : null;
  } catch {
    return null;
  }
}

/**
 * Award points to an actor.
 *
 * `teamId` comes from the caller, which has already authorized it — six app
 * call sites (a diff approved, a todo resolved, a build finishing) hold a team
 * from their own `requireTeamAccess()`. Unchanged from before the migration;
 * `../wiring.ts` explains why this plugin does not re-resolve a scope.
 */
export async function awardScore(input: AwardInput): Promise<AwardResult> {
  const { host } = gamificationWiring();
  return runAward(db(), host, input);
}

/**
 * Resolve a team's bot row id for an agent kind.
 *
 * The reason `qa-agent` no longer reads this feature's table to attribute its
 * own work: `createTest(…, createdByAgent)` routes through core's
 * `test-hooks` port to `onTestCreated`, which calls this.
 */
export async function resolveBotIdByKind(
  teamId: string,
  kind: BotKind,
): Promise<string | null> {
  const bot = await q.getBotByKind(db(), teamId, kind).catch(() => null);
  return bot?.id ?? null;
}

/**
 * The `tests` domain-notification listener, registered into core's port by the
 * composition root. See `src/lib/db/test-hooks.ts` for why core no longer
 * calls this directly.
 */
export async function onTestCreated(event: {
  testId: string;
  createdByUserId: string | null;
  createdByBotId: string | null;
  createdByAgent: BotKind | null;
}): Promise<void> {
  const { host } = gamificationWiring();
  try {
    const actor = await currentViewer();
    if (!actor) return;

    // Caller already named a bot row.
    if (event.createdByBotId) {
      await awardScore({
        teamId: actor.teamId,
        kind: "test_created",
        actor: { kind: "bot", id: event.createdByBotId },
        sourceType: "test",
        sourceId: event.testId,
      });
      return;
    }

    // Caller named an agent kind — resolve this team's bot row and stamp the
    // column the caller could not fill itself.
    if (event.createdByAgent) {
      const botId = await resolveBotIdByKind(
        actor.teamId,
        event.createdByAgent,
      );
      if (!botId) return;
      await host.stampTestCreator(event.testId, { kind: "bot", id: botId });
      await awardScore({
        teamId: actor.teamId,
        kind: "test_created",
        actor: { kind: "bot", id: botId },
        sourceType: "test",
        sourceId: event.testId,
      });
      return;
    }

    // Caller already stamped a user. (rare — most paths don't)
    if (event.createdByUserId) {
      await awardScore({
        teamId: actor.teamId,
        kind: "test_created",
        actor: { kind: "user", id: event.createdByUserId },
        sourceType: "test",
        sourceId: event.testId,
      });
      return;
    }

    // Infer from the current session and stamp the row, so future
    // regression/flake scoring can find the author.
    await host.stampTestCreator(event.testId, {
      kind: "user",
      id: actor.userId,
    });
    await awardScore({
      teamId: actor.teamId,
      kind: "test_created",
      actor: { kind: "user", id: actor.userId },
      sourceType: "test",
      sourceId: event.testId,
    });
  } catch (err) {
    console.error("[gamification] onTestCreated failed", err);
  }
}

// ── Admin actions: seasons ──────────────────────────────────────────────

export async function startNewSeason(name: string) {
  const { host } = gamificationWiring();
  const teamId = await host.requireTeamAdmin();
  const orm = db();

  // End any active season first
  const active = await q.getActiveSeason(orm, teamId);
  if (active) {
    await q.endSeasonById(orm, active.id);
    await host
      .emitActivityEvent({
        teamId,
        eventType: "season:ended",
        summary: `Season "${active.name}" ended`,
        detail: { seasonId: active.id },
        artifactId: active.id,
        artifactLabel: active.name,
      })
      .catch(() => {});
  }

  const season = await q.createSeason(orm, {
    teamId,
    name,
    startsAt: new Date(),
    status: "active",
  });

  await host
    .emitActivityEvent({
      teamId,
      eventType: "season:started",
      summary: `Season "${name}" started ★`,
      detail: { seasonId: season.id },
      artifactId: season.id,
      artifactLabel: name,
    })
    .catch(() => {});

  host.revalidate(["/leaderboard", "/settings"]);
  return season;
}

export async function endCurrentSeason() {
  const { host } = gamificationWiring();
  const teamId = await host.requireTeamAdmin();
  const orm = db();

  const active = await q.getActiveSeason(orm, teamId);
  if (!active) return null;
  await q.endSeasonById(orm, active.id);

  await host
    .emitActivityEvent({
      teamId,
      eventType: "season:ended",
      summary: `Season "${active.name}" ended`,
      detail: { seasonId: active.id },
      artifactId: active.id,
      artifactLabel: active.name,
    })
    .catch(() => {});

  host.revalidate(["/leaderboard", "/settings"]);
  return active;
}

// ── Admin actions: bug blitz ────────────────────────────────────────────

export async function startBugBlitz(data: {
  name: string;
  durationHours: number;
  multiplier: number;
}) {
  const { host } = gamificationWiring();
  const teamId = await host.requireTeamAdmin();
  const orm = db();
  const season = await ensureSeasonForTeam(orm, teamId);

  const startsAt = new Date();
  const endsAt = new Date(Date.now() + data.durationHours * 60 * 60 * 1000);

  const blitz = await q.createBugBlitz(orm, {
    teamId,
    seasonId: season.id,
    name: data.name,
    startsAt,
    endsAt,
    multiplier: Math.max(100, Math.min(500, Math.round(data.multiplier))),
    status: "active",
  });

  await host
    .emitActivityEvent({
      teamId,
      eventType: "blitz:started",
      summary: `🐛 Bug Blitz "${data.name}" started — ${(blitz.multiplier / 100).toFixed(1)}× points!`,
      detail: {
        blitzId: blitz.id,
        multiplier: blitz.multiplier,
        endsAt: endsAt.toISOString(),
      },
      artifactId: blitz.id,
      artifactLabel: data.name,
    })
    .catch(() => {});

  host.revalidate(["/leaderboard", "/settings"]);
  return blitz;
}

export async function endBugBlitz(blitzId: string) {
  const { host } = gamificationWiring();
  await host.requireTeamAdmin();
  await q.updateBugBlitzStatus(db(), blitzId, "ended");
  host.revalidate(["/leaderboard", "/settings"]);
  return { success: true };
}

// ── Admin actions: feature toggle ───────────────────────────────────────

export async function toggleGamification(enabled: boolean) {
  const { host } = gamificationWiring();
  const teamId = await host.requireTeamAdmin();
  await host.setEnabledForTeam(teamId, enabled);
  if (enabled) {
    // Seed default bots the first time it's enabled, and ensure a season.
    const orm = db();
    await q.ensureDefaultBots(orm, teamId);
    await ensureSeasonForTeam(orm, teamId);
  }
  host.revalidate(["/settings", "/leaderboard"]);
  return { enabled };
}

// ── Read-side: current viewer's score card ─────────────────────────────

export async function getViewerGamificationSnapshot() {
  const { host } = gamificationWiring();
  const actor = await currentViewer();
  if (!actor) return null;
  if (!(await host.isEnabledForTeam(actor.teamId))) return null;

  const orm = db();
  const season = await q.getActiveSeason(orm, actor.teamId);
  if (!season) return null;

  const blitz = await q.getActiveBugBlitz(orm, actor.teamId);
  const row = await q.getUserScoreRow(orm, season.id, "user", actor.userId);

  return {
    seasonId: season.id,
    seasonName: season.name,
    total: row?.total ?? 0,
    testsCreated: row?.testsCreated ?? 0,
    regressionsCaught: row?.regressionsCaught ?? 0,
    flakesIncurred: row?.flakesIncurred ?? 0,
    blitz: blitz
      ? {
          id: blitz.id,
          name: blitz.name,
          multiplier: blitz.multiplier,
          endsAt: blitz.endsAt,
        }
      : null,
  };
}
