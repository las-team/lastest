/**
 * Weekly cohort state engine. Drives the open → voting → locked → closed
 * lifecycle on PT week boundaries and derives the Founder-of-the-Week winner.
 *
 * Lives here (not in the scheduler) so both the 60s scheduler tick and the
 * submission route can call `ensureUpcomingCohort` / `processLaunchCohorts`.
 * Every function is idempotent and safe to run on every tick.
 */

import * as queries from '@/lib/db/queries';
import { currentWeekStartPT, weekEndPT, nextWeekStartPT } from './time';
import { pickWinnerSlug } from './velocity';
import type { LaunchCohort } from '@/lib/db/schema';

// Drizzle wraps the driver error and hangs the real PostgresError (with
// `.code`) off `.cause`, so check both levels.
function isUniqueViolation(err: unknown): boolean {
  for (let cur: unknown = err, depth = 0; cur && depth < 3; depth++) {
    if (typeof cur === 'object' && 'code' in cur && (cur as { code?: string }).code === '23505') {
      return true;
    }
    cur = typeof cur === 'object' && 'cause' in cur ? (cur as { cause?: unknown }).cause : undefined;
  }
  return false;
}

async function ensureCohortForWeek(weekStart: Date): Promise<LaunchCohort> {
  const existing = await queries.getCohortByWeekStart(weekStart);
  if (existing) return existing;
  try {
    return await queries.createCohort({
      weekStartAt: weekStart,
      weekEndAt: weekEndPT(weekStart),
      state: 'open',
      winnerSlug: null,
    });
  } catch (err) {
    // Another pod won the race for this week — re-read and return it.
    if (isUniqueViolation(err)) {
      const row = await queries.getCohortByWeekStart(weekStart);
      if (row) return row;
    }
    throw err;
  }
}

/**
 * Ensure both the current week's cohort and the upcoming week's cohort exist.
 * Returns the upcoming `open` cohort — the home for newly queued submissions.
 */
export async function ensureUpcomingCohort(now: Date = new Date()): Promise<LaunchCohort> {
  const thisWeek = currentWeekStartPT(now);
  await ensureCohortForWeek(thisWeek);
  return ensureCohortForWeek(nextWeekStartPT(thisWeek));
}

/** Recompute votes, pick the velocity winner, and lock a cohort. Returns the winner slug. */
export async function lockCohortNow(cohortId: string, now: Date = new Date()): Promise<string | null> {
  await queries.clearSuspiciousVotes(cohortId);
  const featured = await queries.listFeaturedProfilesByCohort(cohortId);
  const cohort = await queries.getCohortById(cohortId);
  const winner = pickWinnerSlug(featured, cohort?.weekStartAt ?? now, now);
  await queries.lockCohortWinner(cohortId, winner);
  return winner;
}

/**
 * Advance every due cohort to its next state. Idempotent:
 *  - ensure this-week + next-week cohorts exist
 *  - open → voting once the week has started
 *  - voting → locked (winner decided) once the week has ended
 *  - locked → closed once a newer week has begun
 */
export async function processLaunchCohorts(now: Date = new Date()): Promise<void> {
  await ensureUpcomingCohort(now);
  const thisWeekStart = currentWeekStartPT(now);

  for (const c of await queries.listCohortsByStateAsc(['open'])) {
    if (c.weekStartAt && c.weekStartAt.getTime() <= now.getTime()) {
      await queries.setCohortState(c.id, 'voting');
    }
  }

  for (const c of await queries.listCohortsByStateAsc(['voting'])) {
    if (c.weekEndAt && c.weekEndAt.getTime() < now.getTime()) {
      await lockCohortNow(c.id, now);
    }
  }

  for (const c of await queries.listCohortsByStateAsc(['locked'])) {
    if (c.weekStartAt && c.weekStartAt.getTime() < thisWeekStart.getTime()) {
      await queries.setCohortState(c.id, 'closed');
    }
  }
}
