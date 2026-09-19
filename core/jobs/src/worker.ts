/**
 * The worker-side half — claiming due jobs and driving `PluginRuntime.dispatch`.
 *
 * Not the interval itself. `src/lib/core/scheduler.ts` already owns a
 * single 60-second-tick loop pattern for this app; the composition root calls
 * `processDueJobs` from a tick of its own, the same way it calls
 * `processDueExplorerTriggers`. Keeping the loop out of this package is what
 * lets `processDueJobs` be unit tested without a real timer.
 */

export interface ClaimedJob {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly teamId: string | null;
  readonly repositoryId: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface WorkerHost {
  claimDue(limit: number): Promise<ClaimedJob[]>;
  complete(jobId: string): Promise<void>;
  failAttempt(jobId: string, error: string): Promise<void>;
  /**
   * Refresh this worker's lease on a job it is executing, and report whether
   * the job was cancelled meanwhile. Called every `heartbeatMs` for the
   * duration of the handler. `cancelled: true` aborts the handler's signal —
   * it is the only path by which an operator's cancel reaches a handler
   * already in flight.
   */
  heartbeat?(jobId: string): Promise<{ cancelled: boolean }>;
  /**
   * Settle `running` jobs whose lease expired because their worker died.
   * Called once per tick, before claiming, so a dead job's dedupe key is
   * released before the tick's new enqueues could collapse into it.
   */
  reapExpired?(): Promise<number>;
}

export interface DispatchRun {
  readonly id: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly signal: AbortSignal;
}

/**
 * Structurally `PluginRuntime["dispatch"]`. Not imported from `@lastest/kernel`
 * so this package does not have to depend on it — the shape is small and
 * stable enough to duplicate rather than couple two core packages together.
 */
export type DispatchFn = (
  type: string,
  payload: unknown,
  run: DispatchRun,
  scope?: { teamId?: string; repositoryId?: string },
) => Promise<void>;

export interface ProcessDueJobsOptions {
  readonly host: WorkerHost;
  readonly dispatch: DispatchFn;
  readonly batchSize?: number;
  /** Aborts the handler's signal after this long. No default — unbounded unless asked for. */
  readonly perJobTimeoutMs?: number;
  /** Interval for `host.heartbeat`. Must be well under the host's lease. */
  readonly heartbeatMs?: number;
  readonly onError?: (job: ClaimedJob, err: unknown) => void;
}

export const DEFAULT_HEARTBEAT_MS = 30_000;

/**
 * One tick: claim due jobs, dispatch each, settle pass/fail. Sequential, not
 * parallel — twenty plugins' jobs firing at once is the capacity incident
 * `core-scope.md` §2 puts jobs in core to prevent, the same argument
 * `runDeletionHooks` makes for deletion hooks.
 *
 * Returns the number of jobs processed this tick, for the caller to log.
 */
export async function processDueJobs(
  opts: ProcessDueJobsOptions,
): Promise<number> {
  await opts.host.reapExpired?.();
  const jobs = await opts.host.claimDue(opts.batchSize ?? 10);

  for (const job of jobs) {
    const controller = new AbortController();
    const timeout = opts.perJobTimeoutMs
      ? setTimeout(() => controller.abort(), opts.perJobTimeoutMs)
      : undefined;
    // The lease. While the handler runs, the row's heartbeat is refreshed so
    // a reaper on another process does not mistake a long job for a dead one,
    // and a cancel that landed on the row aborts the signal. A heartbeat
    // that itself fails (database blip) is ignored: the lease is generous, and
    // the next beat will catch up.
    const heartbeat = opts.host.heartbeat
      ? setInterval(() => {
          opts.host.heartbeat!(job.id)
            .then(({ cancelled }) => {
              if (cancelled) controller.abort();
            })
            .catch(() => {});
        }, opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS)
      : undefined;
    try {
      await opts.dispatch(
        job.type,
        job.payload,
        {
          id: job.id,
          attempt: job.attempts + 1,
          maxAttempts: job.maxAttempts,
          signal: controller.signal,
        },
        {
          teamId: job.teamId ?? undefined,
          repositoryId: job.repositoryId ?? undefined,
        },
      );
      await opts.host.complete(job.id);
    } catch (err) {
      opts.onError?.(job, err);
      await opts.host.failAttempt(
        job.id,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  return jobs.length;
}
