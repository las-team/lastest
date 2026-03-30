import { db } from '../index';
import {
  teams,
  users,
  sessions,
  oauthAccounts,
  passwordResetTokens,
  emailVerificationTokens,
  userInvitations,
  repositories,
  githubAccounts,
} from '../schema';
import type {
  NewTeam,
  NewUser,
  NewOAuthAccount,
  User,
  Team,
  UserRole,
} from '../schema';
import { eq, desc, and, gte, lt, isNull } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export async function createTeam(data: { name: string; slug?: string }): Promise<Team> {
  const id = uuid();
  const now = new Date();
  let slug = data.slug || generateSlug(data.name);

  // Ensure slug is unique
  let existing = await getTeamBySlug(slug);
  let counter = 1;
  while (existing) {
    slug = `${generateSlug(data.name)}-${counter}`;
    existing = await getTeamBySlug(slug);
    counter++;
  }

  await db.insert(teams).values({
    id,
    name: data.name,
    slug,
    createdAt: now,
    updatedAt: now,
  });

  const team = await getTeam(id);
  if (!team) throw new Error('Failed to create team');
  return team;
}

export async function getTeam(id: string) {
  return db.select().from(teams).where(eq(teams.id, id)).get();
}

export async function getTeamBySlug(slug: string) {
  return db.select().from(teams).where(eq(teams.slug, slug)).get();
}

export async function updateTeam(id: string, data: Partial<NewTeam>) {
  await db.update(teams).set({ ...data, updatedAt: new Date() }).where(eq(teams.id, id));
}

export async function deleteTeam(id: string) {
  await db.delete(teams).where(eq(teams.id, id));
}

export async function getTeamMembers(teamId: string) {
  return db.select().from(users).where(eq(users.teamId, teamId)).orderBy(desc(users.createdAt)).all();
}

export async function getUsersByTeam(teamId: string) {
  return getTeamMembers(teamId);
}

export async function removeUserFromTeam(userId: string) {
  await db.update(users).set({ teamId: null, updatedAt: new Date() }).where(eq(users.id, userId));
}

// Team-scoped repositories
export async function getRepositoriesByTeam(teamId: string) {
  return db.select().from(repositories).where(eq(repositories.teamId, teamId)).orderBy(desc(repositories.createdAt)).all();
}

// Team-scoped GitHub account
export async function getGithubAccountByTeam(teamId: string) {
  return db.select().from(githubAccounts).where(eq(githubAccounts.teamId, teamId)).get();
}

// Team-scoped invitations
export async function getPendingInvitationsByTeam(teamId: string) {
  const now = new Date();
  return db
    .select()
    .from(userInvitations)
    .where(and(eq(userInvitations.teamId, teamId), isNull(userInvitations.acceptedAt), gte(userInvitations.expiresAt, now)))
    .orderBy(desc(userInvitations.createdAt))
    .all();
}

// ============================================
// User Management
// ============================================

export async function getUsers() {
  return db.select().from(users).orderBy(desc(users.createdAt)).all();
}

export async function getUserById(id: string) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export async function getUserByEmail(email: string) {
  return db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
}

export async function getUserCount() {
  const result = await db.select({ id: users.id }).from(users).all();
  return result.length;
}

export async function createUser(data: Omit<NewUser, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
  const id = uuid();
  const now = new Date();
  await db.insert(users).values({
    ...data,
    id,
    email: data.email.toLowerCase(),
    createdAt: now,
    updatedAt: now,
  });
  // Fetch the created user to get a properly typed User object
  const user = await getUserById(id);
  if (!user) {
    throw new Error('Failed to create user');
  }
  return user;
}

export async function updateUser(id: string, data: Partial<NewUser>) {
  await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id));
}

export async function deleteUser(id: string) {
  await db.delete(users).where(eq(users.id, id));
}

export async function updateUserRole(id: string, role: UserRole) {
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
}

// ============================================
// Sessions
// ============================================

export async function getSessionByToken(token: string) {
  return db.select().from(sessions).where(eq(sessions.token, token)).get();
}

export async function getSessionWithUser(token: string) {
  const result = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .get();
  return result;
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export async function deleteSessionsByUser(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions() {
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}

// ============================================
// OAuth Accounts
// ============================================

export async function getOAuthAccount(provider: string, providerAccountId: string) {
  return db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerAccountId, providerAccountId)
      )
    )
    .get();
}

export async function getOAuthAccountsByUser(userId: string) {
  return db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, userId)).all();
}

export async function createOAuthAccount(data: Omit<NewOAuthAccount, 'id' | 'createdAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(oauthAccounts).values({ ...data, id, createdAt: now });
  return { id, ...data, createdAt: now };
}

export async function updateOAuthAccount(id: string, data: Partial<NewOAuthAccount>) {
  await db.update(oauthAccounts).set(data).where(eq(oauthAccounts.id, id));
}

export async function deleteOAuthAccount(id: string) {
  await db.delete(oauthAccounts).where(eq(oauthAccounts.id, id));
}

// ============================================
// Password Reset Tokens
// ============================================

export async function getPasswordResetToken(token: string) {
  return db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token)).get();
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const id = uuid();
  const token = uuid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

  // Delete any existing tokens for this user
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));

  await db.insert(passwordResetTokens).values({
    id,
    userId,
    token,
    expiresAt,
    createdAt: now,
  });
  return token;
}

export async function markPasswordResetTokenUsed(token: string) {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.token, token));
}

export async function deleteExpiredPasswordResetTokens() {
  const now = new Date();
  await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, now));
}

// ============================================
// Email Verification Tokens
// ============================================

export async function getEmailVerificationToken(token: string) {
  return db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.token, token)).get();
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const id = uuid();
  const token = uuid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  // Delete any existing tokens for this user
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId));

  await db.insert(emailVerificationTokens).values({
    id,
    userId,
    token,
    expiresAt,
    createdAt: now,
  });
  return token;
}

export async function deleteEmailVerificationToken(token: string) {
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.token, token));
}

// ============================================
// User Invitations
// ============================================

export async function getInvitations() {
  return db.select().from(userInvitations).orderBy(desc(userInvitations.createdAt)).all();
}

export async function getPendingInvitations() {
  const now = new Date();
  return db
    .select()
    .from(userInvitations)
    .where(and(isNull(userInvitations.acceptedAt), gte(userInvitations.expiresAt, now)))
    .orderBy(desc(userInvitations.createdAt))
    .all();
}

export async function getInvitationById(id: string) {
  return db.select().from(userInvitations).where(eq(userInvitations.id, id)).get();
}

export async function getInvitationByToken(token: string) {
  return db.select().from(userInvitations).where(eq(userInvitations.token, token)).get();
}

export async function getInvitationByEmail(email: string) {
  return db.select().from(userInvitations).where(eq(userInvitations.email, email.toLowerCase())).get();
}

export async function createInvitation(data: { email: string; teamId: string; invitedById?: string; role?: UserRole }): Promise<string> {
  const id = uuid();
  const token = uuid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(userInvitations).values({
    id,
    teamId: data.teamId,
    email: data.email.toLowerCase(),
    invitedById: data.invitedById ?? null,
    token,
    role: data.role ?? 'member',
    expiresAt,
    createdAt: now,
  });
  return token;
}

export async function markInvitationAccepted(token: string) {
  await db
    .update(userInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(userInvitations.token, token));
}

export async function deleteInvitation(id: string) {
  await db.delete(userInvitations).where(eq(userInvitations.id, id));
}

export async function deleteExpiredInvitations() {
  const now = new Date();
  await db.delete(userInvitations).where(lt(userInvitations.expiresAt, now));
}
