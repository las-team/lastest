/**
 * The registered OAuth clients for the implicit token handoff that serves the
 * static lastest-www frontends (launch board, playground leaderboard, the
 * marketing site's header login).
 *
 * Two things live here and both are boundaries, which is why this is core and
 * not a feature module (`docs/architecture/core-scope.md` §2 — credentials):
 *
 * - **The redirect-URI allowlist.** `/oauth/authorize` hands a bearer token
 *   back in a URL fragment. The allowlist is the only thing standing between
 *   that and an open-redirect token leak, so it must not be editable by
 *   whoever owns the feature the token happens to be for.
 * - **The client → scope map.** It decides what a minted token may do. A
 *   client cannot widen its own grant: `/oauth/authorize` intersects the
 *   requested scope with the value here.
 *
 * Moved out of `src/lib/launch/oauth-config.ts` by the `launch` plugin
 * migration (RFC §9 phase 4). It was never launch's: three clients are
 * registered, two of them are not the launch board, and `/oauth/authorize` is
 * a core route. The module was named after the first feature to need it, which
 * is exactly the near-miss `plugin-migration-recipe.md` §5 warns about — read
 * the import list, not the directory name.
 */

export const LAUNCH_CLIENT_ID = "launch-www";
export const LAUNCH_SCOPE = "launch:vote launch:submit";

export const PLAYGROUND_CLIENT_ID = "playground-www";
export const PLAYGROUND_SCOPE = "playground:score";

// Site-wide header login on lastest.cloud (presence detection only — the token
// never calls a scoped API, so it gets no launch/playground scopes).
export const WWW_CLIENT_ID = "www";
export const WWW_SCOPE = "openid";

/**
 * TTL (seconds) of a token minted by `/oauth/authorize`.
 *
 * Part of the credential's shape, so it belongs with the client registry
 * rather than with any one client's feature tunables — it used to sit in
 * `DEFAULT_LAUNCH.tokenTtlSeconds`, which meant the playground's and the
 * marketing site's token lifetimes were defined by the launch board.
 */
export const OAUTH_TOKEN_TTL_SECONDS = 3600;

// clientId → the full scope string that client may be granted. Requested
// scopes are intersected with this in /oauth/authorize.
const CLIENT_SCOPES: Record<string, string> = {
  [LAUNCH_CLIENT_ID]: LAUNCH_SCOPE,
  [PLAYGROUND_CLIENT_ID]: PLAYGROUND_SCOPE,
  [WWW_CLIENT_ID]: WWW_SCOPE,
};

/** Allowed origins a token may be returned to. Configurable via env for staging. */
export function allowedRedirectOrigins(): string[] {
  const env = process.env.LAUNCH_REDIRECT_ORIGINS;
  // Both the subdomain (`launch.lastest.cloud`) and the apex (`lastest.cloud`,
  // `www.lastest.cloud`) are valid: the apex serves the launch pages until the
  // apex→subdomain 301 is in place, and even after that, callbacks may resolve
  // to either depending on how the redirect_uri was derived.
  const origins = env
    ? env
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [
        "https://launch.lastest.cloud",
        "https://playground.lastest.cloud",
        "https://lastest.cloud",
        "https://www.lastest.cloud",
      ];
  if (process.env.NODE_ENV !== "production") {
    // Common Next.js dev ports (3000 default; 3001/3002/3003 are the fallbacks
    // Next picks when earlier ones are busy — the launch frontend often lands
    // on 3002 because the app already holds 3000).
    origins.push(
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3003",
      "http://localhost:4000",
    );
  }
  return origins;
}

export function isValidClientId(clientId: string | null): boolean {
  return clientId != null && clientId in CLIENT_SCOPES;
}

/** Full scope string a registered client may be granted (null if unknown). */
export function scopeForClient(clientId: string | null): string | null {
  return clientId != null ? (CLIENT_SCOPES[clientId] ?? null) : null;
}

export function isAllowedRedirectUri(redirectUri: string | null): boolean {
  if (!redirectUri) return false;
  try {
    const u = new URL(redirectUri);
    return allowedRedirectOrigins().includes(u.origin);
  } catch {
    return false;
  }
}

/** Does a token's granted scope string cover a required scope? */
export function scopeIncludes(
  grantedScope: string | null | undefined,
  required: string,
): boolean {
  if (!grantedScope) return false;
  return grantedScope.split(/\s+/).includes(required);
}
