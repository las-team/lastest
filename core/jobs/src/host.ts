/**
 * The host port for the *plugin-facing* half of `JobsCapability`.
 *
 * `core/**` may never import `@/…`, so the actual queue table is injected —
 * same shape and reason as `core/browser`'s `BrowserHost`. See
 * `packages/db/src/schema/runs.ts` (`pluginJobs`) for the table this backs.
 */

export interface EnqueueRequest {
  /** The plugin that called `ctx.jobs.enqueue` — recorded for audit, not for authorization. */
  readonly callerPluginId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly teamId?: string;
  readonly repositoryId?: string;
  readonly delayMs?: number;
  readonly dedupeKey?: string;
  readonly maxAttempts?: number;
}

export interface EnqueuedJob {
  readonly id: string;
  readonly runAfter: Date;
}

export type JobStatus = "pending" | "running" | "done" | "failed" | null;

export interface JobsHost {
  /**
   * Persist the job. Implementations are expected to have already confirmed
   * `type` belongs to a registered plugin — `ctx.jobs.enqueue` accepting any
   * string and the queue accepting any type is how a typo becomes a job that
   * can never be claimed by a handler. Where that check lives is the app's
   * call: see `docs/architecture/explorer-migration-result.md`-style host
   * comments in `src/lib/core/jobs-host.ts`.
   */
  enqueue(req: EnqueueRequest): Promise<EnqueuedJob>;
  /** Safe to call on an unknown id, or one already finished — a no-op either way. */
  cancel(jobId: string): Promise<void>;
  status(jobId: string): Promise<JobStatus>;
}
