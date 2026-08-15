import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-launch` — the "Tested & Featured" launch board, the third
 * plugin of RFC §9 phase 4 (after `rca` and `app-map`).
 *
 * ### The new shape this one proves: a plugin with no tenant
 *
 * Every plugin before this held team- or repo-scoped data and reached it
 * through a `ctx` built by `runtime.contextFor(manifest, { repositoryId })`.
 * Launch has no tenant anywhere in it. It is a public directory: readers are
 * anonymous, writers are identified by a user id plus an OAuth scope, and its
 * seven tables have no `team_id` column to scope by. There is no repository,
 * no plan, no entitlement.
 *
 * So this plugin never calls `contextFor` and never holds a `PluginContext`.
 * It takes its `DataCapability` straight from the wiring slot — the same route
 * every plugin's *deletion hook* already uses, since a hook also runs without a
 * scope. See `wiring.ts`.
 *
 * That is worth being precise about rather than glossing: `ctx.team` is the
 * kernel's tenancy assertion, and launch does not get one because there is
 * nothing true to put in it. Inventing a synthetic team just to satisfy the
 * signature would have been the worse outcome — a tenancy check that always
 * passes reads exactly like a tenancy check that works. What the plugin *does*
 * still get is the data boundary: the handle is the schema-scoped one
 * `core/data` built after validating the `launch_` prefix on all seven tables,
 * so it can reach its own tables and nothing else.
 *
 * ### Surfaces
 *
 * - **No `ui.nav`, no page.** The frontend is a separate static-export repo
 *   (launch.lastest.cloud); this package is its backend. The only surface is
 *   the REST API re-exported by `src/app/api/v1/launch/[...path]/route.ts`
 *   from `./api/handlers`.
 * - **No server actions.** There is nothing in the app that calls this feature
 *   — which is why, unlike every previous migration, there is no `actions.ts`
 *   and the `server-reference-manifest` count in
 *   `plugin-migration-recipe.md` §8 is not the gate here. `pnpm build`
 *   resolving the route is.
 * - **One timed entry point.** `src/lib/core/scheduler.ts` calls
 *   `processLaunchCohorts()` on its 60s tick, imported from
 *   `@lastest/plugin-launch/cohorts`.
 */
export const launchPlugin = definePlugin({
  id: "launch",
  title: "Launch board",

  // No team anywhere in this feature — see the note above. Declared rather
  // than merely true: `resolveRegistry` now refuses any capability beyond
  // `data` for such a plugin, refuses `provides` and refuses job handlers, and
  // `buildContext` throws `UntenantedPluginError` if anything hands one a
  // scope. When this plugin landed, the only signal was the absent `runtime`
  // in `wiring.ts`; the field arrived with `@lastest/plugin-playground`, the
  // second plugin of this shape.
  tenancy: "none",

  // `data` and nothing else. No browser, no AI, no jobs, no events — the board
  // computes rankings from its own rows and serves JSON.
  capabilities: ["data"],

  // Loaded once at boot by `core/data`, which validates the `launch_` prefix on
  // every table before binding a handle to it.
  schema: () => import("./schema"),

  // Required whenever `schema` is present — `resolveRegistry` refuses to boot
  // without it. The FKs to `users.id` this replaces are named in `deletion.ts`.
  deletion: createDeletionHook(),
});

export default launchPlugin;

export { LAUNCH_CONFIG, LAUNCH_SCOPES } from "./config";
export { processLaunchCohorts } from "./domain/cohort-engine";
export type { LaunchActor, LaunchHost } from "./host";
export {
  configureLaunch,
  isLaunchConfigured,
  type LaunchWiring,
} from "./wiring";
