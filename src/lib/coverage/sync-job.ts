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
import { syncCoverage, type SyncOptions } from "@/lib/coverage/sync";
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
 * Start a coverage sync for a repo, or join the one already in flight.
 *
 * Returns as soon as the job row exists; the caller polls the job. When an
 * active `coverage_sync` job already exists for the repo, its id is returned
 * with `deduped: true` and no new work starts.
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

  const { createJob, completeJob, failJob } =
    await import("@/server/actions/jobs");
  const jobId = await createJob(
    "coverage_sync",
    "Coverage sync: profiling data sources",
    1,
    repositoryId,
    { environmentKey: opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT },
  );

  // Fire-and-forget: the caller returns as soon as the row exists. No
  // revalidatePath in here — after the spawning response is sent it is a
  // no-op; the client's poll → router.refresh() is what repaints.
  void (async () => {
    try {
      const result = await syncCoverage(repositoryId, opts);
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
      await completeJob(jobId);
    } catch (err) {
      await failJob(
        jobId,
        err instanceof Error ? err.message : "Coverage sync failed",
      ).catch(() => {});
    }
  })();

  return { jobId, deduped: false };
}
