import { db } from '../index';
import {
  runners,
  runnerCommands,
  runnerCommandResults,
} from '../schema';
import type {
  NewRunnerCommand,
  NewRunnerCommandResult,
  RunnerCommandStatus,
} from '../schema';
import { eq, and, inArray, lt } from 'drizzle-orm';

// Runner queries
export async function getRunnerById(runnerId: string) {
  const [row] = await db.select().from(runners).where(eq(runners.id, runnerId));
  return row;
}

// ============================================
// Runner Commands (DB-backed command queue)
// ============================================

export async function createRunnerCommand(cmd: NewRunnerCommand) {
  await db.insert(runnerCommands).values(cmd);
  return cmd;
}

/**
 * Atomically claim pending commands for a runner.
 * Sets status='claimed' and claimedAt=now, returns the updated rows.
 * @param limit Max commands to claim (prevents bulk execution after crash-loop). Defaults to all.
 */
export async function claimPendingCommands(runnerId: string, limit?: number) {
  const now = new Date();
  const query = db
    .select()
    .from(runnerCommands)
    .where(and(eq(runnerCommands.runnerId, runnerId), eq(runnerCommands.status, 'pending')))
    .orderBy(runnerCommands.createdAt);

  const pending = limit ? await query.limit(limit) : await query;

  if (pending.length === 0) return [];

  const ids = pending.map(c => c.id);
  await db
    .update(runnerCommands)
    .set({ status: 'claimed', claimedAt: now })
    .where(inArray(runnerCommands.id, ids));

  return pending;
}

export async function getCommandsByTestRun(testRunId: string) {
  return db
    .select()
    .from(runnerCommands)
    .where(eq(runnerCommands.testRunId, testRunId))
    ;
}

export async function getRunnerCommandById(commandId: string) {
  return db.query.runnerCommands.findFirst({
    where: eq(runnerCommands.id, commandId),
  });
}

export async function completeRunnerCommand(commandId: string, status: 'completed' | 'failed') {
  await db
    .update(runnerCommands)
    .set({ status, completedAt: new Date() })
    .where(eq(runnerCommands.id, commandId));
}

export async function cancelPendingCommandsByTestRun(testRunId: string) {
  await db
    .update(runnerCommands)
    .set({ status: 'cancelled' as RunnerCommandStatus, completedAt: new Date() })
    .where(and(eq(runnerCommands.testRunId, testRunId), eq(runnerCommands.status, 'pending')));
}

export async function insertCommandResult(result: NewRunnerCommandResult) {
  const id = result.id || crypto.randomUUID();
  await db.insert(runnerCommandResults).values({ ...result, id });
  return { id };
}

export async function getUnacknowledgedResults(commandIds: string[]) {
  if (commandIds.length === 0) return [];
  return db
    .select()
    .from(runnerCommandResults)
    .where(and(inArray(runnerCommandResults.commandId, commandIds), eq(runnerCommandResults.acknowledged, false)))
    ;
}

export async function acknowledgeResults(resultIds: string[]) {
  if (resultIds.length === 0) return;
  await db
    .update(runnerCommandResults)
    .set({ acknowledged: true })
    .where(inArray(runnerCommandResults.id, resultIds));
}

export async function cleanupOldCommands(olderThanMs: number) {
  const cutoff = new Date(Date.now() - olderThanMs);
  // Delete results first (FK constraint)
  const oldCommandIds = (await db
    .select({ id: runnerCommands.id })
    .from(runnerCommands)
    .where(and(
      inArray(runnerCommands.status, ['completed', 'failed', 'cancelled', 'timeout']),
      lt(runnerCommands.createdAt, cutoff)
    ))).map(c => c.id);

  if (oldCommandIds.length > 0) {
    await db.delete(runnerCommandResults).where(inArray(runnerCommandResults.commandId, oldCommandIds));
    await db.delete(runnerCommands).where(inArray(runnerCommands.id, oldCommandIds));
  }
  return oldCommandIds.length;
}

/**
 * Mark unclaimed commands as timed out after maxAge ms.
 */
export async function timeoutStaleCommands(maxPendingAgeMs: number, maxClaimedAgeMs: number) {
  const now = Date.now();
  const pendingCutoff = new Date(now - maxPendingAgeMs);
  const claimedCutoff = new Date(now - maxClaimedAgeMs);

  // Timeout pending commands older than maxPendingAgeMs
  await db
    .update(runnerCommands)
    .set({ status: 'timeout' as RunnerCommandStatus, completedAt: new Date() })
    .where(and(eq(runnerCommands.status, 'pending'), lt(runnerCommands.createdAt, pendingCutoff)));

  // Timeout claimed commands older than maxClaimedAgeMs
  await db
    .update(runnerCommands)
    .set({ status: 'timeout' as RunnerCommandStatus, completedAt: new Date() })
    .where(and(eq(runnerCommands.status, 'claimed'), lt(runnerCommands.claimedAt, claimedCutoff)));
}
