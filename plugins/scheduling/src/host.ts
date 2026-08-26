/**
 * The core surface this feature needs and does not have yet.
 *
 * Costed before starting (recipe §1.5): **1 method** — the same tier as
 * `ranger`, the cheapest migration so far. Every read/write this plugin
 * performs is against its own table (`ctx.data`, via `contextFor`); the
 * single gap is triggering an actual test run, which is `core/exec`'s job
 * (`src/server/actions/builds.ts`, "builds *is* the product",
 * `core-plugin-refactor.md` §6.1) and has no port yet for anything to call.
 *
 * Shaped as "do the thing" rather than "give me the primitive" (recipe
 * §3.1): the plugin has no direct path to build creation, so there is
 * nothing in the package that could trigger a run some other way.
 *
 * `requireScheduleOwnership` (`src/lib/auth/ownership.ts`) is gone, not
 * ported. It read `queries.getBuildSchedule` — this plugin's own table after
 * the move — so keeping it in core would have meant core importing a
 * plugin, the exact edge recipe §1.6 forbids. The IDOR check it performed
 * (`schedule.repositoryId === input.repositoryId`) is now inline in
 * `actions.ts`, which already holds the row and the caller-supplied id in
 * the same scope. Three surveyed symbols (`requireRepoAccess`,
 * `requireScheduleOwnership`, the manual `repositoryId` comparison) became
 * one host method plus a two-line check, the same shape `api-test`'s
 * migration found for its own ownership guards.
 */

export interface SchedulingTriggerInput {
  readonly repositoryId: string;
  readonly runnerId: string;
  readonly gitBranch?: string;
}

export interface SchedulingTriggerResult {
  readonly buildId?: string;
  readonly testRunId?: string;
}

export interface SchedulingHost {
  /**
   * Create and run a build for a due or manually-triggered schedule. Wraps
   * `createAndRunBuildFromCI` — no guard inside, because the caller already
   * carries an id that was either resolved through `contextFor` (a manual
   * "run now") or read back from this plugin's own table by a system tick
   * (`dispatchDueSchedules`), never from an unauthenticated request.
   */
  triggerBuild(input: SchedulingTriggerInput): Promise<SchedulingTriggerResult>;
}
