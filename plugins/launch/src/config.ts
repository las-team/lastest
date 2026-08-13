/**
 * Tunables for the launch board — the route, the state engine and the gating
 * layer share one source of truth.
 *
 * Was `DEFAULT_LAUNCH` in `packages/db/src/schema/growth.ts`. Two fields did
 * not come with it:
 *
 * - `tokenTtlSeconds` → `OAUTH_TOKEN_TTL_SECONDS` in `@/lib/auth/oauth-clients`
 * - `scope` → `LAUNCH_SCOPE` in the same core module
 *
 * Both describe a *credential* minted by `/oauth/authorize` for three
 * different clients, so they belong to the client registry rather than to this
 * board's rate limits. Everything left here is a policy number the launch
 * feature owns outright, which is why changing one is now a plugin PR.
 */
export const LAUNCH_CONFIG = {
  // Curated quality bar: max featured slots that go live per weekly cohort.
  featuredSlotsPerWeek: 12,
  // Anti-gaming velocity caps (rolling 1h window).
  votesPerAccountPerHour: 30,
  votesPerIpPerHour: 60,
  submissionsPerAccountPerHour: 5,
  // Vote-clearing: votes sharing an IP beyond this count in a cohort are flagged
  // as a suspicious cluster and excluded from the winner decision.
  suspiciousIpClusterThreshold: 5,
  // Comments
  commentsPerAccountPerHour: 20,
  commentMaxLength: 2000,
  // Reactions
  allowedReactions: ["🔥", "❤️", "🚀", "👏", "🤯"],
  // Analytics events
  eventsPerIpPerMinute: 30,
  eventDedupeWindowSec: 1800,
} as const;

/** Scopes the board's mutations require of a handoff token. */
export const LAUNCH_SCOPES = {
  vote: "launch:vote",
  submit: "launch:submit",
} as const;
