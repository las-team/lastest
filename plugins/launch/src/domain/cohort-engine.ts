/**
 * Weekly cohort state engine. Drives the open → voting → locked → closed
 * lifecycle on PT week boundaries and derives the Founder-of-the-Week winner.
 *
 * Lives here (not in the app's scheduler) so both the 60s scheduler tick and
 * the submission endpoint can call `ensureUpcomingCohort` /
 * `processLaunchCohorts`. Every function is idempotent and safe to run on every
 * tick.
 *
 * `processLaunchCohorts()` is the plugin's one *exported* entry point that the
 * app calls on a timer — `src/lib/core/scheduler.ts` imports it from
 * `@lastest/plugin-launch/cohorts`. It resolves its own database handle from
 * the wiring slot, because a cron tick has no request and no scope. That it
 * needs no `ctx` is the same fact as everything else about this plugin: the
 * board has no tenant.
 */

import { db as pluginDb } from "../data/db";
import type { LaunchDb } from "../data/db";
import {
  clearSuspiciousVotes,
  createCohort,
  getCohortById,
  getCohortByWeekStart,
  listCohortsByStateAsc,
  listFeaturedProfilesByCohort,
  lockCohortWinner,
  setCohortState,
} from "../data/queries";
import type { LaunchCohort } from "../schema";
import { currentWeekStartPT, nextWeekStartPT, weekEndPT } from "./time";
import { pickWinnerSlug } from "./velocity";

// Drizzle wraps the driver error and hangs the real PostgresError (with
// `.code`) off `.cause`, so check both levels.
function isUniqueViolation(err: unknown): boolean {
  for (let cur: unknown = err, depth = 0; cur && depth < 3; depth++) {
    if (
      typeof cur === "object" &&
      "code" in cur &&
      (cur as { code?: string }).code === "23505"
    ) {
      return true;
    }
    cur =
      typeof cur === "object" && "cause" in cur
        ? (cur as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

async function ensureCohortForWeek(
  db: LaunchDb,
  weekStart: Date,
): Promise<LaunchCohort> {
  const existing = await getCohortByWeekStart(db, weekStart);
  if (existing) return existing;
  try {
    return await createCohort(db, {
      weekStartAt: weekStart,
      weekEndAt: weekEndPT(weekStart),
      state: "open",
      winnerSlug: null,
    });
  } catch (err) {
    // Another pod won the race for this week — re-read and return it.
    if (isUniqueViolation(err)) {
      const row = await getCohortByWeekStart(db, weekStart);
      if (row) return row;
    }
    throw err;
  }
}

/**
 * Ensure both the current week's cohort and the upcoming week's cohort exist.
 * Returns the upcoming `open` cohort — the home for newly queued submissions.
 */
export async function ensureUpcomingCohort(
  db: LaunchDb,
  now: Date = new Date(),
): Promise<LaunchCohort> {
  const thisWeek = currentWeekStartPT(now);
  await ensureCohortForWeek(db, thisWeek);
  return ensureCohortForWeek(db, nextWeekStartPT(thisWeek));
}

/** Recompute votes, pick the velocity winner, and lock a cohort. Returns the winner slug. */
export async function lockCohortNow(
  db: LaunchDb,
  cohortId: string,
  now: Date = new Date(),
): Promise<string | null> {
  await clearSuspiciousVotes(db, cohortId);
  const featured = await listFeaturedProfilesByCohort(db, cohortId);
  const cohort = await getCohortById(db, cohortId);
  const winner = pickWinnerSlug(featured, cohort?.weekStartAt ?? now, now);
  await lockCohortWinner(db, cohortId, winner);
  return winner;
}

/**
 * Advance every due cohort to its next state. Idempotent:
 *  - ensure this-week + next-week cohorts exist
 *  - open → voting once the week has started
 *  - voting → locked (winner decided) once the week has ended
 *  - locked → closed once a newer week has begun
 */
export async function processLaunchCohorts(now: Date = new Date()) {
  const db = pluginDb();
  await ensureUpcomingCohort(db, now);
  const thisWeekStart = currentWeekStartPT(now);

  for (const c of await listCohortsByStateAsc(db, ["open"])) {
    if (c.weekStartAt && c.weekStartAt.getTime() <= now.getTime()) {
      await setCohortState(db, c.id, "voting");
    }
  }

  for (const c of await listCohortsByStateAsc(db, ["voting"])) {
    if (c.weekEndAt && c.weekEndAt.getTime() < now.getTime()) {
      await lockCohortNow(db, c.id, now);
    }
  }

  for (const c of await listCohortsByStateAsc(db, ["locked"])) {
    if (c.weekStartAt && c.weekStartAt.getTime() < thisWeekStart.getTime()) {
      await setCohortState(db, c.id, "closed");
    }
  }
}
