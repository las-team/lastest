import * as queries from '@/lib/db/queries';
import type { SessionData } from './clerk';

/**
 * Verify a Bearer token against session tokens in the DB.
 * Used by VS Code extension and other API clients.
 */
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
