import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-scheduling` — recurring build schedules ("run these tests
 * every night at 3am"), the settings-page cron UI, and the tick that fires
 * them.
 *
 * RFC §9 phase 4's thirteenth plugin, after `rca`, `app-map`, `launch`,
 * `api-test`, `playground`, `gamification`, `ci`, `share`, `awards`,
 * `ranger`, `recorder` and `data-sources`. Costed at **1 host method** before
 * starting (recipe §1.5) — the same tier as `ranger`, the cheapest migration
 * so far — because every read and write here is against this plugin's own
 * table; the only thing core does that this feature cannot is create and run
 * a build. See `host.ts`.
 *
 * ### What did *not* come with it
 *
 * `PSEUDO_PLUGINS["scheduling"]`'s old map entry named two action modules,
 * `schedules.ts` and `scanner.ts`. Reading `scanner.ts`'s import list found
 * it shares no table, type or import with schedules/cron — it is repository
 * route discovery, functional-area creation and smoke-test generation, all
 * against core's `routes`/`functionalAreas`/`tests` tables, with a port that
 * would run past recipe §1.5's stop line (~25 core calls surveyed). It never
 * belonged to this feature; it sat beside it by directory convention only.
 * Left as its own uncosted `PSEUDO_PLUGINS["route-scan"]` entry rather than
 * migrated or silently dropped from the burndown — the same call
 * `data-sources` made for `spec-import.ts`. See the migration result doc §1.
 *
 * ### `src/lib/scheduling/scheduler.ts` was never this feature either
 *
 * The 60-second tick loop lived next to `schedules.ts` by directory
 * convention, but three of its four handlers dispatch *other* features'
 * triggers (QA agent, explorer, launch cohorts) — `core/jobs`'s own
 * `worker.ts` already documented it as "the app's scheduler", and
 * `plugins/launch/src/domain/cohort-engine.ts` calls it exactly that. A
 * §1.6 "reclassify": the loop moved to `src/lib/core/scheduler.ts` unchanged
 * in shape, and only its build-schedule handler became a call into this
 * plugin's own `dispatchDueSchedules()` — the same call shape
 * `dispatchDueExplorerTriggers` and `processLaunchCohorts` already used.
 */
export const schedulingPlugin = definePlugin({
  id: "scheduling",
  title: "Scheduling",

  capabilities: ["data"],

  // Loaded once at boot by `core/data`, which validates the `scheduling_`
  // prefix on every table before binding a handle to it.
  schema: () => import("./schema"),

  // Required whenever `schema` is present — `resolveRegistry` refuses to
  // boot without it. See `deletion.ts` for the FK this replaces.
  deletion: createDeletionHook(),
});

export default schedulingPlugin;

export type {
  SchedulingHost,
  SchedulingTriggerInput,
  SchedulingTriggerResult,
} from "./host";
export {
  configureScheduling,
  isSchedulingConfigured,
  type SchedulingWiring,
} from "./wiring";
export type { BuildSchedule, NewBuildSchedule } from "./schema";
