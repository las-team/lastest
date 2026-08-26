import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-awards` — "Prove your app is not AI slop": per-repository
 * tier + category badges computed from build/test/diff history, a public
 * criteria page, an embeddable badge SVG endpoint, and the team trophy room.
 * The ninth plugin of RFC §9 phase 4, after `rca`, `app-map`, `launch`,
 * `api-test`, `playground`, `gamification`, `ci` and `share`.
 *
 * ### The migration `share` was done to unblock
 *
 * This feature reads the most recent public share slug for a repo (the
 * badge's "proof" link) and share's own `getRepoAward` reads this feature's
 * table right back — a genuine two-way dependency between two features that
 * cannot import each other. `share`'s migration built `src/lib/core/
 * share-reads.ts` specifically so this plugin would not have to invert
 * anything of its own; see `host.ts` for how the other direction (share
 * reading awards) now goes through `src/lib/core/awards-host.ts` the same
 * way. Costed at **8 host methods** before starting (recipe §1.5) — matching
 * the estimate `tools/architecture/boundaries.mjs` left when `share` landed —
 * comfortably inside the "go" range.
 *
 * ### The standard tenanted shape
 *
 * Every row belongs to a repo (`repositoryId`, cascading from a team-owned
 * repo through a deletion hook rather than a real FK — see `schema.ts`), so
 * this is not `launch`/`playground`'s "no tenant" shape, and the wiring is
 * the standard tenanted one: `runtime` + `host` + `data`. The runtime serves
 * the session path (`getTeamTrophyRoom` resolves its own team through
 * `contextFor`); the bare `data` handle serves the build-completion trigger
 * and the anonymous slug lookup, which have no session to build a context
 * from — see `wiring.ts`.
 *
 * ### No server actions at all
 *
 * Every mutation this feature makes (`recomputeRepoAward`) is system-
 * triggered, not user-invoked, so there is no `actions.ts` — the same "no
 * dispatchable action ids" shape `launch` has with its REST-only surface.
 * `reads.ts` is a plain module, not `"use server"`.
 *
 * ### Surfaces
 *
 * - **Reads** (`./reads`) — `getTeamTrophyRoom` (session-authorized team),
 *   `getRepoAwardBySlug` (anonymous), `getRepoAward` (own-table lookup, the
 *   share plugin's cross-read target), `recomputeRepoAward` (system-
 *   triggered, from `./recompute`, re-exported here).
 * - **A public page** (`./ui/page`) — the `/awards` criteria/marketing
 *   landing page. Entirely this feature's own content; the app route keeps
 *   only route-segment config Next.js requires to be literal (`revalidate`,
 *   `metadata`).
 * - **An API route** (`./api/badge`) — the embeddable badge SVG endpoint,
 *   moved wholesale (recipe §6.2): its one core dependency
 *   (`getBuildTotalTests`) is already a host method.
 * - **`TrophyRoom`** (`./ui/trophy-room`) — imported directly by the app's
 *   `/leaderboard` route, which composes it with gamification's board (two
 *   features on one page is the app's job, not either plugin's).
 * - **`SplitShield`, `Pill`, `Wordmark`, `CardBadge`** (`./ui/badges`) — also
 *   consumed by `AwardBadgeRow`, which stays in `src/components/awards/`
 *   because `share`'s `/r/<slug>` page hands it down as a render prop and a
 *   plugin may not import another plugin — "the app owns the thing placed"
 *   (recipe §6), one level removed: here the *placement* is share's, but the
 *   badge glyphs it renders with are still this plugin's public UI.
 */
export const awardsPlugin = definePlugin({
  id: "awards",
  title: "Awards",

  capabilities: ["data"],

  // Loaded once at boot by `core/data`, which validates the `awards_` prefix
  // before binding a handle to it.
  schema: () => import("./schema"),

  // Required whenever `schema` is present. Replaces the `ON DELETE CASCADE`
  // FK to `repositories` that `scripts/migrate.js` drops — see `deletion.ts`.
  deletion: createDeletionHook(),
});

export default awardsPlugin;

export type {
  AwardsHost,
  AwardsRepoBuildRow,
  AwardsRepoSummary,
  AwardsRepoWithTestCount,
  AwardsShareContext,
} from "./host";
export {
  configureAwards,
  isAwardsConfigured,
  type AwardsWiring,
} from "./wiring";
export type {
  AwardCategories,
  AwardTier,
  NewRepoAward,
  RepoAward,
} from "./schema";

// Server-component reads live behind `@lastest/plugin-awards/reads`, the
// same subpath `gamification` uses. Re-exporting them here would put this
// module (which `reads.ts` imports for the manifest) in an import cycle.
export { recomputeRepoAward } from "./recompute";

export {
  renderA11yBadge,
  renderAllPassingBadge,
  renderPendingBadge,
  renderRegressionBadge,
  renderReviewRequiredBadge,
  renderSplitShield,
  renderTierBadge,
  renderZeroDriftBadge,
  type Size,
  type Tone,
} from "./svg";
