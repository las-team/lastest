import "server-only";

import {
  getPublicShareBySlug,
  listPublicSharesForRepositories,
  revokePublicSharesForTeam,
} from "@lastest/plugin-share";

/**
 * Reverse reads into the `share` plugin's own table, for `@lastest/plugin-awards`.
 *
 * `src/lib/db/queries/awards.ts` used to select straight from `publicShares`
 * through the shared `db` handle. Once that table moved into
 * `plugins/share/src/schema.ts`, that stopped being reachable —
 * `core-scope.md` §6: a plugin's tables are only reachable through the
 * plugin. Once `awards` itself became a plugin (RFC §9 phase 4, ninth
 * plugin), the same rule bound it too: `plugins/awards` cannot import
 * `@lastest/plugin-share` directly (the plugin→plugin ban), so the read has
 * to cross through `src/lib/core/awards-host.ts`'s `AwardsHost` methods
 * (`resolveShareSlug`, `resolveLatestShareSlugs`) instead of a query-layer
 * function — this file is what those two methods call.
 *
 * This file is the mirror image of `gamification`'s core→feature inversion:
 * instead of core declaring a port for a feature to implement, a plugin
 * already exposes plain read functions from its own package, and this file —
 * living in `src/lib/core/`, the one place in `src/` that legitimately
 * imports plugins — re-exports them for `awards-host.ts` to call instead of
 * touching the table itself.
 *
 * Deliberately does NOT import `./runtime` / call `getPluginRuntime()`. Host
 * files are constructed and handed to `configureAwards()` from inside
 * `getPluginRuntime()` itself, so importing `./runtime` from here would be
 * circular; more importantly, the same reasoning holds as when this file
 * served `src/lib/db/queries` directly — `runtime.ts` pulls in the entire
 * composition root, and nothing here needs that. The same boot-order
 * guarantee every other host relies on already holds: `src/instrumentation.ts`
 * awaits `getPluginRuntime()` before the server handles a request, so by the
 * time an awards host method runs, `share`'s wiring is already in place.
 */

export async function getShareContextBySlug(slug: string): Promise<{
  slug: string;
  targetDomain: string | null;
  repositoryId: string | null;
} | null> {
  const share = await getPublicShareBySlug(slug);
  if (!share) return null;
  return {
    slug: share.slug,
    targetDomain: share.targetDomain,
    repositoryId: share.repositoryId,
  };
}

export async function listLatestPublicSharesForRepositories(
  repositoryIds: readonly string[],
): Promise<
  Array<{ repositoryId: string | null; slug: string; createdAt: Date | null }>
> {
  return listPublicSharesForRepositories(repositoryIds);
}

/**
 * Revoke every live `/r/<slug>` a team holds.
 *
 * The one write in this file, and it crosses here for the same reason the
 * reads do: `share_public_shares` is the share plugin's table, and
 * `src/lib/core/` is the only place in `src/` that may reach a plugin.
 *
 * Called by `toggleRegulatedMode`. Turning the regulated profile on refuses to
 * mint new links, but the ones already minted are the actual exposure — an
 * anonymous URL serving screenshots of a validated system — and the switch's
 * toast tells the user they are gone. Returns the count so the caller can say
 * how many.
 */
export async function revokeTeamPublicShares(teamId: string): Promise<number> {
  return revokePublicSharesForTeam(teamId);
}
