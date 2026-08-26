import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-gamification` — "Beat the Bot": seasons, bug blitzes, a
 * score ledger, running totals, achievements, and a leaderboard where humans
 * compete with the product's own agents. The sixth plugin of RFC §9 phase 4.
 *
 * ### What this one is, that the previous five were not
 *
 * It is the first migrated feature that **core was calling**. `createTest()`
 * ended with `import("@/lib/gamification/hooks")`, so the dependency ran
 * core → feature, the one direction §3 forbids outright — and `pnpm arch`
 * never saw it, because the walker inspects plugin imports rather than core's.
 * Inverting that (`src/lib/db/test-hooks.ts`) was the core PR ahead of this
 * migration, and it was blocking in the strict sense: a package cannot be
 * imported from inside the query layer without making core depend on it.
 *
 * It is also the first that had to **rename its tables**. Five of six were not
 * `gamification_`-prefixed — including two, `achievements` and `user_scores`,
 * generic enough to read like core concepts. See `schema.ts`.
 *
 * ### Surfaces
 *
 * - **Server actions** (`./actions`) — the award primitive, four admin
 *   actions, the viewer's score card, and the `onTestCreated` listener the
 *   composition root registers into core's port.
 * - **Server-component reads** (`./reads`) — deliberately not actions; the
 *   `/leaderboard` and `/settings` pages import them directly.
 * - **Two client components** (`./ui/*`) — the header score chip and the
 *   celebration listener.
 * - **No `ui.nav`.** `/leaderboard` stays an app route: it renders this
 *   plugin's board *and* the awards trophy room, which is a different feature
 *   (`src/lib/awards`, still in the app). Composition of two features is the
 *   app's job, not either plugin's.
 */
export const gamificationPlugin = definePlugin({
  id: "gamification",
  title: "Beat the Bot",

  // `data` only. Not `events` — see `host.ts`: `ctx.events` needs a
  // `ContextScope`, and every caller of `awardScore` supplies an already-
  // authorized `teamId` that `resolveScope` is documented not to accept from a
  // request path. Activity emission goes through the host port instead, and
  // that gap is the most interesting thing this migration found.
  capabilities: ["data"],

  // Loaded once at boot by `core/data`, which validates the `gamification_`
  // prefix on all six tables before binding a handle to it.
  schema: () => import("./schema"),

  // Required whenever `schema` is present. Note this hook is not replacing a
  // database cascade — there never was one; see `deletion.ts`.
  deletion: createDeletionHook(),
});

export default gamificationPlugin;

export { SCORE_RULES, BEAT_BOT_TIERS, applyMultiplier } from "./domain/rules";
export type { AwardInput, AwardResult } from "./domain/scoring";
export type { ScoreRule } from "./domain/rules";
export type {
  ActorProfile,
  GamificationActivityEvent,
  GamificationHost,
} from "./host";
export {
  configureGamification,
  isGamificationConfigured,
  type GamificationWiring,
} from "./wiring";
