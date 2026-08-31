/**
 * Coverage sync as a background job — the ONE way to run a sync detached.
 *
 * Both spawn paths go through here: the Coverage page's button (via
 * `startCoverageSyncAction`, which authorizes first) and the scheduler's
 * stale-model tick (system context, no session). Centralized because the
 * dedupe below only works if every path uses it: a sync is idempotent but
 * expensive (synchronous CSV parse, one UPDATE per cell), and two running
 * concurrently race each other through reconcile/prune. A reload-and-click,
 * or a click coinciding with a scheduler tick, must join the in-flight job
 * rather than start a second one.
 */
import * as queries from "@/lib/db/queries";
import {
  syncCoverage,
  type CoverageSyncProgress,
  type SyncOptions,
} from "@/lib/coverage/sync";
import { DEFAULT_COVERAGE_ENVIRONMENT } from "@/lib/db/schema";

/** What a finished sync job reports back, mirrored onto the job row so the
 *  poller can render the same toast the synchronous action used to return. */
export interface CoverageSyncSummary {
  dimensionsProposed: number;
  dimensionsRejected: number;
  cellsUpserted: number;
  cellsPruned: number;
  attributionsRecorded: number;
}

/**
 * Minimum gap between two heartbeat writes within one stage.
 *
 * `cleanupStaleJobs(300000)` — invoked from /api/jobs/active and
 * /api/jobs/events on every poll and SSE connect — fails any `running` job
 * silent for five minutes. Fifteen seconds is two orders of magnitude inside
 * that window while keeping the write rate negligible next to the sync's own
 * per-cell UPDATEs. A stage CHANGE always writes, whatever the throttle says.
 */
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Global ceiling on coverage syncs in flight at once, across ALL teams.
 *
 * Default 2, env-tunable like `BACKGROUND_JOBS_TEAM_CAP`. Read per call rather
 * than captured at module load so a deployment can change it without a
 * rebuild, and so tests can set it.
 */
export function coverageSyncMaxConcurrent(): number {
  const raw = Number(process.env.COVERAGE_SYNC_MAX_CONCURRENT);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

/**
 * How many NEW coverage syncs a fan-out caller may start right now.
 *
 * Deliberately consulted by the SCHEDULER ONLY, never by `startCoverageSyncJob`
 * itself. The two callers are not alike: the scheduler fans one tick out over
 * every tenant's stale repos at once (on the first tick after a deploy, or when
 * the 360-minute horizon expires for many repos together, that is one detached
 * sync per repo — synchronous CSV parse and per-cell UPDATE loop — landing in
 * the serving process simultaneously), whereas a human clicking Sync on the
 * Coverage page is one repo, deduped per repo, and already bounded per team by
 * `refuseTeamJobFlood`. Applying this ceiling to the user path would mean one
 * tenant's scheduled backlog silently refusing another tenant's click, which is
 * a worse failure than a scheduled sync waiting 60 seconds for the next tick.
 */
export async function coverageSyncStartBudget(): Promise<{
  budget: number;
  active: number;
  ceiling: number;
}> {
  const ceiling = coverageSyncMaxConcurrent();
  const active = await queries.countActiveBackgroundJobsByType("coverage_sync");
  return { budget: Math.max(0, ceiling - active), active, ceiling };
}

export interface CoverageSyncCandidate {
  repositoryId: string;
  environmentKey: string;
  /** Age of the last sync-derived snapshot; `Infinity` when never synced. */
  ageMs: number;
}

/**
 * Choose which stale repos this tick starts, and which wait for the next one.
 *
 * Stalest first, so the choice does not depend on the order
 * `getReposWithEnabledCoverageDimensions()` happens to return — taking the head
 * of that list every tick starves its tail forever once the backlog outgrows
 * the budget. With a 60-second tick and a 360-minute horizon, a couple of repos
 * per tick drains any realistic backlog long before the deferred ones age into
 * anything worse than they already are.
 *
 * Pure, so the ordering and the ceiling are testable without a scheduler.
 */
export function planCoverageSyncTick<T extends CoverageSyncCandidate>(
  candidates: T[],
  budget: number,
): { start: T[]; deferred: T[] } {
  const ordered = [...candidates].sort((a, b) => b.ageMs - a.ageMs);
  const take = Math.max(0, budget);
  return { start: ordered.slice(0, take), deferred: ordered.slice(take) };
}

/**
 * Start a coverage sync for a repo, or join the one already in flight.
 *
 * Returns as soon as the job row exists; the caller polls the job. When an
 * active `coverage_sync` job already exists for the repo, its id is returned
 * with `deduped: true` and no new work starts.
 *
 * The dedupe trusts the job row, not this process. After a restart a `running`
 * row can outlive the promise behind it, and every caller then joins a job
 * nobody is running — deliberately: the five-minute watchdog
 * (`cleanupStaleJobs`) fails such a row once its heartbeats stop, and the next
 * call starts a fresh sync. Bounded staleness beats the alternative, which is
 * a liveness probe that cannot tell a dead job from a slow one and so
 * re-introduces the concurrent-sync race this dedupe exists to prevent.
 */
export async function startCoverageSyncJob(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<{ jobId: string; deduped: boolean }> {
  const inFlight = await queries.getActiveBackgroundJobsForRepo(
    "coverage_sync",
    repositoryId,
  );
  if (inFlight.length > 0) {
    return { jobId: inFlight[0].id, deduped: true };
  }

  const { createJob, completeJob, failJob, updateJobActivity } =
    await import("@/server/actions/jobs");
  const jobId = await createJob(
    "coverage_sync",
    "Coverage sync: profiling data sources",
    1,
    repositoryId,
    { environmentKey: opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT },
  );

  // Heartbeat. Without it the watchdog marks a >5min sync as crashed while its
  // promise keeps working: the Coverage poller reports failure for work that
  // completes, and — worse — the dedupe above stops seeing an active job, so
  // the next click or scheduler tick starts a SECOND sync racing the first
  // through reconcile/prune. Best-effort throughout: a failed heartbeat write
  // must never take the sync down with it.
  let lastBeatAt = 0;
  let lastStage: string | null = null;
  const onStage = async (progress: CoverageSyncProgress) => {
    const now = Date.now();
    if (
      progress.stage === lastStage &&
      now - lastBeatAt < HEARTBEAT_INTERVAL_MS
    ) {
      return;
    }
    lastStage = progress.stage;
    lastBeatAt = now;
    const label =
      progress.total && progress.total > 0
        ? `${progress.label} (${progress.done ?? 0}/${progress.total})`
        : progress.label;
    try {
      // The label carries the stage into the jobs panel; updateJobActivity
      // stamps lastActivityAt (what the watchdog reads) and re-broadcasts the
      // row, so the panel sees the new label without a second emit.
      await queries.updateBackgroundJob(jobId, { label });
      await updateJobActivity(jobId);
    } catch (err) {
      console.warn(
        `[coverage] heartbeat failed for sync job ${jobId} (${progress.stage}):`,
        err,
      );
    }
  };

  // Fire-and-forget: the caller returns as soon as the row exists. No
  // revalidatePath in here — after the spawning response is sent it is a
  // no-op; the client's poll → router.refresh() is what repaints.
  void (async () => {
    try {
      const result = await syncCoverage(repositoryId, { ...opts, onStage });
      const summary: CoverageSyncSummary = {
        dimensionsProposed: result.dimensionsProposed,
        dimensionsRejected: result.dimensionsRejected.length,
        cellsUpserted: result.cellsUpserted,
        cellsPruned: result.cellsPruned,
        attributionsRecorded: result.attributionsRecorded,
      };
      await queries.updateBackgroundJob(jobId, {
        metadata: {
          environmentKey: result.environmentKey,
          summary,
          rejected: result.dimensionsRejected,
        },
      });
      // The row can have left `running` under us — the watchdog failing it
      // during a heartbeat gap, or a user cancelling. The summary above is
      // still recorded (the work really did happen and the model really is
      // fresh), but the terminal status stands: flipping a failed/cancelled
      // job back to `completed` minutes later rewrites the timeline and hides
      // the fact that the watchdog fired.
      const row = await queries.getBackgroundJob(jobId).catch(() => null);
      if (row && row.status !== "running") {
        console.warn(
          `[coverage] sync job ${jobId} finished but the row is already "${row.status}" — leaving it; summary recorded in metadata`,
        );
        return;
      }
      await completeJob(jobId);
    } catch (err) {
      const row = await queries.getBackgroundJob(jobId).catch(() => null);
      if (row && row.status !== "running") {
        console.warn(
          `[coverage] sync job ${jobId} failed after the row left "running" ("${row.status}"):`,
          err,
        );
        return;
      }
      await failJob(
        jobId,
        err instanceof Error ? err.message : "Coverage sync failed",
      ).catch(() => {});
    }
  })();

  return { jobId, deduped: false };
}
