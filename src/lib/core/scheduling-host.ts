import "server-only";

import type {
  SchedulingHost,
  SchedulingTriggerInput,
  SchedulingTriggerResult,
} from "@lastest/plugin-scheduling/host";

/**
 * The app's fill for `SchedulingHost`.
 *
 * One adapter, no new behaviour: `createAndRunBuildFromCI` is exactly the
 * call `src/lib/scheduling/scheduler.ts` and `src/server/actions/schedules.ts`
 * made inline before the migration. Imported dynamically for the reason it
 * always was — `@/server/actions/builds.ts` is a large action module, and a
 * static import here would pull it into the composition root's module graph
 * for every request, not only the scheduled-run path.
 */
export const appSchedulingHost: SchedulingHost = {
  async triggerBuild(
    input: SchedulingTriggerInput,
  ): Promise<SchedulingTriggerResult> {
    const { createAndRunBuildFromCI } = await import("@/server/actions/builds");
    const result = await createAndRunBuildFromCI({
      triggerType: "scheduled",
      repositoryId: input.repositoryId,
      runnerId: input.runnerId,
      gitBranch: input.gitBranch,
    });
    // `createAndRunBuildFromCI` returns `null` for a queued (pool-exhausted)
    // build rather than `undefined` — normalized here so the port's contract
    // stays "absent means not yet run" without leaking that distinction.
    return {
      buildId: result.buildId ?? undefined,
      testRunId: result.testRunId ?? undefined,
    };
  },
};
