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
  readonly onError?: (job: ClaimedJob, err: unknown) => void;
}

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
  const jobs = await opts.host.claimDue(opts.batchSize ?? 10);

  for (const job of jobs) {
    const controller = new AbortController();
    const timeout = opts.perJobTimeoutMs
      ? setTimeout(() => controller.abort(), opts.perJobTimeoutMs)
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
    }
  }

  return jobs.length;
}
