'use server';

import { db } from '@/lib/db';
import { runners, type Runner, type RunnerCapability } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { requireTeamAdmin, requireTeamAccess } from '@/lib/auth';

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
 * Get all runners for the current team
 */
export async function getRunners(): Promise<Runner[]> {
  const session = await requireTeamAccess();
  return db
    .select()
    .from(runners)
    .where(eq(runners.teamId, session.team.id))
    .orderBy(desc(runners.createdAt))
    .all();
}

/**
 * Get a specific runner by ID (team-scoped)
 */
export async function getRunner(runnerId: string): Promise<Runner | null> {
  const session = await requireTeamAccess();
  const runner = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, session.team.id)))
    .get();
  return runner ?? null;
}

/**
 * Create a new runner (admin only)
 * Returns the runner AND the plain token (only shown once)
 */
export async function createRunner(name: string, capabilities: RunnerCapability[] = ['run', 'record']): Promise<{
  runner: Runner;
  token: string;
} | { error: string }> {
  const session = await requireTeamAdmin();

  const id = uuid();
  const token = generateRunnerToken();
  const tokenHash = hashToken(token);
  const now = new Date();

  await db.insert(runners).values({
    id,
    teamId: session.team.id,
    createdById: session.user.id,
    name,
    tokenHash,
    status: 'offline',
    capabilities,
    createdAt: now,
  });

  const runner = await db.select().from(runners).where(eq(runners.id, id)).get();
  if (!runner) {
    return { error: 'Failed to create runner' };
  }

  return { runner, token };
}

/**
 * Update runner name (admin only)
 */
export async function updateRunnerName(runnerId: string, name: string): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAdmin();

  const runner = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, session.team.id)))
    .get();

  if (!runner) {
    return { error: 'Runner not found' };
  }

  await db.update(runners).set({ name }).where(eq(runners.id, runnerId));
  return { success: true };
}

/**
 * Regenerate runner token (admin only)
 * Returns the new plain token (only shown once)
 */
export async function regenerateRunnerToken(runnerId: string): Promise<{ token: string } | { error: string }> {
  const session = await requireTeamAdmin();

  const runner = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, session.team.id)))
    .get();

  if (!runner) {
    return { error: 'Runner not found' };
  }

  const token = generateRunnerToken();
  const tokenHash = hashToken(token);

  await db.update(runners).set({ tokenHash }).where(eq(runners.id, runnerId));
  return { token };
}

/**
 * Delete a runner (admin only)
 */
export async function deleteRunner(runnerId: string): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAdmin();

  const runner = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, session.team.id)))
    .get();

  if (!runner) {
    return { error: 'Runner not found' };
  }

  await db.delete(runners).where(eq(runners.id, runnerId));
  return { success: true };
}

/**
 * Update runner status (internal use - called by WebSocket handler)
 */
export async function updateRunnerStatus(
  runnerId: string,
  status: 'online' | 'offline' | 'busy',
  lastSeen?: Date
): Promise<void> {
  await db
    .update(runners)
    .set({
      status,
      lastSeen: lastSeen ?? new Date(),
    })
    .where(eq(runners.id, runnerId));
}

/**
 * Validate runner token and return runner info
 * Used by WebSocket connection handler
 */
export async function validateRunnerToken(token: string): Promise<Runner | null> {
  const tokenHash = hashToken(token);
  const runner = await db
    .select()
    .from(runners)
    .where(eq(runners.tokenHash, tokenHash))
    .get();
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
    .where(and(eq(runners.teamId, session.team.id), eq(runners.status, 'online')))
    .all();
}

/**
 * Check if team has any connected runners
 */
export async function hasConnectedRunners(): Promise<boolean> {
  const session = await requireTeamAccess();
  const onlineRunner = await db
    .select()
    .from(runners)
    .where(and(eq(runners.teamId, session.team.id), eq(runners.status, 'online')))
    .limit(1)
    .get();
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
    .where(and(eq(runners.teamId, session.team.id), eq(runners.status, 'online')))
    .all();

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
 * Get all runners filtered by capability (for UI selection with offline shown as disabled)
 */
export async function getRunnersWithCapability(capability?: RunnerCapability): Promise<Runner[]> {
  const session = await requireTeamAccess();
  const allRunners = await db
    .select()
    .from(runners)
    .where(eq(runners.teamId, session.team.id))
    .orderBy(desc(runners.createdAt))
    .all();

  // Filter by capability if specified
  if (capability) {
    return allRunners.filter((runner) => {
      const caps = runner.capabilities || ['run', 'record'];
      return caps.includes(capability);
    });
  }

  return allRunners;
}
