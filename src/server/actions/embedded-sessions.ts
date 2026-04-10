'use server';

import { db } from '@/lib/db';
import { embeddedSessions, runners, type EmbeddedSession, type EmbeddedSessionStatus } from '@/lib/db/schema';
import { eq, and, ne, desc } from 'drizzle-orm';
import { requireTeamAccess, requireTeamAdmin } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

/**
 * List all embedded sessions for the current team
 */
export async function listEmbeddedSessions(): Promise<EmbeddedSession[]> {
  const session = await requireTeamAccess();
  return db
    .select()
    .from(embeddedSessions)
    .where(eq(embeddedSessions.teamId, session.team.id))
    .orderBy(desc(embeddedSessions.createdAt));
}

/**
 * List embedded sessions for system runners (cross-team, available to all authenticated users)
 */
export async function listSystemEmbeddedSessions(): Promise<EmbeddedSession[]> {
  const systemRunnerIds = await db
    .select({ id: runners.id })
    .from(runners)
    .where(eq(runners.isSystem, true));

  if (systemRunnerIds.length === 0) return [];

  const results: EmbeddedSession[] = [];
  for (const r of systemRunnerIds) {
    const [sess] = await db
      .select()
      .from(embeddedSessions)
      .where(eq(embeddedSessions.runnerId, r.id));
    if (sess) results.push(sess);
  }
  return results;
}

/**
 * Get a specific embedded session
 */
export async function getEmbeddedSession(sessionId: string): Promise<EmbeddedSession | null> {
  const session = await requireTeamAccess();
  const [result] = await db
    .select()
    .from(embeddedSessions)
    .where(and(eq(embeddedSessions.id, sessionId), eq(embeddedSessions.teamId, session.team.id)));
  return result ?? null;
}

/**
 * Find an available (ready) embedded session for the team
 */
export async function getAvailableEmbeddedSession(): Promise<EmbeddedSession | null> {
  const session = await requireTeamAccess();
  const [result] = await db
    .select()
    .from(embeddedSessions)
    .where(and(
      eq(embeddedSessions.teamId, session.team.id),
      eq(embeddedSessions.status, 'ready'),
    ))
    .limit(1);
  return result ?? null;
}

/**
 * Claim an embedded session (set to busy, assign userId)
 */
export async function claimEmbeddedSession(
  sessionId: string
): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAccess();

  const [existing] = await db
    .select()
    .from(embeddedSessions)
    .where(and(eq(embeddedSessions.id, sessionId), eq(embeddedSessions.teamId, session.team.id)));

  if (!existing) {
    return { error: 'Session not found' };
  }

  if (existing.status !== 'ready') {
    return { error: `Session is not available (status: ${existing.status})` };
  }

  await db
    .update(embeddedSessions)
    .set({
      status: 'busy',
      userId: session.user.id,
      lastActivityAt: new Date(),
    })
    .where(eq(embeddedSessions.id, sessionId));

  revalidatePath('/settings');
  return { success: true };
}

/**
 * Release an embedded session (back to ready, clear userId)
 */
export async function releaseEmbeddedSession(
  sessionId: string
): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAccess();

  const [existing] = await db
    .select()
    .from(embeddedSessions)
    .where(and(eq(embeddedSessions.id, sessionId), eq(embeddedSessions.teamId, session.team.id)));

  if (!existing) {
    return { error: 'Session not found' };
  }

  await db
    .update(embeddedSessions)
    .set({
      status: 'ready',
      userId: null,
      lastActivityAt: new Date(),
    })
    .where(eq(embeddedSessions.id, sessionId));

  revalidatePath('/settings');
  return { success: true };
}

/**
 * Upsert an embedded session for a runner — ensures exactly 1 session per runner.
 * On restart, updates the existing session instead of creating a duplicate.
 */
export async function upsertEmbeddedSession(params: {
  teamId: string;
  runnerId: string;
  streamUrl: string;
  cdpUrl?: string;
  containerUrl: string;
  viewport?: { width: number; height: number };
}): Promise<EmbeddedSession> {
  const existing = await getEmbeddedSessionForRunner(params.runnerId);

  if (existing) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

    // Update the existing session
    await db
      .update(embeddedSessions)
      .set({
        streamUrl: params.streamUrl,
        cdpUrl: params.cdpUrl ?? null,
        containerUrl: params.containerUrl,
        viewport: params.viewport ?? { width: 1280, height: 720 },
        status: 'ready',
        userId: null,
        lastActivityAt: now,
        expiresAt,
      })
      .where(eq(embeddedSessions.id, existing.id));

    // Delete any accumulated duplicates
    await db
      .delete(embeddedSessions)
      .where(and(eq(embeddedSessions.runnerId, params.runnerId), ne(embeddedSessions.id, existing.id)));

    const [updated] = await db
      .select()
      .from(embeddedSessions)
      .where(eq(embeddedSessions.id, existing.id));

    return updated!;
  }

  return createEmbeddedSession(params);
}

/**
 * Create an embedded session (internal — called by registration endpoint)
 */
export async function createEmbeddedSession(params: {
  teamId: string;
  runnerId: string;
  streamUrl: string;
  cdpUrl?: string;
  containerUrl: string;
  viewport?: { width: number; height: number };
}): Promise<EmbeddedSession> {
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30min expiry

  await db.insert(embeddedSessions).values({
    id,
    teamId: params.teamId,
    runnerId: params.runnerId,
    status: 'ready',
    streamUrl: params.streamUrl,
    cdpUrl: params.cdpUrl ?? null,
    containerUrl: params.containerUrl,
    viewport: params.viewport ?? { width: 1280, height: 720 },
    createdAt: now,
    lastActivityAt: now,
    expiresAt,
  });

  const [created] = await db
    .select()
    .from(embeddedSessions)
    .where(eq(embeddedSessions.id, id));

  return created!;
}

/**
 * Destroy an embedded session (admin only)
 */
export async function destroyEmbeddedSession(
  sessionId: string
): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAdmin();

  const [existing] = await db
    .select()
    .from(embeddedSessions)
    .where(and(eq(embeddedSessions.id, sessionId), eq(embeddedSessions.teamId, session.team.id)));

  if (!existing) {
    return { error: 'Session not found' };
  }

  await db.delete(embeddedSessions).where(eq(embeddedSessions.id, sessionId));

  revalidatePath('/settings');
  return { success: true };
}

/**
 * Update embedded session status (internal use)
 */
export async function updateEmbeddedSessionStatus(
  sessionId: string,
  status: EmbeddedSessionStatus,
  updates?: { currentUrl?: string; lastActivityAt?: Date }
): Promise<void> {
  await db
    .update(embeddedSessions)
    .set({
      status,
      ...updates,
      lastActivityAt: updates?.lastActivityAt ?? new Date(),
    })
    .where(eq(embeddedSessions.id, sessionId));
}

/**
 * Get embedded session by runner ID
 */
export async function getEmbeddedSessionForRunner(runnerId: string): Promise<EmbeddedSession | null> {
  const [result] = await db
    .select()
    .from(embeddedSessions)
    .where(eq(embeddedSessions.runnerId, runnerId));
  return result ?? null;
}

/**
 * Get the stream URL for a runner's linked embedded session.
 * Used by UI to discover if a runner has live streaming available.
 */
export async function getStreamUrlForRunner(runnerId: string): Promise<{
  streamUrl: string | null;
  sessionId: string | null;
  streamAuthToken: string | null;
} | null> {
  const session = await getEmbeddedSessionForRunner(runnerId);
  if (!session || !session.streamUrl) return null;

  const streamAuthToken = process.env.STREAM_AUTH_TOKEN || null;
  return {
    streamUrl: session.streamUrl,
    sessionId: session.id,
    streamAuthToken,
  };
}

/**
 * Clean up expired embedded sessions
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const now = new Date();
  const expired = await db
    .select()
    .from(embeddedSessions)
    .where(eq(embeddedSessions.status, 'ready'));

  let cleaned = 0;
  for (const session of expired) {
    if (session.expiresAt && session.expiresAt < now) {
      await db
        .update(embeddedSessions)
        .set({ status: 'stopped' })
        .where(eq(embeddedSessions.id, session.id));
      cleaned++;
    }
  }

  return cleaned;
}
