/**
 * Programmatic API authentication via Bearer tokens.
 *
 * This module is for non-browser clients only (VS Code extension, remote runners,
 * CI/CD integrations). Browser/UI auth is handled by BetterAuth (see session.ts).
 * Tokens are validated against the `sessions` table in the DB.
 */
import * as queries from "@/lib/db/queries";
import type { SessionData } from "./session";
import {
  LOOPBACK_GRANT_PREFIX,
  verifyLoopbackGrant,
} from "@/lib/mcp/loopback-grant";

export async function verifyBearerToken(
  token: string,
): Promise<SessionData | null> {
  // Server-minted, minute-long grant used by /api/mcp to make its own
  // loopback calls on behalf of an OAuth-authenticated user. Never issued to a
  // client, never persisted — see @/lib/mcp/loopback-grant for why OAuth
  // access tokens themselves are deliberately not accepted here.
  if (token.startsWith(LOOPBACK_GRANT_PREFIX)) {
    const grant = verifyLoopbackGrant(token);
    if (!grant) return null;
    const user = await queries.getUserById(grant.u);
    if (!user) return null;
    const team = user.teamId ? await queries.getTeam(user.teamId) : null;
    // A label, not a key: no `sessions` row exists for an OAuth MCP caller by
    // design (the grant is minted per request and never persisted). Verified
    // that nothing treats `SessionData.sessionId` as a lookup handle — the only
    // readers are log fields — and the `mcp-oauth:` prefix keeps it obviously
    // non-UUID if one ever appears.
    return { user, sessionId: `mcp-oauth:${grant.c}`, team: team ?? null };
  }

  const result = await queries.getSessionWithUser(token);
  if (!result || result.session.expiresAt < new Date()) {
    return null;
  }
  // Scoped OAuth handoff tokens (kind='launch', minted by /oauth/authorize for
  // the public launch/playground frontends) live in the same sessions table but
  // only authorize the narrow scopes they carry (e.g. 'launch:vote'). They are
  // handed to browsers in a URL fragment, so they must never double as
  // full-privilege API tokens here. The launch API resolves them itself via
  // getSessionWithUser and enforces scope per endpoint.
  if (result.session.kind === "launch" || result.session.scope != null) {
    return null;
  }
  // Stamp last-used (throttled) so the UI can show key activity and onboarding
  // can confirm an MCP client has connected. Fire-and-forget — never block auth.
  void queries
    .touchSessionLastUsed(token, result.session.lastUsedAt ?? null)
    .catch(() => {});
  const team = result.user.teamId
    ? await queries.getTeam(result.user.teamId)
    : null;
  return {
    user: result.user,
    sessionId: result.session.id,
    team: team ?? null,
  };
}
