import { cookies } from 'next/headers';
import * as queries from '@/lib/db/queries';
import type { User, Team, UserRole, Repository } from '@/lib/db/schema';
import { v4 as uuid } from 'uuid';

const SESSION_COOKIE_NAME = 'session_token';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionData {
  user: User;
  sessionId: string;
  team: Team | null;
}

export async function createSessionToken(
  userId: string,
  request?: Request
): Promise<string> {
  const token = uuid();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  // Extract IP and user agent from request if available
  let ipAddress: string | undefined;
  let userAgent: string | undefined;

  if (request) {
    ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      undefined;
    userAgent = request.headers.get('user-agent') || undefined;
  }

  await queries.createSession({
    userId,
    token,
    expiresAt,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });

  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION_MS / 1000,
    path: '/',
  });
}

export async function getSessionToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

export async function getCurrentSession(): Promise<SessionData | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const result = await queries.getSessionWithUser(token);
  if (!result) return null;

  // Check if session is expired
  if (result.session.expiresAt < new Date()) {
    await queries.deleteSession(token);
    return null;
  }

  // Get user's team if they have one
  const team = result.user.teamId ? await queries.getTeam(result.user.teamId) : null;

  return {
    user: result.user,
    sessionId: result.session.id,
    team: team ?? null,
  };
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error('Unauthorized');
  }
  return session;
}

export async function requireAdmin(): Promise<SessionData> {
  const session = await requireAuth();
  if (session.user.role !== 'admin' && session.user.role !== 'owner') {
    throw new Error('Forbidden: Admin access required');
  }
  return session;
}

// Team-aware auth helpers
export async function requireTeamAccess(): Promise<SessionData & { team: Team }> {
  const session = await requireAuth();
  if (!session.team) {
    throw new Error('Forbidden: No team access');
  }
  return session as SessionData & { team: Team };
}

export async function requireTeamRole(roles: UserRole[]): Promise<SessionData & { team: Team }> {
  const session = await requireTeamAccess();
  if (!roles.includes(session.user.role as UserRole)) {
    throw new Error(`Forbidden: Requires one of these roles: ${roles.join(', ')}`);
  }
  return session;
}

export async function requireTeamAdmin(): Promise<SessionData & { team: Team }> {
  return requireTeamRole(['owner', 'admin']);
}

export async function requireRepoAccess(repoId: string): Promise<SessionData & { team: Team; repo: Repository }> {
  const session = await requireTeamAccess();
  const repo = await queries.getRepository(repoId);
  if (!repo || repo.teamId !== session.team.id) {
    throw new Error('Forbidden: Repository does not belong to your team');
  }
  return { ...session, repo };
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function logout(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    await queries.deleteSession(token);
  }
  await clearSessionCookie();
}

// Helper to check if a user is authenticated (for client-side API calls)
export async function isAuthenticated(): Promise<boolean> {
  const session = await getCurrentSession();
  return session !== null;
}
