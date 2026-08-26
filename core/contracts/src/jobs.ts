/**
 * Background jobs.
 *
 * Core under the revised bar (`docs/architecture/core-scope.md` §2) because the
 * queue is *shared capacity*: a plugin that enqueues without bound, or retries
 * forever, starves every other tenant's work. Core owns admission, rate,
 * retries and the poll loop; the plugin owns the body.
 *
 * This is also how plugins compose without importing each other (§4.3 of the
 * RFC): "run the other feature" becomes `enqueue("qa-agent.crawl", payload)`.
 */

/** `"<pluginId>.<name>"`. The kernel rejects a handler that breaks this. */
export type JobType = string;

export interface EnqueueOptions {
  /** Delay before the job becomes eligible to run. */
  readonly delayMs?: number;
  /**
   * Collapse duplicates: enqueuing the same key while one is pending is a
   * no-op. Cheaper and less surprising than every plugin inventing its own
   * debounce, and it keeps a retry storm from becoming a queue flood.
   */
  readonly dedupeKey?: string;
  /** Default is core's, not the plugin's — retries are shared capacity. */
  readonly maxAttempts?: number;
}

export interface JobRef {
  readonly id: string;
  readonly type: JobType;
  readonly runAfter: Date;
}

export interface JobRun {
  readonly id: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Aborted when core needs the worker back — deploys, deadline, cancellation. */
  readonly signal: AbortSignal;
}

export interface JobsCapability {
  /**
   * Enqueue a job. The type must belong to *some* plugin, not necessarily this
   * one — that is what makes cross-feature composition possible without an
   * import. Core checks the target type is registered.
   */
  enqueue(
    type: JobType,
    payload: unknown,
    opts?: EnqueueOptions,
  ): Promise<JobRef>;

  cancel(jobId: string): Promise<void>;
  status(
    jobId: string,
  ): Promise<"pending" | "running" | "done" | "failed" | null>;
}

/** A plugin's job handler. Registered in the manifest, invoked by core. */
export type JobHandler<TCtx = unknown> = (
  ctx: TCtx,
  payload: unknown,
  run: JobRun,
) => Promise<void>;
