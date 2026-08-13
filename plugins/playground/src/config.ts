/**
 * Tunables for the playground board — the route and the leaderboard share one
 * source of truth.
 *
 * Was `DEFAULT_PLAYGROUND` in `packages/db/src/schema/growth.ts`. One field did
 * not come with it: `scope`, which duplicated `PLAYGROUND_SCOPE` in
 * `@/lib/auth/oauth-clients` and was never the copy anything read. It describes
 * a *credential* minted by `/oauth/authorize` for a registered client, so it
 * belongs to the client registry rather than to this board's rate limits —
 * the same split `LAUNCH_CONFIG` made. What the plugin needs on its own side is
 * the scope string it *enforces*, which is `PLAYGROUND_SCOPES` below.
 *
 * Everything left here is a policy number the playground owns outright, which
 * is why changing one is now a plugin PR.
 */
export const PLAYGROUND_CONFIG = {
  // Anti-gaming velocity caps. The full registry is ~75 achievements, so a
  // legitimate speedrun of everything fits well inside one hour's budget.
  achievementsPerAccountPerHour: 120,
  progressPostsPerAccountPerMinute: 30,
  // Leaderboard window.
  leaderboardDefaultLimit: 50,
  leaderboardMaxLimit: 100,
  leaderboardCacheTtlMs: 60_000,
  // Sanity cap on a single push — the whole registry is 75 ids; anything past
  // this is abuse or a broken client, not a legitimate sync.
  maxItemsPerPush: 500,
} as const;

/**
 * Scopes the board's mutations require of a handoff token.
 *
 * The mirror of `PLAYGROUND_SCOPE` in `@/lib/auth/oauth-clients`, which decides
 * what a token *grants*. Deciding what an endpoint *demands* is this feature's
 * policy, so the string is declared on both sides of the boundary rather than
 * passed across it — exactly as `LAUNCH_SCOPES` is.
 */
export const PLAYGROUND_SCOPES = {
  score: "playground:score",
} as const;
