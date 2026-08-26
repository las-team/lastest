import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-playground` — the score & leaderboard backend for the
 * static /playground exercises. The fifth plugin of RFC §9 phase 4, after
 * `rca`, `app-map`, `launch` and `api-test`.
 *
 * ### The second untenanted plugin, and the first to say so
 *
 * `launch` proved a plugin can have no tenant: its rows belong to a person,
 * not a team, so it never built a `PluginContext` and took its
 * `DataCapability` straight from its wiring slot. But nothing in its manifest
 * recorded that — the only signal was the *absence* of a `runtime`, which is
 * invisible to a reader and unenforced by anything.
 *
 * `plugin-migration-recipe.md` §2.2 said to fix that in the kernel *before* a
 * second untenanted plugin appeared rather than after. It did, so:
 * `tenancy: "none"` below is a declaration `resolveRegistry` acts on. It
 * refuses any capability beyond `data` for such a plugin (every other one is
 * built from a resolved team), refuses `provides` (a provider is handed its
 * consumer's team), refuses job handlers (dispatch builds a context), and
 * `buildContext` throws `UntenantedPluginError` if anything hands one a scope
 * anyway.
 *
 * The playground has exactly the same shape as launch and for the same reason:
 * the leaderboard renders anonymously, writers are identified by a user id
 * plus a `playground:score` OAuth scope, and `playground_achievements` has no
 * `team_id` column. A `ctx.team` here would be a fabrication, and a tenancy
 * check that always passes reads exactly like one that works.
 *
 * ### Surfaces
 *
 * - **No `ui.nav`, no page.** The frontend is a separate static-export repo
 *   (lastest-www); this package is its backend. The only surface is the REST
 *   API re-exported by `src/app/api/v1/playground/[...path]/route.ts` from
 *   `./api/handlers`.
 * - **No server actions.** Nothing in the app calls this feature, so — as with
 *   `launch` — the `server-reference-manifest` count in
 *   `plugin-migration-recipe.md` §8 is vacuously zero and is not the gate.
 *   `pnpm build` resolving the route is.
 * - **No timed entry point.** Unlike launch, nothing here runs on a tick; the
 *   only background-ish state is a 60s in-process board cache.
 */
export const playgroundPlugin = definePlugin({
  id: "playground",
  title: "Playground leaderboard",

  // No team anywhere in this feature. See the note above, and `wiring.ts`.
  tenancy: "none",

  // `data` and nothing else — the only capability an untenanted plugin may
  // consume, because `core/data` scopes by plugin id rather than by tenant.
  capabilities: ["data"],

  // Loaded once at boot by `core/data`, which validates the `playground_`
  // prefix before binding a handle to it.
  schema: () => import("./schema"),

  // Required whenever `schema` is present. Replaces the `ON DELETE CASCADE`
  // FK to `users.id` that `core-scope.md` §6 removes — see `deletion.ts`.
  deletion: createDeletionHook(),
});

export default playgroundPlugin;

export { PLAYGROUND_CONFIG, PLAYGROUND_SCOPES } from "./config";
export { ACHIEVEMENT_POINTS, EXERCISE_COMPLETION, scoreFor } from "./registry";
export type {
  PlaygroundActor,
  PlaygroundHost,
  PlaygroundRateLimit,
  PlaygroundUser,
} from "./host";
export {
  configurePlayground,
  isPlaygroundConfigured,
  type PlaygroundWiring,
} from "./wiring";
