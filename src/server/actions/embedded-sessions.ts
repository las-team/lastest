'use server';

import { db } from '@/lib/db';
import { embeddedSessions, runners, runnerCommands, runnerCommandResults, backgroundJobs, type EmbeddedSession, type EmbeddedSessionStatus } from '@/lib/db/schema';
import { eq, and, ne, desc, isNull } from 'drizzle-orm';
import { requireTeamAccess, requireTeamAdmin } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { emitRunnerStatusChange } from '@/lib/ws/runner-events';
import {
  isKubernetesMode,
  launchEBJob,
  terminateEBJob,
  jobNameForRunnerName,
  poolMax,
  warmPoolMin,
  currentPoolSize,
} from '@/lib/eb/provisioner';

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
  if (available) return false;

  // No idle EB right now — but in kubernetes mode we can provision a new one.
  // Only consider the pool "busy" (and queue the job) when we're ALSO at the
  // cluster cap. Otherwise let the caller proceed; claimOrProvisionPoolEB will
  // spin up a fresh EB.
  if (!isKubernetesMode()) return true;
  const size = await currentPoolSize();
  return size >= poolMax();
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
  sessionId: string | null;
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

    if (!session) {
      console.warn(`[Pool] Claimed EB ${candidate.id.slice(0, 8)} but no embedded_sessions row found — data inconsistency`);
    }

    console.log(`[Pool] Claimed EB ${candidate.id.slice(0, 8)} (attempt ${attempt + 1})`);
    return { runnerId: candidate.id, sessionId: session?.id ?? null };
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

  // In Kubernetes mode, tear down the Job unless we're below warm-pool minimum.
  // Pod deletion is async; the runner's heartbeat-timeout reaper will mark the row offline.
  if (isKubernetesMode()) {
    maybeTerminateReleasedEB(runnerId).catch((err) => {
      console.error(`[Pool] Error terminating released EB ${runnerId.slice(0, 8)}:`, err);
    });
  }

  // Process any queued jobs waiting for an EB
  processPoolQueue().catch((err) => {
    console.error(`[Pool] Error processing queue after release:`, err);
  });
}

/**
 * Delete the k8s Job backing this runner if the pool is above its warm-pool minimum.
 * Ephemeral-per-test model: the default is to terminate immediately after release so
 * each test gets a fresh browser. Set EB_WARM_POOL_MIN > 0 to keep idle capacity.
 *
 * Graceful teardown: we enqueue a `command:shutdown` first, then poll for the EB
 * to self-report disconnect (status='offline' via final heartbeat) or for all its
 * in-flight commands to reach a terminal state. The EB's drain() flushes pending
 * test_result/screenshot/network_bodies POSTs before exiting. Only after the
 * grace window do we DELETE the k8s Job as a fallback.
 */
// Serializes the "check pool size + reserve slot" decision across concurrent
// release calls. Without this, two parallel releases both read size=3 under a
// warmPoolMin=2 budget and both terminate, dropping the pool below the floor.
let reserveGate: Promise<void> = Promise.resolve();

async function maybeTerminateReleasedEB(runnerId: string): Promise<void> {
  const [runner] = await db
    .select({ name: runners.name, isSystem: runners.isSystem, type: runners.type })
    .from(runners)
    .where(eq(runners.id, runnerId));
  if (!runner?.isSystem || runner.type !== 'embedded') return;

  const jobName = jobNameForRunnerName(runner.name);
  if (!jobName) return; // Not a provisioner-created runner (e.g. docker-compose EB)

  // Step 1 — under the reserve gate: check pool size, and if we're above warm
  // min, atomically flip this runner to 'offline' so (a) it can't be re-claimed
  // and (b) subsequent concurrent releases see the new lower count.
  let resolveGate!: () => void;
  const nextGate = new Promise<void>((r) => { resolveGate = r; });
  const prevGate = reserveGate;
  reserveGate = nextGate;
  let reserved = false;
  try {
    await prevGate;
    const size = await currentPoolSize();
    if (size <= warmPoolMin()) {
      return; // Keep this one alive to absorb back-to-back claims
    }
    // Flip to offline now — other concurrent releases will see the decremented count.
    const res = await db
      .update(runners)
      .set({ status: 'offline', lastSeen: new Date() })
      .where(and(eq(runners.id, runnerId), ne(runners.status, 'offline')))
      .returning({ id: runners.id });
    if (res.length === 0) return; // already offline (double release)
    reserved = true;
  } finally {
    resolveGate();
  }
  if (!reserved) return;

  // Step 2: ask the EB to shut itself down gracefully. It was flipped to
  // offline in step 1, so no new work will be queued. Existing in-flight
  // commands still drain through `runnerClient.drain()` on the EB side.
  const { createRunnerCommand } = await import('@/lib/db/queries');
  const { notifyCommandQueued } = await import('@/lib/ws/runner-events');
  try {
    const cmdId = crypto.randomUUID();
    await createRunnerCommand({
      id: cmdId,
      runnerId,
      type: 'command:shutdown',
      status: 'pending',
      payload: { reason: 'pool-release' },
      createdAt: new Date(),
    });
    notifyCommandQueued(runnerId);
  } catch (err) {
    console.warn(`[Pool] Failed to enqueue shutdown for ${runnerId.slice(0, 8)}:`, err);
  }

  // Step 3: wait up to EB_SHUTDOWN_GRACE_MS for the EB's in-flight commands to
  // complete (drain signal). If everything's already settled, proceed.
  const graceMs = parseInt(process.env.EB_SHUTDOWN_GRACE_MS || '30000', 10);
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const pendingOrClaimed = await db
      .select({ id: runnerCommands.id })
      .from(runnerCommands)
      .where(and(
        eq(runnerCommands.runnerId, runnerId),
        ne(runnerCommands.status, 'completed'),
        ne(runnerCommands.status, 'failed'),
        ne(runnerCommands.status, 'timeout'),
        ne(runnerCommands.status, 'cancelled'),
      ));
    if (pendingOrClaimed.length === 0) {
      // All work resolved; ok to proceed with Job deletion even if heartbeat
      // hasn't landed yet (drain() may still be running but results are in).
      break;
    }
  }

  // Step 4: update the embedded_sessions row + tear down the Job. Runner row
  // was already flipped in step 1 under the gate.
  await db
    .update(embeddedSessions)
    .set({ status: 'stopped', busySince: null })
    .where(eq(embeddedSessions.runnerId, runnerId));

  await terminateEBJob(jobName);
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
  // Don't bother if no EBs are available — avoids churning jobs
  if (await isPoolBusy()) return;

  // Find first pending job with no target runner (queued because all EBs were busy)
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
 * Claim an idle pool EB; if none is available and we're running in Kubernetes
 * mode (EB_PROVISIONER=kubernetes), provision a new Job and wait for it to
 * register, then claim it.
 *
 * Returns null if:
 *   - not in kubernetes mode and no idle EB available
 *   - pool is at EB_POOL_MAX capacity
 *   - provisioning timed out (pod failed to register within waitTimeoutMs)
 */
export async function claimOrProvisionPoolEB(
  opts: { waitTimeoutMs?: number } = {},
): Promise<{ runnerId: string; sessionId: string | null } | null> {
  // Fast path: an idle EB is already online
  const claimed = await claimPoolEB();
  if (claimed) return claimed;

  if (!isKubernetesMode()) return null;

  // Enforce global cap
  const size = await currentPoolSize();
  if (size >= poolMax()) {
    console.warn(`[Pool] At capacity (${size}/${poolMax()}) — cannot provision new EB`);
    return null;
  }

  // Provision a new Job
  let jobInfo: { jobName: string; instanceId: string };
  try {
    jobInfo = await launchEBJob();
  } catch (err) {
    console.error('[Pool] launchEBJob failed:', err);
    return null;
  }

  // Wait for the new EB to auto-register and reach `online`
  const waitTimeoutMs = opts.waitTimeoutMs ?? 90_000;
  const deadline = Date.now() + waitTimeoutMs;
  const expectedRunnerName = `System EB-${jobInfo.instanceId}`;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));

    const [runner] = await db
      .select({ id: runners.id, status: runners.status })
      .from(runners)
      .where(and(eq(runners.name, expectedRunnerName), eq(runners.isSystem, true)));

    if (!runner) continue; // Not yet registered

    if (runner.status !== 'online') continue; // Registered but still initializing

    // Try to atomically claim this specific runner
    const result = await db
      .update(runners)
      .set({ status: 'busy' as const, lastSeen: new Date() })
      .where(and(eq(runners.id, runner.id), eq(runners.status, 'online')))
      .returning({ id: runners.id, teamId: runners.teamId });
    if (result.length === 0) {
      // Someone else grabbed it — fall back to a generic claim
      const fallback = await claimPoolEB();
      if (fallback) return fallback;
      continue;
    }

    const [session] = await db
      .select({ id: embeddedSessions.id })
      .from(embeddedSessions)
      .where(eq(embeddedSessions.runnerId, runner.id));
    if (session) {
      await db
        .update(embeddedSessions)
        .set({ status: 'busy', busySince: new Date(), lastActivityAt: new Date() })
        .where(eq(embeddedSessions.id, session.id));
    }

    if (result[0]) {
      emitRunnerStatusChange({
        runnerId: runner.id,
        teamId: result[0].teamId,
        status: 'busy',
        previousStatus: 'online',
        timestamp: Date.now(),
      });
    }

    console.log(`[Pool] Provisioned + claimed new EB ${runner.id.slice(0, 8)} (${jobInfo.jobName})`);
    return { runnerId: runner.id, sessionId: session?.id ?? null };
  }

  // Timed out waiting for registration — tear the Job back down to free the slot
  console.warn(`[Pool] Provisioned Job ${jobInfo.jobName} did not register within ${waitTimeoutMs}ms; terminating`);
  terminateEBJob(jobInfo.jobName).catch(() => {});
  return null;
}

/**
 * Reaper: terminate Jobs for system EB runners that are offline or have
 * been idle (online & unclaimed) for longer than the idle TTL. Keeps the
 * configured warm-pool minimum alive.
 *
 * Call alongside reapStalePoolEBs() from the periodic cleanup interval.
 */
export async function reapIdleEBJobs(idleTtlMs: number): Promise<number> {
  if (!isKubernetesMode()) return 0;

  // currentPoolSize now excludes offline rows; they count as already-dead slots.
  // Offline reaping is always safe (we aren't burning capacity by tearing them down).
  // Idle-online reaping is bounded by warmPoolMin so we preserve the warm pool.
  const activeSize = await currentPoolSize();
  const minKeep = warmPoolMin();

  const cutoff = new Date(Date.now() - idleTtlMs);
  const candidates = await db
    .select({ id: runners.id, name: runners.name, status: runners.status, lastSeen: runners.lastSeen })
    .from(runners)
    .where(and(eq(runners.isSystem, true), eq(runners.type, 'embedded')));

  let terminated = 0;
  let onlineReaped = 0;
  for (const row of candidates) {
    const isOffline = row.status === 'offline';
    const isIdle = row.status === 'online' && (!row.lastSeen || row.lastSeen < cutoff);
    if (!isOffline && !isIdle) continue;

    // Protect warm pool: only reap an idle-online row if doing so would still
    // leave at least minKeep non-offline rows alive. Offline rows are unconditional.
    if (isIdle && activeSize - onlineReaped <= minKeep) continue;

    const jobName = jobNameForRunnerName(row.name);
    if (!jobName) continue; // docker-compose EB — don't touch

    try {
      // FK-order-respecting cleanup: children before parent.
      await db.transaction(async (tx) => {
        await tx.delete(embeddedSessions).where(eq(embeddedSessions.runnerId, row.id));
        await tx.delete(runnerCommandResults).where(eq(runnerCommandResults.runnerId, row.id));
        await tx.delete(runnerCommands).where(eq(runnerCommands.runnerId, row.id));
        await tx.delete(runners).where(eq(runners.id, row.id));
      });
      await terminateEBJob(jobName);
      terminated++;
      if (!isOffline) onlineReaped++;
    } catch (err) {
      console.error(`[Pool] Failed to reap ${row.name}:`, err);
    }
  }

  if (terminated > 0) console.log(`[Pool] Reaped ${terminated} idle EB Job(s)`);
  return terminated;
}

/**
 * Reaper: release EBs whose runner has stopped heartbeating.
 * Heartbeat is the authoritative liveness signal — a healthy long-running test
 * keeps the runner heartbeating, so this won't kill legitimate work. Per-test
 * timeouts are enforced separately by the executor.
 * Wire this into the periodic cleanup interval (alongside markStaleRunnersOffline).
 */
export async function reapStalePoolEBs(heartbeatTimeoutMs = 90_000): Promise<number> {
  const heartbeatCutoff = new Date(Date.now() - heartbeatTimeoutMs);

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
    if (!row.lastSeen || row.lastSeen < heartbeatCutoff) {
      await db.update(runners).set({ status: 'offline' }).where(eq(runners.id, row.runnerId));
      await db
        .update(embeddedSessions)
        .set({ status: 'stopped', busySince: null, userId: null })
        .where(eq(embeddedSessions.id, row.sessionId));
      reaped++;
      console.warn(`[Reaper] Force-released stale EB ${row.runnerId.slice(0, 8)} (lastSeen ${row.lastSeen?.toISOString() ?? 'never'}, busy since ${row.busySince?.toISOString() ?? 'unknown'})`);
    }
  }
  return reaped;
}
