/**
 * Programmatic API authentication via Bearer tokens.
 *
 * This module is for non-browser clients only (VS Code extension, remote runners,
 * CI/CD integrations). Browser/UI auth is handled entirely by Clerk (see clerk.ts).
 * Tokens are validated against the `sessions` table in the DB.
 */
import * as queries from '@/lib/db/queries';
import type { SessionData } from './clerk';
export async function verifyBearerToken(token: string): Promise<SessionData | null> {
  const result = await queries.getSessionWithUser(token);
  if (!result || result.session.expiresAt < new Date()) {
    return null;
  }
  const team = result.user.teamId ? await queries.getTeam(result.user.teamId) : null;
  return {
    user: result.user,
    sessionId: result.session.id,
    team: team ?? null,
  };
}
