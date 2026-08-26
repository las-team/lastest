/**
 * `@lastest/core-jobs` — the `jobs` capability: a shared queue plugins enqueue
 * into and register handlers against.
 *
 * Core under `docs/architecture/core-scope.md` §2 as **capacity** — a plugin
 * that enqueues without bound, or whose handler retries forever, starves every
 * other tenant's work. Core owns admission, backoff and the poll loop; the
 * plugin owns the handler body (`PluginManifest.jobs`, already implemented in
 * `@lastest/kernel`'s `PluginRuntime.dispatch`).
 *
 * This is also the answer to RFC §4.3's cross-plugin composition: "run the
 * other feature" becomes `ctx.jobs.enqueue("qa-agent.crawl", payload)` instead
 * of an import.
 */
import { createJobsCapability } from "./jobs";
import type { JobsHost } from "./host";

export { createJobsCapability } from "./jobs";
export type { JobsCapabilityScope } from "./jobs";

export type { EnqueueRequest, EnqueuedJob, JobsHost, JobStatus } from "./host";

export interface JobsScope {
  readonly team: { readonly id: string };
  readonly repo?: { readonly id: string };
}

export interface JobsFactoryOptions {
  readonly host: JobsHost;
}

/** Mirrors `createBrowserFactory`'s shape — see `core/repos` for the twin. */
export function createJobsFactory(opts: JobsFactoryOptions) {
  return (pluginId: string, scope: JobsScope) =>
    createJobsCapability(opts.host, {
      pluginId,
      teamId: scope.team.id,
      repositoryId: scope.repo?.id,
    });
}

export { processDueJobs } from "./worker";
export type {
  ClaimedJob,
  DispatchFn,
  DispatchRun,
  ProcessDueJobsOptions,
  WorkerHost,
} from "./worker";
