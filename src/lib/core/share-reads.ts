import "server-only";

import {
  getLatestPublicShareSlugForRepository,
  getPublicShareBySlug,
  listPublicSharesForRepositories,
} from "@lastest/plugin-share";

/**
 * Reverse reads into the `share` plugin's own table, for the (not yet
 * migrated) `awards` pseudo-plugin.
 *
 * `src/lib/db/queries/awards.ts` used to select straight from `publicShares`
 * through the shared `db` handle. Once that table moved into
 * `plugins/share/src/schema.ts`, that stopped being reachable —
 * `core-scope.md` §6: a plugin's tables are only reachable through the
 * plugin. `src/lib/db/queries` is itself `CORE_SRC_PATHS`
 * (`tools/architecture/boundaries.mjs`), so it may not import a plugin
 * package directly either — that would be the exact core→plugin edge RFC §3
 * forbids, the same class of problem `plugin-migration-recipe.md` §1.6
 * documents for `gamification`'s `createTest()` → `@/lib/gamification/hooks`
 * import.
 *
 * This file is the fix, and it is the mirror image of that one: instead of
 * core declaring a port for a feature to implement (`gamification`'s
 * inversion), a plugin already exposes plain read functions from its own
 * package, and this file — living in `src/lib/core/`, the one place in
 * `src/` that legitimately imports plugins — re-exports them for
 * `awards.ts` to call instead of touching the table itself.
 *
 * Deliberately does NOT import `./runtime` / call `getPluginRuntime()`.
 * `src/lib/db/queries` (this file's caller) sits underneath almost every
 * other module in the app, and `runtime.ts` pulls in the entire composition
 * root — every plugin package, every `*-host.ts`, `@lastest/kernel`,
 * `@lastest/core-*` — so importing it from here would make `@/lib/db/queries`
 * transitively depend on all of it, the exact bloated-import-graph shape
 * `core-scope.md` exists to prevent. The same boot-order guarantee every
 * other host relies on already holds: `src/instrumentation.ts` awaits
 * `getPluginRuntime()` before the server handles a request, so by the time
 * any query-layer code runs, `share`'s wiring is already in place.
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

export async function getLatestPublicShareSlug(
  repositoryId: string,
): Promise<string | null> {
  return getLatestPublicShareSlugForRepository(repositoryId);
}
