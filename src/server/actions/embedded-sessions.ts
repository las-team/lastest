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
  listEBJobNames,
  poolMax,
  warmPoolMin,
  currentPoolSize,
  incInFlightProvisions,
  decInFlightProvisions,
} from '@/lib/eb/provisioner';
import { toProxyStreamUrl } from '@/lib/eb/stream-url';
import { stopDevPortForward } from '@/lib/eb/dev-port-forward';

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
  // Exclude offline runners — they represent dying Jobs awaiting GC and
  // shouldn't be surfaced as "available EBs" in the UI (caused transient
  // overcounts like 8/24/32 just after a build drained).
  const systemRunnerIds = await db
    .select({ id: runners.id })
    .from(runners)
    .where(and(eq(runners.isSystem, true), ne(runners.status, 'offline')));

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

// Drizzle's transaction callback arg has the same DB-op methods as `db` but
// without `.transaction`. Use a narrow union so callers can pass either the
// top-level `db` or a `tx` from inside a transaction.
type DBExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Upsert an embedded session for a runner — ensures exactly 1 session per runner.
 * On restart, updates the existing session instead of creating a duplicate.
 *
 * Optionally accepts a transaction `tx` so callers (e.g. the auto-register
 * route) can bundle runner + session writes atomically — required to close the
 * race where `claimPoolEB` sees `runner.status='online'` before the session
 * row exists and claims into a half-registered state.
 */
export async function upsertEmbeddedSession(params: {
  teamId: string;
  runnerId: string;
  streamUrl: string;
  cdpUrl?: string;
  containerUrl: string;
  viewport?: { width: number; height: number };
}, tx?: DBExecutor): Promise<EmbeddedSession> {
  const exec = tx ?? db;
  const [existing] = await exec
    .select()
    .from(embeddedSessions)
    .where(eq(embeddedSessions.runnerId, params.runnerId));

  if (existing) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

    // Update the existing session. Preserve `busy` — a re-register that wipes it
    // to `ready` defeats the session-busy safeguard in `updateRunnerStatus` and
    // lets `claimPoolEB` hand the same EB to a second worker concurrently
    // (observed in production as `Target … has been closed`).
    const preserveBusy = existing.status === 'busy';
    await exec
      .update(embeddedSessions)
      .set({
        streamUrl: params.streamUrl,
        cdpUrl: params.cdpUrl ?? null,
        containerUrl: params.containerUrl,
        viewport: params.viewport ?? { width: 1280, height: 720 },
        ...(preserveBusy ? {} : { status: 'ready', userId: null }),
        lastActivityAt: now,
        expiresAt,
      })
      .where(eq(embeddedSessions.id, existing.id));

    // Delete any accumulated duplicates
    await exec
      .delete(embeddedSessions)
      .where(and(eq(embeddedSessions.runnerId, params.runnerId), ne(embeddedSessions.id, existing.id)));

    const [updated] = await exec
      .select()
      .from(embeddedSessions)
      .where(eq(embeddedSessions.id, existing.id));

    return updated!;
  }

  return createEmbeddedSession(params, tx);
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
}, tx?: DBExecutor): Promise<EmbeddedSession> {
  const exec = tx ?? db;
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30min expiry

  await exec.insert(embeddedSessions).values({
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

  const [created] = await exec
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
    streamUrl: toProxyStreamUrl(session.streamUrl),
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
  return size >= await poolMax();
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
  // Observed in production: two concurrent callers both ended up with the same
  // EB using the previous `UPDATE WHERE status='online' RETURNING id` pattern
  // (both "attempt 1" claims succeeded on the same row). Downstream the EB's
  // `index.ts:338` fire-and-forget model runs both workers' tests on one
  // Chromium process → contention, blank screenshots, stuck builds.
  //
  // Switching to the canonical PG concurrent-claim pattern: a transaction
  // with `SELECT ... FOR UPDATE SKIP LOCKED`. This guarantees that concurrent
  // claimers pick DIFFERENT rows (the row lock is acquired inside the SELECT),
  // so no two claimers can ever end up on the same EB.
  return await db.transaction(async (tx) => {
    // Defense-in-depth: only match runners that already have a corresponding
    // `ready` embedded_session row. Auto-register now writes both in one tx, so
    // this should always match — but if any future codepath writes the runner
    // row before its session (or leaves a dangling runner), we refuse the
    // claim instead of flipping `runner.status='busy'` while the session stays
    // `ready` (the UI-green-while-active bug).
    const [candidate] = await tx
      .select({ id: runners.id, teamId: runners.teamId, sessionId: embeddedSessions.id })
      .from(runners)
      .innerJoin(embeddedSessions, and(
        eq(embeddedSessions.runnerId, runners.id),
        eq(embeddedSessions.status, 'ready'),
      ))
      .where(and(
        eq(runners.isSystem, true),
        eq(runners.status, 'online'),
        eq(runners.type, 'embedded'),
      ))
      .limit(1)
      .for('update', { skipLocked: true });

    if (!candidate) return null;

    await tx
      .update(runners)
      .set({ status: 'busy' as const, lastSeen: new Date() })
      .where(eq(runners.id, candidate.id));

    await tx
      .update(embeddedSessions)
      .set({
        status: 'busy',
        busySince: new Date(),
        lastActivityAt: new Date(),
      })
      .where(eq(embeddedSessions.id, candidate.sessionId));

    emitRunnerStatusChange({
      runnerId: candidate.id,
      teamId: candidate.teamId,
      status: 'busy',
      previousStatus: 'online',
      timestamp: Date.now(),
    });

    console.log(`[Pool] Claimed EB ${candidate.id.slice(0, 8)}`);
    return { runnerId: candidate.id, sessionId: candidate.sessionId };
  });
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
    .select({ status: runners.status, teamId: runners.teamId, isSystem: runners.isSystem, type: runners.type, name: runners.name })
    .from(runners)
    .where(eq(runners.id, runnerId));
  if (!runner) return;

  // 1-job-1-EB enforcement (k8s + system embedded EBs): flip directly
  // `busy → offline` so claimPoolEB (which only picks `online`) can never
  // race in. Then tear down the Job. The previous design routed through an
  // `online` intermediate plus a fire-and-forget `maybeTerminateReleasedEB`,
  // which left a window where a peer's claimPoolEB could grab the just-
  // released EB before terminate fired — recycling one EB across multiple
  // tests, producing blank-white screenshots from CDP/screencast races.
  // claimOrProvisionPoolEB launches fresh EBs on demand, and warm-pool
  // refill is handled by ensureWarmPool, so we don't need to recycle here.
  const isPoolEB = isKubernetesMode() && runner.isSystem === true && runner.type === 'embedded';
  if (isPoolEB) {
    const previousStatus = runner.status;
    await db
      .update(runners)
      .set({ status: 'offline', lastSeen: new Date() })
      .where(eq(runners.id, runnerId));
    // Null out connection URLs so a stale `embedded_sessions` row can't hand a
    // dead pod IP to a browser that re-fetches by sessionId after the Job is
    // torn down. Without this the WS proxy gets a "WebSocket connection failed"
    // with no diagnostics until the row is reaped.
    await db
      .update(embeddedSessions)
      .set({
        status: 'stopped',
        userId: null,
        busySince: null,
        streamUrl: null,
        cdpUrl: null,
        containerUrl: null,
        lastActivityAt: new Date(),
      })
      .where(eq(embeddedSessions.runnerId, runnerId));

    if (previousStatus === 'busy' || previousStatus === 'online') {
      emitRunnerStatusChange({
        runnerId,
        teamId: runner.teamId,
        status: 'offline',
        previousStatus,
        timestamp: Date.now(),
      });
    }

    console.log(`[Pool] Released EB ${runnerId.slice(0, 8)} → terminating (1-job-1-EB)`);
    teardownPoolEB(runnerId, runner.name).catch((err) => {
      console.error(`[Pool] Tear-down failed for ${runnerId.slice(0, 8)}:`, err);
    });
    processPoolQueue().catch((err) => {
      console.error(`[Pool] Error processing queue after release:`, err);
    });
    // Refill the warm pool if this release drops us below warmPoolMin. The
    // periodic refill in /api/ws/runner only runs once that route module is
    // loaded by an EB heartbeat — but if the pool drains to 0, no heartbeats
    // fire and the loop never starts. Pulling the refill here breaks that
    // dead state without depending on any external timer.
    const { ensureWarmPool } = await import('@/lib/eb/provisioner');
    ensureWarmPool().catch((err) => {
      console.error('[Pool] ensureWarmPool after release failed:', err);
    });
    return;
  }

  // Non-k8s (compose / dev): pool is fixed-size and we can't dynamically
  // provision replacements — recycle the runner so the next test reuses it.
  if (runner.status === 'busy') {
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
  await db
    .update(embeddedSessions)
    .set({
      status: 'ready',
      userId: null,
      busySince: null,
      lastActivityAt: new Date(),
    })
    .where(eq(embeddedSessions.runnerId, runnerId));

  console.log(`[Pool] Released EB ${runnerId.slice(0, 8)} (recycled)`);

  processPoolQueue().catch((err) => {
    console.error(`[Pool] Error processing queue after release:`, err);
  });
}

/**
 * Tear down the k8s Job backing a released system EB.
 *
 * Caller is responsible for already having flipped the runner to `offline`
 * (so no claimPoolEB can race in). This function only handles the
 * shutdown→drain→delete sequence: enqueue `command:shutdown` so the EB's
 * `runnerClient.drain()` flushes pending test_result/screenshot/network_bodies
 * uploads, wait up to EB_SHUTDOWN_GRACE_MS for in-flight commands to settle,
 * then DELETE the Job as a fallback if the EB hasn't exited cleanly.
 */
async function teardownPoolEB(runnerId: string, runnerName: string): Promise<void> {
  const jobName = jobNameForRunnerName(runnerName);
  if (!jobName) return; // not a provisioner-created runner

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
    if (pendingOrClaimed.length === 0) break;
  }

  await terminateEBJob(jobName);
  stopDevPortForward(jobName);
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
 *   - pool is at ebPoolMax capacity (global playwright_settings)
 *   - provisioning timed out (pod failed to register within waitTimeoutMs)
 */
export async function claimOrProvisionPoolEB(
  opts: { waitTimeoutMs?: number } = {},
): Promise<{ runnerId: string; sessionId: string | null } | null> {
  // Fast path: an idle EB is already online
  const claimed = await claimPoolEB();
  if (claimed) return claimed;

  if (!isKubernetesMode()) return null;

  // Enforce global cap (currentPoolSize now includes in-flight provisions so
  // concurrent callers during an app restart or burst claim can't collectively
  // blow past the cap).
  const size = await currentPoolSize();
  const cap = await poolMax();
  if (size >= cap) {
    console.warn(`[Pool] At capacity (${size}/${cap}) — cannot provision new EB`);
    return null;
  }

  // Reserve a slot in the in-flight counter BEFORE launching. Decrement in
  // the success branch (after the runner row is inserted by register) or in
  // any early-return / timeout / error branch below.
  incInFlightProvisions();
  let provisionReserved = true;
  const releaseReservation = () => {
    if (provisionReserved) {
      decInFlightProvisions();
      provisionReserved = false;
    }
  };

  // Provision a new Job
  let jobInfo: { jobName: string; instanceId: string };
  try {
    jobInfo = await launchEBJob();
  } catch (err) {
    console.error('[Pool] launchEBJob failed:', err);
    releaseReservation();
    return null;
  }

  // Wait for the new EB to auto-register and reach `online`
  const waitTimeoutMs = opts.waitTimeoutMs ?? 90_000;
  const deadline = Date.now() + waitTimeoutMs;
  const expectedRunnerName = `System EB-${jobInfo.instanceId}`;
  const provisionStart = Date.now();
  let lastLoggedSecond = -1;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));

    // Log provisioning latency every ~10s so slow Olares cold starts are visible
    // without needing to add per-poll noise. Catches startup-window race symptoms.
    const elapsedSec = Math.round((Date.now() - provisionStart) / 1000);
    if (elapsedSec > 0 && elapsedSec % 10 === 0 && elapsedSec !== lastLoggedSecond) {
      lastLoggedSecond = elapsedSec;
      console.log(`[Pool] Waiting for ${expectedRunnerName} to register: ${elapsedSec}s elapsed (timeout ${waitTimeoutMs / 1000}s)`);
    }

    // Transactional claim with row-level lock (SKIP LOCKED) — same pattern as
    // claimPoolEB. Guarantees that two concurrent callers can't end up on the
    // same runner even if they both see it as `online` in their snapshots.
    const claimResult = await db.transaction(async (tx) => {
      // Require the session row to exist + be `ready`. If the auto-register
      // tx hasn't committed yet we skip this cycle and let the outer loop
      // retry — prevents the half-registered state (runner=busy, session=ready)
      // that stalled the UI + defeated the `updateRunnerStatus` busy guard.
      const [row] = await tx
        .select({
          id: runners.id,
          teamId: runners.teamId,
          status: runners.status,
          sessionId: embeddedSessions.id,
        })
        .from(runners)
        .innerJoin(embeddedSessions, and(
          eq(embeddedSessions.runnerId, runners.id),
          eq(embeddedSessions.status, 'ready'),
        ))
        .where(and(
          eq(runners.name, expectedRunnerName),
          eq(runners.isSystem, true),
          eq(runners.status, 'online'),
        ))
        .limit(1)
        .for('update', { skipLocked: true });

      if (!row) return null;

      await tx
        .update(runners)
        .set({ status: 'busy' as const, lastSeen: new Date() })
        .where(eq(runners.id, row.id));

      await tx
        .update(embeddedSessions)
        .set({ status: 'busy', busySince: new Date(), lastActivityAt: new Date() })
        .where(eq(embeddedSessions.id, row.sessionId));

      return { runnerId: row.id, teamId: row.teamId, sessionId: row.sessionId };
    });

    if (!claimResult) {
      // Not registered yet, or already claimed by someone else — retry via
      // generic claim (may pick this very same row once its lock releases,
      // or a different idle one).
      const fallback = await claimPoolEB();
      if (fallback) {
        releaseReservation();
        return fallback;
      }
      continue;
    }

    emitRunnerStatusChange({
      runnerId: claimResult.runnerId,
      teamId: claimResult.teamId,
      status: 'busy',
      previousStatus: 'online',
      timestamp: Date.now(),
    });

    console.log(`[Pool] Provisioned + claimed new EB ${claimResult.runnerId.slice(0, 8)} (${jobInfo.jobName})`);
    // Runner row now exists; currentPoolSize() will see it normally.
    releaseReservation();
    return { runnerId: claimResult.runnerId, sessionId: claimResult.sessionId };
  }

  // Timed out waiting for registration — tear the Job back down to free the slot
  console.warn(`[Pool] Provisioned Job ${jobInfo.jobName} did not register within ${waitTimeoutMs}ms; terminating`);
  terminateEBJob(jobInfo.jobName).catch(() => {});
  stopDevPortForward(jobInfo.jobName);
  releaseReservation();
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
  // Join sessions to get lastActivityAt (bumped on claim/release/register —
  // NOT on heartbeat). Using runners.lastSeen instead would never trigger:
  // a healthy idle EB heartbeats every few seconds, so lastSeen stays fresh
  // and the reaper never finds anything to clean up. Symptom seen in prod:
  // a build that bursts the pool to 50 leaves the surplus online-idle EBs
  // sitting forever (they only get claimed if another build runs).
  const candidates = await db
    .select({
      id: runners.id,
      name: runners.name,
      status: runners.status,
      lastActivityAt: embeddedSessions.lastActivityAt,
    })
    .from(runners)
    .leftJoin(embeddedSessions, eq(embeddedSessions.runnerId, runners.id))
    .where(and(eq(runners.isSystem, true), eq(runners.type, 'embedded')));

  let terminated = 0;
  let onlineReaped = 0;
  for (const row of candidates) {
    const isOffline = row.status === 'offline';
    const isIdle = row.status === 'online' && (!row.lastActivityAt || row.lastActivityAt < cutoff);
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
      stopDevPortForward(jobName);
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
 * Boot-time reconciliation: release any pool EBs stuck in `busy` state.
 *
 * Claims live in app-process memory — when the app pod restarts mid-test,
 * the worker promise is gone but the DB still shows runner='busy' and
 * session='busy'. The heartbeat reaper can't clean these up because the
 * EB container itself is alive and keeps heartbeating. Nothing can be
 * legitimately mid-claim when the app just booted (single-replica, Recreate
 * strategy), so flip everything busy back to online/ready.
 */
export async function reconcileOrphanedPoolEBs(): Promise<number> {
  // Step 1: flip any busy system runner back to 'online' so releasePoolEB
  // sees it as claimed and goes through the normal release path.
  const orphaned = await db
    .select({ id: runners.id })
    .from(runners)
    .where(and(eq(runners.isSystem, true), eq(runners.status, 'busy')))
    .for('update');

  if (orphaned.length > 0) {
    // Flip sessions to ready first (independent of per-runner release below).
    await db
      .update(embeddedSessions)
      .set({ status: 'ready', busySince: null, userId: null, lastActivityAt: new Date() })
      .where(eq(embeddedSessions.status, 'busy'));

    // Step 2: for each orphan, go through releasePoolEB so the Job is torn
    // down (1-job-1-EB: every release terminates the EB; ensureWarmPool
    // refills as needed). Releases run serially so we don't burst the k8s
    // API on app boot when many orphans are present.
    for (const row of orphaned) {
      await db
        .update(runners)
        .set({ status: 'busy', lastSeen: new Date() })
        .where(eq(runners.id, row.id));
      try {
        await releasePoolEB(row.id);
      } catch (err) {
        console.error(`[Boot] releasePoolEB failed for ${row.id.slice(0, 8)}:`, err);
      }
    }

    console.log(`[Boot] Reconciled ${orphaned.length} orphaned busy EB(s) via releasePoolEB`);
  }

  // Step 3: prune phantom rows — system EB runners in the DB whose backing
  // k8s Job no longer exists (TTL expired, manually deleted, cluster was
  // down when the Job finished). Without this, claimPoolEB hands out a dead
  // runner and start_debug commands pile up in `runner_commands` with nothing
  // to consume them — symptom: UI stuck on "Launching browser..." forever.
  let phantoms = 0;
  if (isKubernetesMode()) {
    try {
      const liveJobs = await listEBJobNames();
      const poolRows = await db
        .select({ id: runners.id, name: runners.name })
        .from(runners)
        .where(and(
          eq(runners.isSystem, true),
          eq(runners.type, 'embedded'),
          ne(runners.status, 'offline'),
        ));

      for (const row of poolRows) {
        const jobName = jobNameForRunnerName(row.name);
        // Only touch dynamic pool rows (eb-<ts>-<rand>); skip static sidecars.
        if (!jobName) continue;
        if (liveJobs.has(jobName)) continue;

        await db.transaction(async (tx) => {
          await tx.delete(embeddedSessions).where(eq(embeddedSessions.runnerId, row.id));
          await tx.delete(runnerCommandResults).where(eq(runnerCommandResults.runnerId, row.id));
          await tx.delete(runnerCommands).where(eq(runnerCommands.runnerId, row.id));
          await tx.delete(runners).where(eq(runners.id, row.id));
        });
        phantoms++;
        console.log(`[Boot] Pruned phantom EB runner ${row.name} (no matching k8s Job)`);
      }
    } catch (err) {
      console.error('[Boot] phantom reconciliation failed:', err);
    }
  }

  return orphaned.length + phantoms;
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
