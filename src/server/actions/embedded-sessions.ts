'use server';

import { db } from '@/lib/db';
import { embeddedSessions, runners, backgroundJobs, type EmbeddedSession, type EmbeddedSessionStatus } from '@/lib/db/schema';
import { eq, and, ne, desc, isNull } from 'drizzle-orm';
import { requireTeamAccess, requireTeamAdmin } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { emitRunnerStatusChange } from '@/lib/ws/runner-events';

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

// ============================================
// Pool Management — Ephemeral EB Assignment
// ============================================

/**
 * Check if all pool EBs are busy (no idle ones available).
 * Used by runTests() to decide whether to queue or proceed.
 */
export async function isPoolBusy(): Promise<boolean> {
  const [available] = await db
    .select({ id: runners.id })
    .from(runners)
    .where(and(
      eq(runners.isSystem, true),
      eq(runners.status, 'online'),
      eq(runners.type, 'embedded'),
    ))
    .limit(1);
  return !available;
}

/**
 * Atomically claim an idle system EB from the pool.
 * Uses optimistic locking: SELECT one online EB, then UPDATE with WHERE status='online'
 * to prevent races. Retries up to 3 times if another caller grabs it first.
 * Returns the runnerId + sessionId, or null if none available.
 *
 * Internal function — no requireTeamAccess (called from executor).
 */
export async function claimPoolEB(): Promise<{
  runnerId: string;
  sessionId: string;
} | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // 1. Find an online system EB
    const [candidate] = await db
      .select({ id: runners.id })
      .from(runners)
      .where(and(
        eq(runners.isSystem, true),
        eq(runners.status, 'online'),
        eq(runners.type, 'embedded'),
      ))
      .limit(1);

    if (!candidate) return null;

    // 2. Optimistic lock: only claim if still online
    const result = await db
      .update(runners)
      .set({ status: 'busy' as const, lastSeen: new Date() })
      .where(and(
        eq(runners.id, candidate.id),
        eq(runners.status, 'online'),
      ))
      .returning({ id: runners.id, teamId: runners.teamId });

    if (result.length === 0) {
      // Another caller grabbed it — retry
      continue;
    }

    // 3. Mark the embedded session as busy
    const [session] = await db
      .select({ id: embeddedSessions.id })
      .from(embeddedSessions)
      .where(eq(embeddedSessions.runnerId, candidate.id));

    if (session) {
      await db
        .update(embeddedSessions)
        .set({
          status: 'busy',
          busySince: new Date(),
          lastActivityAt: new Date(),
        })
        .where(eq(embeddedSessions.id, session.id));
    }

    // 4. Emit status change event
    if (result[0]) {
      emitRunnerStatusChange({
        runnerId: candidate.id,
        teamId: result[0].teamId,
        status: 'busy',
        previousStatus: 'online',
        timestamp: Date.now(),
      });
    }

    console.log(`[Pool] Claimed EB ${candidate.id.slice(0, 8)} (attempt ${attempt + 1})`);
    return { runnerId: candidate.id, sessionId: session?.id ?? '' };
  }

  // All retries exhausted due to contention
  return null;
}

/**
 * Release an EB back to the pool after task completion.
 * Resets runner to 'online' and session to 'ready'.
 * Triggers queue processing for any waiting jobs.
 *
 * Internal function — no requireTeamAccess (called from executor).
 */
export async function releasePoolEB(runnerId: string): Promise<void> {
  const [runner] = await db
    .select({ status: runners.status, teamId: runners.teamId })
    .from(runners)
    .where(eq(runners.id, runnerId));

  // Only release if still busy (heartbeat may have already set it online)
  if (runner?.status === 'busy') {
    await db
      .update(runners)
      .set({ status: 'online', lastSeen: new Date() })
      .where(eq(runners.id, runnerId));

    emitRunnerStatusChange({
      runnerId,
      teamId: runner.teamId,
      status: 'online',
      previousStatus: 'busy',
      timestamp: Date.now(),
    });
  }

  // Reset session
  await db
    .update(embeddedSessions)
    .set({
      status: 'ready',
      userId: null,
      busySince: null,
      lastActivityAt: new Date(),
    })
    .where(eq(embeddedSessions.runnerId, runnerId));

  console.log(`[Pool] Released EB ${runnerId.slice(0, 8)}`);

  // Process any queued jobs waiting for an EB
  processPoolQueue().catch((err) => {
    console.error(`[Pool] Error processing queue after release:`, err);
  });
}

/**
 * Process queued jobs that are waiting for any available EB.
 * Called after an EB is released back to the pool.
 *
 * Does NOT pre-claim an EB — lets the normal execution flow
 * (runTests → executeFallbackChain → claimPoolEB) handle claiming.
 * This avoids deadlocks where claimPoolEB marks the EB busy
 * but processNextQueuedTestRun can't use it.
 */
export async function processPoolQueue(): Promise<void> {
  // Find first pending job with no target runner (queued because all EBs were busy)
  // Check both test_run and build_run types
  const [pendingJob] = await db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.status, 'pending'),
        isNull(backgroundJobs.targetRunnerId),
      )
    )
    .limit(1);

  if (!pendingJob) return;

  console.log(`[Pool] Processing queued job ${pendingJob.id} (${pendingJob.type})`);

  // Route to the appropriate processor — they call runTests/createAndRunBuild
  // which go through executeFallbackChain → claimPoolEB naturally
  try {
    if (pendingJob.type === 'test_run') {
      const { processNextQueuedTestRun } = await import('@/server/actions/runs');
      await processNextQueuedTestRun(pendingJob.repositoryId);
    } else if (pendingJob.type === 'build_run') {
      const { processNextQueuedBuild } = await import('@/server/actions/builds');
      await processNextQueuedBuild(pendingJob.repositoryId);
    }
  } catch (err) {
    console.error(`[Pool] Error processing queued job ${pendingJob.id}:`, err);
  }
}

/**
 * Reaper: release EBs that have been busy for too long (likely crashed).
 * An EB is considered stale if busySince > maxBusyDurationMs AND lastSeen is also stale.
 * Wire this into the periodic cleanup interval (e.g., alongside markStaleRunnersOffline).
 */
export async function reapStalePoolEBs(maxBusyDurationMs = 10 * 60 * 1000): Promise<number> {
  const busyCutoff = new Date(Date.now() - maxBusyDurationMs);
  const heartbeatCutoff = new Date(Date.now() - 60_000); // No heartbeat for 60s

  const stale = await db
    .select({
      sessionId: embeddedSessions.id,
      runnerId: runners.id,
      busySince: embeddedSessions.busySince,
      lastSeen: runners.lastSeen,
    })
    .from(embeddedSessions)
    .innerJoin(runners, eq(embeddedSessions.runnerId, runners.id))
    .where(and(
      eq(runners.isSystem, true),
      eq(embeddedSessions.status, 'busy'),
    ));

  let reaped = 0;
  for (const row of stale) {
    // Only reap if BOTH busySince is old AND heartbeat stopped
    if (row.busySince && row.busySince < busyCutoff
        && row.lastSeen && row.lastSeen < heartbeatCutoff) {
      await db.update(runners).set({ status: 'offline' }).where(eq(runners.id, row.runnerId));
      await db
        .update(embeddedSessions)
        .set({ status: 'stopped', busySince: null, userId: null })
        .where(eq(embeddedSessions.id, row.sessionId));
      reaped++;
      console.warn(`[Reaper] Force-released stale EB ${row.runnerId.slice(0, 8)} (busy since ${row.busySince?.toISOString()})`);
    }
  }
  return reaped;
}
