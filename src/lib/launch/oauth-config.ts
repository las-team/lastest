/**
 * Config for the implicit OAuth handoff that mints a launch-scoped token for
 * the launch.lastest.cloud frontend. The redirect-URI allowlist is the key
 * guard against open-redirect / token-leak: we only ever hand a token back to
 * an origin on this list.
 */

import { DEFAULT_LAUNCH } from '@/lib/db/schema';

export const LAUNCH_CLIENT_ID = 'launch-www';
export const LAUNCH_SCOPE = DEFAULT_LAUNCH.scope; // 'launch:vote launch:submit'

/** Allowed origins a token may be returned to. Configurable via env for staging. */
export function allowedRedirectOrigins(): string[] {
  const env = process.env.LAUNCH_REDIRECT_ORIGINS;
  const origins = env
    ? env.split(',').map((s) => s.trim()).filter(Boolean)
    : ['https://launch.lastest.cloud'];
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000', 'http://localhost:4000');
  }
  return origins;
}

export function isValidClientId(clientId: string | null): boolean {
  return clientId === LAUNCH_CLIENT_ID;
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
export function scopeIncludes(grantedScope: string | null | undefined, required: string): boolean {
  if (!grantedScope) return false;
  return grantedScope.split(/\s+/).includes(required);
}
