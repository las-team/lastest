/**
 * Programmatic API authentication via Bearer tokens.
 *
 * This module is for non-browser clients only (VS Code extension, remote runners,
 * CI/CD integrations). Browser/UI auth is handled by BetterAuth (see session.ts).
 * Tokens are validated against the `sessions` table in the DB.
 */
import * as queries from "@/lib/db/queries";
import type { SessionData } from "./session";
export async function verifyBearerToken(
  token: string,
): Promise<SessionData | null> {
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
