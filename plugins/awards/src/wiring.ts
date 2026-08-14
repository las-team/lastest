import type { DataCapability } from "@lastest/contracts";

import type { AwardsHost } from "./host";

/**
 * How the plugin reaches what the composition root wired into it. Same
 * realm-wide `Symbol.for` slot as `plugins/explorer/src/wiring.ts` — read
 * that file's comment for why a module-level `let` is not enough under
 * Next.js bundling.
 *
 * ### `data`, no `runtime` — the same shape as `gamification`, for a
 * different reason
 *
 * `awards_repo_awards` rows genuinely belong to a tenant (`repositoryId`,
 * cascading from a team-owned repo), so this is not the "no tenant at all"
 * shape `launch`/`playground` declare with `tenancy: "none"`. What it shares
 * with `gamification` is the *wiring* — `data` straight from the slot, no
 * `contextFor()` — because none of this plugin's three call paths would
 * benefit from one:
 *
 * - `recomputeRepoAward(repositoryId)` runs from `builds.ts` after a build
 *   completes, with a `repositoryId` the executor already resolved. There is
 *   no session on this path at all.
 * - `getTeamTrophyRoom(teamId)` runs from `/leaderboard`, which has already
 *   called `requireTeamAccess()` itself before passing the id in — the same
 *   contract `gamification`'s `awardScore` documents in its own `wiring.ts`.
 * - `getRepoAwardBySlug(slug)` runs from the public badge route and from
 *   `ShareHost.getRepoAward` — both deliberately anonymous. A `ctx` would
 *   have nothing to authorize against.
 *
 * Building a `PluginContext` for any of these would mean either threading a
 * caller-supplied id through `contextFor` (the exact tenancy-escape shape
 * `core/kernel/src/runtime.ts` documents `ScopeRequest.teamId` as
 * background-paths-only to prevent) or asserting a session that two of the
 * three paths do not have. So the tenancy guarantee stays where it already
 * is — with whichever caller resolved the id — and this plugin receives ids
 * it treats as authorized, exactly as `src/lib/awards/recompute.ts` and
 * `src/lib/db/queries/awards.ts` did before the migration.
 */
export interface AwardsWiring {
  readonly host: AwardsHost;
  /** Scoped to this plugin's one table by `core/data`. Never a raw handle. */
  readonly data: DataCapability;
}

const SLOT = Symbol.for("lastest.plugin.awards.wiring");

type Carrier = typeof globalThis & { [SLOT]?: AwardsWiring };

export function configureAwards(wiring: AwardsWiring): void {
  (globalThis as Carrier)[SLOT] = wiring;
}

export function awardsWiring(): AwardsWiring {
  const wiring = (globalThis as Carrier)[SLOT];
  if (!wiring) {
    throw new Error(
      "The awards plugin is not wired. The composition root must call " +
        "configureAwards({ host, data }) before any awards call.",
    );
  }
  return wiring;
}

/** True when wiring is present. Lets a caller degrade instead of throwing. */
export function isAwardsConfigured(): boolean {
  return Boolean((globalThis as Carrier)[SLOT]);
}
