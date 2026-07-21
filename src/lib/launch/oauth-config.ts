/**
 * Config for the implicit OAuth handoff that mints scoped tokens for the
 * static lastest-www frontends (launch board, playground leaderboard). The
 * redirect-URI allowlist is the key guard against open-redirect / token-leak:
 * we only ever hand a token back to an origin on this list.
 */

import { DEFAULT_LAUNCH } from "@/lib/db/schema";

export const LAUNCH_CLIENT_ID = "launch-www";
export const LAUNCH_SCOPE = DEFAULT_LAUNCH.scope; // 'launch:vote launch:submit'

export const PLAYGROUND_CLIENT_ID = "playground-www";
export const PLAYGROUND_SCOPE = "playground:score";

// Site-wide header login on lastest.cloud (presence detection only — the token
// never calls a scoped API, so it gets no launch/playground scopes).
export const WWW_CLIENT_ID = "www";
export const WWW_SCOPE = "openid";

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
