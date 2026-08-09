import type {
  EnqueueOptions,
  JobRef,
  JobsCapability,
} from "@lastest/contracts";

import type { JobsHost } from "./host";

export interface JobsCapabilityScope {
  readonly pluginId: string;
  readonly teamId: string;
  readonly repositoryId?: string;
}

/**
 * Build the `jobs` capability for one plugin's context.
 *
 * Team and repo are captured here, at build time, and threaded into every
 * `enqueue` — the same reason `createReposCapability` captures `team` rather
 * than trusting an argument: the scope was already authorized once, by
 * `buildContext`, and re-deriving it per call could only trust the same value
 * again while adding a place for a caller to lie.
 */
export function createJobsCapability(
  host: JobsHost,
  scope: JobsCapabilityScope,
): JobsCapability {
  return {
    async enqueue(
      type: string,
      payload: unknown,
      opts?: EnqueueOptions,
    ): Promise<JobRef> {
      const { id, runAfter } = await host.enqueue({
        callerPluginId: scope.pluginId,
        type,
        payload,
        teamId: scope.teamId,
        repositoryId: scope.repositoryId,
        delayMs: opts?.delayMs,
        dedupeKey: opts?.dedupeKey,
        maxAttempts: opts?.maxAttempts,
      });
      return { id, type, runAfter };
    },

    cancel(jobId: string): Promise<void> {
      return host.cancel(jobId);
    },

    status(jobId: string) {
      return host.status(jobId);
    },
  };
}
