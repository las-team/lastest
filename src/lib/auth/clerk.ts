import { auth, currentUser } from '@clerk/nextjs/server';
import * as queries from '@/lib/db/queries';
import type { User, Team, UserRole, Repository } from '@/lib/db/schema';

export interface SessionData {
  user: User;
  sessionId: string;
  team: Team | null;
}

/**
 * Ensure a local DB user exists for the given Clerk user.
 * Handles the case where the webhook hasn't fired yet.
 */
async function ensureLocalUser(clerkUserId: string): Promise<User | null> {
  const existing = await queries.getUserByClerkId(clerkUserId);
  if (existing) return existing;

  // Webhook hasn't synced yet — fetch from Clerk and create locally
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const email = clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) return null;

  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;

  // Check if a pre-existing user with this email exists (from before Clerk migration)
  const existingByEmail = await queries.getUserByEmail(email);
  if (existingByEmail) {
    await queries.updateUser(existingByEmail.id, { clerkId: clerkUserId });
    return queries.getUserById(existingByEmail.id) ?? null;
  }

  return queries.createUser({
    email,
    name,
    avatarUrl: clerkUser.imageUrl ?? null,
    clerkId: clerkUserId,
    hashedPassword: null,
    emailVerified: true,
    role: 'owner',
  });
}

export async function getCurrentSession(): Promise<SessionData | null> {
  const { userId, orgId } = await auth();
  if (!userId) return null;

  const user = await ensureLocalUser(userId);
  if (!user) return null;

  const team = user.teamId ? await queries.getTeam(user.teamId) : null;

  return {
    user,
    sessionId: userId,
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

export async function isAuthenticated(): Promise<boolean> {
  const session = await getCurrentSession();
  return session !== null;
}
