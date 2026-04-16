'use server';

import { db } from '@/lib/db';
import { runners, backgroundJobs, embeddedSessions, runnerCommands, runnerCommandResults, type Runner, type RunnerCapability, type RunnerType } from '@/lib/db/schema';
import { eq, and, desc, isNull, lt, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { requireTeamAdmin, requireTeamAccess } from '@/lib/auth';
import { emitRunnerStatusChange } from '@/lib/ws/runner-events';

/**
 * Hash a runner token using SHA256
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a secure runner token
 * Format: lastest_runner_<random>
 */
function generateRunnerToken(): string {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `lastest_runner_${randomBytes}`;
}

/**
 * Get all runners for the current team (excludes system runners)
 */
export async function getRunners(): Promise<Runner[]> {
  const session = await requireTeamAccess();
  return db
    .select()
    .from(runners)
    .where(and(eq(runners.teamId, session.team.id), eq(runners.isSystem, false)))
    .orderBy(desc(runners.createdAt));
}

/**
 * Get online system runners (host-provided EBs, available to all teams).
 * No auth required — these are visible to any authenticated user.
 */
export async function getSystemRunners(): Promise<Runner[]> {
  return db
    .select()
    .from(runners)
    .where(eq(runners.isSystem, true))
    .orderBy(desc(runners.createdAt));
}

/**
 * Get an available (online) system runner for auto-assignment.
 */
export async function getAvailableSystemRunner(): Promise<Runner | null> {
  const [row] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.isSystem, true), eq(runners.status, 'online')))
    .limit(1);
  return row ?? null;
}

/**
 * Get a specific runner by ID (team-scoped)
 */
export async function getRunner(runnerId: string): Promise<Runner | null> {
  const session = await requireTeamAccess();
  const [runner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, session.team.id)));
  return runner ?? null;
}

/**
 * Internal runner creation (no auth check — caller must verify permissions).
 */
export async function createRunnerInternal(
  name: string,
  teamId: string,
  createdById: string,
  capabilities: RunnerCapability[] = ['run', 'record'],
  type: RunnerType = 'remote',
  authOnly: boolean = false,
): Promise<{ runner: Runner; token: string } | { error: string }> {
  const id = uuid();
  const token = generateRunnerToken();
  const tokenHash = hashToken(token);
  const now = new Date();

  await db.insert(runners).values({
    id,
    teamId,
    createdById,
    name,
    tokenHash,
    status: 'offline',
    capabilities,
    type,
    authOnly,
    createdAt: now,
  });

  const [runner] = await db.select().from(runners).where(eq(runners.id, id));
  if (!runner) {
    return { error: 'Failed to create runner' };
  }

  return { runner, token };
}

/**
 * Create a new runner (admin only)
 * Returns the runner AND the plain token (only shown once)
 */
export async function createRunner(name: string, capabilities: RunnerCapability[] = ['run', 'record'], type: RunnerType = 'remote'): Promise<{
  runner: Runner;
  token: string;
} | { error: string }> {
  const session = await requireTeamAdmin();
  return createRunnerInternal(name, session.team.id, session.user.id, capabilities, type);
}

/**
 * Update runner name (admin only)
 */
export async function updateRunnerName(runnerId: string, name: string): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAdmin();

  const [runner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, session.team.id)));

  if (!runner) {
    return { error: 'Runner not found' };
  }

  await db.update(runners).set({ name }).where(eq(runners.id, runnerId));
  return { success: true };
}

/**
 * Regenerate runner token (internal use — no auth check, caller must verify permissions).
 * Returns the new plain token.
 */
export async function regenerateRunnerTokenInternal(runnerId: string, teamId: string): Promise<{ token: string } | { error: string }> {
  const [runner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, teamId)));

  if (!runner) {
    return { error: 'Runner not found' };
  }

  const token = generateRunnerToken();
  const tokenHash = hashToken(token);

  await db.update(runners).set({ tokenHash }).where(eq(runners.id, runnerId));
  return { token };
}

/**
 * Regenerate runner token (admin only)
 * Returns the new plain token (only shown once)
 */
export async function regenerateRunnerToken(runnerId: string): Promise<{ token: string } | { error: string }> {
  const session = await requireTeamAdmin();

  const [runner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, session.team.id)));

  if (!runner) {
    return { error: 'Runner not found' };
  }

  const token = generateRunnerToken();
  const tokenHash = hashToken(token);

  await db.update(runners).set({ tokenHash }).where(eq(runners.id, runnerId));
  return { token };
}

/**
 * Update runner settings (admin only)
 */
export async function updateRunnerSettings(
  runnerId: string,
  settings: { maxParallelTests?: number }
): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAdmin();

  const [runner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, session.team.id)));

  if (!runner) {
    return { error: 'Runner not found' };
  }

  await db.update(runners).set(settings).where(eq(runners.id, runnerId));
  return { success: true };
}

/**
 * Delete a runner (admin only)
 */
export async function deleteRunner(runnerId: string): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAdmin();

  const [runner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, session.team.id)));

  if (!runner) {
    return { error: 'Runner not found' };
  }

  await db.delete(runners).where(eq(runners.id, runnerId));
  return { success: true };
}

/**
 * Internal runner deletion (no auth check — caller must verify permissions).
 */
export async function deleteRunnerInternal(runnerId: string, teamId: string): Promise<void> {
  await db.delete(runners).where(and(eq(runners.id, runnerId), eq(runners.teamId, teamId)));
}

/**
 * Stop a running runner remotely (admin only)
 * Queues a shutdown command that the runner will receive on next heartbeat
 */
export async function stopRunner(runnerId: string): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAdmin();

  const [runner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, session.team.id)));

  if (!runner) {
    return { error: 'Runner not found' };
  }

  if (runner.status === 'offline') {
    return { error: 'Runner is already offline' };
  }

  // Import dynamically to avoid circular dependency
  const { queueCommandToDB } = await import('@/app/api/ws/runner/route');

  await queueCommandToDB(runnerId, {
    id: crypto.randomUUID(),
    type: 'command:shutdown',
    timestamp: Date.now(),
    payload: {
      reason: 'Remote shutdown requested by admin',
    },
  });

  return { success: true };
}

/**
 * Update runner status (internal use - called by WebSocket handler)
 * Emits SSE event when status changes
 */
export async function updateRunnerStatus(
  runnerId: string,
  status: 'online' | 'offline' | 'busy',
  lastSeen?: Date
): Promise<void> {
  // Get current status to detect changes
  const [current] = await db.select().from(runners).where(eq(runners.id, runnerId));
  const previousStatus = current?.status;

  // If heartbeat says 'online' but the embedded session is still busy,
  // keep runner as 'busy' — the pool claimed it and the session hasn't been released yet.
  let effectiveStatus = status;
  if (status === 'online' && current?.type === 'embedded') {
    const [busySession] = await db
      .select({ id: embeddedSessions.id })
      .from(embeddedSessions)
      .where(and(
        eq(embeddedSessions.runnerId, runnerId),
        eq(embeddedSessions.status, 'busy'),
      ))
      .limit(1);
    if (busySession) {
      effectiveStatus = 'busy';
    }
  }

  await db
    .update(runners)
    .set({
      status: effectiveStatus,
      lastSeen: lastSeen ?? new Date(),
    })
    .where(eq(runners.id, runnerId));

  // Emit event if status actually changed
  if (current && previousStatus !== effectiveStatus) {
    emitRunnerStatusChange({
      runnerId,
      teamId: current.teamId,
      status: effectiveStatus,
      previousStatus: previousStatus as 'online' | 'offline' | 'busy' | undefined,
      timestamp: Date.now(),
    });

    // When a runner comes online, check for pending queued jobs
    if (effectiveStatus === 'online') {
      pickUpQueuedJobs(runnerId).catch((err) => {
        console.error(`[Runner ${runnerId}] Error picking up queued jobs:`, err);
      });
    }
  }
}

/**
 * Pick up pending background jobs that have no assigned runner.
 * Called when a runner transitions to 'online'.
 */
async function pickUpQueuedJobs(runnerId: string): Promise<void> {
  // Find first pending job with no target runner (queued because no runner was available)
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

  // Assign this runner to the job
  await db
    .update(backgroundJobs)
    .set({ targetRunnerId: runnerId })
    .where(eq(backgroundJobs.id, pendingJob.id));

  console.log(`[Runner ${runnerId}] Picked up queued job ${pendingJob.id} (${pendingJob.type}: ${pendingJob.label})`);
}

/**
 * Validate runner token and return runner info
 * Used by WebSocket connection handler
 */
export async function validateRunnerToken(token: string): Promise<Runner | null> {
  const tokenHash = hashToken(token);
  const [runner] = await db
    .select()
    .from(runners)
    .where(eq(runners.tokenHash, tokenHash));
  return runner ?? null;
}

/**
 * Get online runners for a team (for UI status display)
 */
export async function getOnlineRunners(): Promise<Runner[]> {
  const session = await requireTeamAccess();
  return db
    .select()
    .from(runners)
    .where(and(eq(runners.teamId, session.team.id), eq(runners.status, 'online')));
}

/**
 * Check if team has any connected runners
 */
export async function hasConnectedRunners(): Promise<boolean> {
  const session = await requireTeamAccess();
  const [onlineRunner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.teamId, session.team.id), eq(runners.status, 'online')))
    .limit(1);
  return !!onlineRunner;
}

/**
 * Get online runners filtered by capability (for UI selection)
 */
export async function getOnlineRunnersWithCapability(capability?: RunnerCapability): Promise<Runner[]> {
  const session = await requireTeamAccess();
  const onlineRunners = await db
    .select()
    .from(runners)
    .where(and(eq(runners.teamId, session.team.id), eq(runners.status, 'online')));

  // Filter by capability if specified
  if (capability) {
    return onlineRunners.filter((runner) => {
      const caps = runner.capabilities || ['run', 'record'];
      return caps.includes(capability);
    });
  }

  return onlineRunners;
}

/**
 * Get all runners filtered by capability (for UI selection with offline shown as disabled).
 * Includes both team runners and system runners.
 */
export async function getRunnersWithCapability(capability?: RunnerCapability): Promise<Runner[]> {
  const session = await requireTeamAccess();

  // Get team's own runners (non-system)
  const teamRunners = await db
    .select()
    .from(runners)
    .where(and(eq(runners.teamId, session.team.id), eq(runners.isSystem, false)))
    .orderBy(desc(runners.createdAt));

  // Get system runners (cross-team)
  const systemRunners = await db
    .select()
    .from(runners)
    .where(eq(runners.isSystem, true))
    .orderBy(desc(runners.createdAt));

  const allRunners = [...teamRunners, ...systemRunners];

  // Filter by capability if specified
  if (capability) {
    return allRunners.filter((runner) => {
      const caps = runner.capabilities || ['run', 'record'];
      return caps.includes(capability);
    });
  }

  return allRunners;
}

/**
 * Mark stale runners as offline based on lastSeen timestamp
 * Called on server startup and periodically to clean up runners
 * that were marked online but haven't sent heartbeat
 */
export async function markStaleRunnersOffline(staleThresholdMs: number = 60_000): Promise<number> {
  const staleThreshold = new Date(Date.now() - staleThresholdMs);

  // Find all runners that are online/busy but haven't been seen recently
  const staleRunners = await db
    .select()
    .from(runners)
    .where(
      and(
        eq(runners.status, 'online'),
      )
    );

  let markedOffline = 0;
  for (const runner of staleRunners) {
    // If lastSeen is null or older than threshold, mark offline
    if (!runner.lastSeen || runner.lastSeen < staleThreshold) {
      await db
        .update(runners)
        .set({ status: 'offline' })
        .where(eq(runners.id, runner.id));
      markedOffline++;
      console.log(`[Stale Cleanup] Marked runner ${runner.id} (${runner.name}) as offline - lastSeen: ${runner.lastSeen?.toISOString() ?? 'never'}`);
    }
  }

  // Also check busy runners
  const busyRunners = await db
    .select()
    .from(runners)
    .where(eq(runners.status, 'busy'));

  for (const runner of busyRunners) {
    if (!runner.lastSeen || runner.lastSeen < staleThreshold) {
      await db
        .update(runners)
        .set({ status: 'offline' })
        .where(eq(runners.id, runner.id));
      markedOffline++;
      console.log(`[Stale Cleanup] Marked busy runner ${runner.id} (${runner.name}) as offline - lastSeen: ${runner.lastSeen?.toISOString() ?? 'never'}`);
    }
  }

  return markedOffline;
}

/**
 * Delete system runners that have been offline for longer than the threshold.
 * Also deletes their associated embedded sessions.
 */
export async function deleteStaleSystemRunners(thresholdMs: number): Promise<number> {
  const staleThreshold = new Date(Date.now() - thresholdMs);

  const staleRunners = await db
    .select({ id: runners.id, name: runners.name })
    .from(runners)
    .where(
      and(
        eq(runners.isSystem, true),
        eq(runners.status, 'offline'),
        or(
          isNull(runners.lastSeen),
          lt(runners.lastSeen, staleThreshold)
        )
      )
    );

  if (staleRunners.length === 0) return 0;

  for (const runner of staleRunners) {
    // Delete all FK references before deleting the runner
    await db.delete(embeddedSessions).where(eq(embeddedSessions.runnerId, runner.id));
    const cmds = await db.select({ id: runnerCommands.id }).from(runnerCommands).where(eq(runnerCommands.runnerId, runner.id));
    if (cmds.length > 0) {
      for (const cmd of cmds) {
        await db.delete(runnerCommandResults).where(eq(runnerCommandResults.commandId, cmd.id));
      }
      await db.delete(runnerCommands).where(eq(runnerCommands.runnerId, runner.id));
    }
    await db.delete(runnerCommandResults).where(eq(runnerCommandResults.runnerId, runner.id));
    await db.delete(runners).where(eq(runners.id, runner.id));
    console.log(`[Stale Cleanup] Deleted stale system runner ${runner.id} (${runner.name})`);
  }

  return staleRunners.length;
}
