import "server-only";

import type { JobsHost } from "@lastest/core-jobs";

import {
  cancelPluginJob,
  enqueuePluginJob,
  getPluginJobStatus,
} from "@/lib/db/queries";

/**
 * The app's fill for `JobsHost`.
 *
 * `isRegisteredType` is injected rather than imported from `@/lib/core/runtime`
 * — that module is the composition root that builds *this* host, so importing
 * it back here would be a circular module dependency. `runtime.ts` closes over
 * its own resolved registry and passes the check in.
 *
 * `enqueue` validates `type` against it before writing a row — `core/jobs`'s
 * host doc is explicit that this is the app's call, because the registry
 * (which plugin owns which job type) is composed here, not in `core/jobs`
 * itself. Rejecting an unregistered type at enqueue time is what stops a typo
 * becoming a row the worker loop can never claim.
 */
export function createAppJobsHost(
  isRegisteredType: (type: string) => boolean,
): JobsHost {
  return {
    async enqueue(req) {
      if (!isRegisteredType(req.type)) {
        throw new Error(
          `No plugin registers job type "${req.type}" — check the spelling ` +
            `against that plugin's manifest`,
        );
      }
      const pluginId = req.type.split(".")[0]!;
      const job = await enqueuePluginJob({
        pluginId,
        type: req.type,
        payload: req.payload,
        teamId: req.teamId,
        repositoryId: req.repositoryId,
        delayMs: req.delayMs,
        dedupeKey: req.dedupeKey,
        maxAttempts: req.maxAttempts,
      });
      return { id: job.id, runAfter: job.runAfter };
    },

    async cancel(jobId) {
      await cancelPluginJob(jobId);
    },

    async status(jobId) {
      const status = await getPluginJobStatus(jobId);
      // `JobsCapability.status`'s contract union has no "cancelled" — a
      // cancelled job did not complete successfully, which is what "failed"
      // already means at this boundary. The queue keeps the more specific
      // status internally; only the capability's public shape is narrowed.
      return status === "cancelled" ? "failed" : status;
    },
  };
}
