import { db } from "../index";
import {
  runners,
  runnerCommands,
  runnerCommandResults,
  tests,
} from "../schema";
import type {
  NewRunnerCommand,
  NewRunnerCommandResult,
  RunnerCommandStatus,
} from "../schema";
import { eq, and, inArray, lt, or, isNull, notExists, sql } from "drizzle-orm";

// Time the server waits for an EB `response:command_ack` after dispatching a
// command before redelivering on the next heartbeat. EB sends the ack as the
// first thing in its `onCommand` handler, so this only needs to cover normal
// network latency. Bigger if EBs ack slowly, smaller for faster retry.
const REDISPATCH_TTL_MS = 10_000;

// Once the row is at status='claimed' (EB ack'd), how long we wait for the
// first `runner_command_results` row before declaring the EB stuck and
// returning the command to `pending` for redelivery. Long enough that a slow
// Chromium init doesn't get yanked, short enough to recover before the 240s
// executor test timeout.
const MAX_CLAIMED_NO_RESULT_MS = 90_000;

// Command types that terminate by inserting a `runner_command_results` row.
// Everything else (start/stop recording & debug, debug_action, assertions,
// cancel, ping, shutdown, …) is a session-control command: receipt IS
// completion. Those used to sit at status='claimed' forever, which (a) made
// the claimed-no-result reaper bounce them back to 'pending' every ~90s —
// redispatching start_recording/start_debug into a LIVE session and resetting
// it (the "recording/debug randomly restarts" flakiness) — and (b) forced
// teardownPoolEB to burn its full shutdown grace waiting for rows that could
// never reach a terminal state.
const RESULT_BEARING_COMMAND_TYPES = ["command:run_test", "command:run_setup"];

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
 * Dispatch pending commands to a runner: mark them as in-flight delivery
 * by stamping `dispatchedAt = now`, but do NOT yet flip status. The runner
 * confirms receipt by POSTing `response:command_ack`, which calls
 * `ackDispatchedCommand` to flip the row to status='claimed'.
 *
 * If no ack arrives within REDISPATCH_TTL_MS, the next heartbeat redispatches
 * the same row (its `dispatchedAt` has aged out). EB-side `activeTestIds`
 * dedup makes double-delivery safe.
 *
 * @param limit Max commands to dispatch (prevents bulk execution after crash-loop). Defaults to all.
 */
export async function dispatchPendingCommands(
  runnerId: string,
  limit?: number,
) {
  const now = new Date();
  const redispatchCutoff = new Date(now.getTime() - REDISPATCH_TTL_MS);

  const query = db
    .select()
    .from(runnerCommands)
    .where(
      and(
        eq(runnerCommands.runnerId, runnerId),
        eq(runnerCommands.status, "pending"),
        or(
          isNull(runnerCommands.dispatchedAt),
          lt(runnerCommands.dispatchedAt, redispatchCutoff),
        ),
      ),
    )
    .orderBy(runnerCommands.createdAt);

  const eligible = limit ? await query.limit(limit) : await query;

  if (eligible.length === 0) return [];

  const ids = eligible.map((c) => c.id);
  await db
    .update(runnerCommands)
    .set({ dispatchedAt: now })
    .where(inArray(runnerCommands.id, ids));

  return eligible;
}

/**
 * Mark a dispatched command as actually received by the runner. Called from
 * the `response:command_ack` handler in /api/ws/runner. Idempotent — only
 * flips rows still at status='pending' so a duplicate ack (from redispatch +
 * EB dedup-retry) is a no-op.
 *
 * Result-bearing commands (run_test / run_setup) move to 'claimed' and wait
 * for their result row. Session-control commands are complete the moment the
 * runner receives them — flip straight to 'completed' so they can't be
 * reaped/redispatched into a live session.
 */
export async function ackDispatchedCommand(commandId: string) {
  const [cmd] = await db
    .select({ type: runnerCommands.type })
    .from(runnerCommands)
    .where(eq(runnerCommands.id, commandId));
  if (!cmd) return;

  const now = new Date();
  const resultBearing = RESULT_BEARING_COMMAND_TYPES.includes(cmd.type);
  await db
    .update(runnerCommands)
    .set(
      resultBearing
        ? { status: "claimed" as RunnerCommandStatus, claimedAt: now }
        : {
            status: "completed" as RunnerCommandStatus,
            claimedAt: now,
            completedAt: now,
          },
    )
    .where(
      and(
        eq(runnerCommands.id, commandId),
        eq(runnerCommands.status, "pending"),
      ),
    );
}

export async function getCommandsByTestRun(testRunId: string) {
  return db
    .select()
    .from(runnerCommands)
    .where(eq(runnerCommands.testRunId, testRunId));
}

/**
 * Names of tests whose run_test commands have been claimed by a runner but not
 * yet completed. Used by the build UI to show actual test names in the
 * "now running" indicator before the first screenshot/diff arrives.
 */
export async function getRunningTestNamesForTestRun(
  testRunId: string,
): Promise<{ testId: string; name: string }[]> {
  const rows = await db
    .select({ testId: tests.id, name: tests.name })
    .from(runnerCommands)
    .innerJoin(tests, eq(tests.id, runnerCommands.testId))
    .where(
      and(
        eq(runnerCommands.testRunId, testRunId),
        eq(runnerCommands.status, "claimed" as RunnerCommandStatus),
        eq(runnerCommands.type, "command:run_test"),
      ),
    )
    .orderBy(runnerCommands.claimedAt);
  return rows;
}

export async function getRunnerCommandById(commandId: string) {
  return db.query.runnerCommands.findFirst({
    where: eq(runnerCommands.id, commandId),
  });
}

export async function completeRunnerCommand(
  commandId: string,
  status: "completed" | "failed",
) {
  await db
    .update(runnerCommands)
    .set({ status, completedAt: new Date() })
    .where(eq(runnerCommands.id, commandId));
}

export async function failActiveCommandsForRunner(runnerId: string) {
  await db
    .update(runnerCommands)
    .set({ status: "failed" as RunnerCommandStatus, completedAt: new Date() })
    .where(
      and(
        eq(runnerCommands.runnerId, runnerId),
        inArray(runnerCommands.status, [
          "pending",
          "claimed",
        ] as RunnerCommandStatus[]),
      ),
    );
}

export async function cancelPendingCommandsByTestRun(testRunId: string) {
  await db
    .update(runnerCommands)
    .set({
      status: "cancelled" as RunnerCommandStatus,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(runnerCommands.testRunId, testRunId),
        eq(runnerCommands.status, "pending"),
      ),
    );
}

export async function insertCommandResult(result: NewRunnerCommandResult) {
  const id = result.id || crypto.randomUUID();
  await db.insert(runnerCommandResults).values({ ...result, id });
  return { id };
}

/**
 * Persist a single "EB is making progress" beacon row per command. Step
 * events flow over WebSocket → in-memory `recordStepEvent`, which is invisible
 * to the executor's stalled-probe and the orphan-reclaim sweep (both query
 * `runner_command_results` directly). Without a DB signal, a test that has
 * cleanly executed N of M steps still looks like "EB picked up command but
 * never POSTed anything" → wrongly tagged [EB-stalled] + retried on a fresh
 * EB + the orphan sweep redispatches the same command.
 *
 * One row per command with a deterministic id `${commandId}:step-beacon` and
 * type='response:step_event' (acknowledged=true so it stays out of the main
 * result-processing pipe). On conflict the payload is updated in place, so
 * the row always carries the latest `{ stepIndex, totalSteps, status }` for
 * triage-time forensics.
 */
export async function upsertStepEventBeacon(
  commandId: string,
  runnerId: string,
  payload: {
    testRunId?: string;
    stepIndex: number;
    totalSteps: number;
    status: string;
  },
): Promise<void> {
  const id = `${commandId}:step-beacon`;
  await db
    .insert(runnerCommandResults)
    .values({
      id,
      commandId,
      runnerId,
      type: "response:step_event",
      acknowledged: true,
      payload: payload as unknown as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: runnerCommandResults.id,
      set: {
        payload: payload as unknown as Record<string, unknown>,
      },
    });
}

export async function getUnacknowledgedResults(commandIds: string[]) {
  if (commandIds.length === 0) return [];
  return db
    .select()
    .from(runnerCommandResults)
    .where(
      and(
        inArray(runnerCommandResults.commandId, commandIds),
        eq(runnerCommandResults.acknowledged, false),
      ),
    );
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
  const oldCommandIds = (
    await db
      .select({ id: runnerCommands.id })
      .from(runnerCommands)
      .where(
        and(
          inArray(runnerCommands.status, [
            "completed",
            "failed",
            "cancelled",
            "timeout",
          ]),
          lt(runnerCommands.createdAt, cutoff),
        ),
      )
  ).map((c) => c.id);

  if (oldCommandIds.length > 0) {
    await db
      .delete(runnerCommandResults)
      .where(inArray(runnerCommandResults.commandId, oldCommandIds));
    await db
      .delete(runnerCommands)
      .where(inArray(runnerCommands.id, oldCommandIds));
  }
  return oldCommandIds.length;
}

/**
 * Periodic sweep for stuck commands. Two passes:
 *   1. Timeout pending rows older than `maxPendingAgeMs` (never picked up by
 *      any runner — likely no runner online).
 *   2. Reclaim *orphaned* claimed rows: status='claimed' AND no rows in
 *      runner_command_results AND claimed_at older than
 *      MAX_CLAIMED_NO_RESULT_MS → reset to status='pending', clear
 *      claimed_at + dispatched_at so the next heartbeat redispatches. EB
 *      dedup makes the redispatch safe even if the original EB is still
 *      working.
 *   3. After that, anything still at claimed older than `maxClaimedAgeMs`
 *      (i.e. EB acked but never produced terminal status AND has produced
 *      *some* results) is genuinely stuck inside test code — flag as
 *      timeout the same as before.
 */
export async function timeoutStaleCommands(
  maxPendingAgeMs: number,
  maxClaimedAgeMs: number,
) {
  const now = Date.now();
  const pendingCutoff = new Date(now - maxPendingAgeMs);
  const claimedCutoff = new Date(now - maxClaimedAgeMs);
  const noResultCutoff = new Date(now - MAX_CLAIMED_NO_RESULT_MS);

  // 1. Timeout pending commands older than maxPendingAgeMs
  await db
    .update(runnerCommands)
    .set({ status: "timeout" as RunnerCommandStatus, completedAt: new Date() })
    .where(
      and(
        eq(runnerCommands.status, "pending"),
        lt(runnerCommands.createdAt, pendingCutoff),
      ),
    );

  // 2. Reclaim orphaned `claimed` rows — EB ack'd but never produced any
  //    runner_command_results within MAX_CLAIMED_NO_RESULT_MS. Most often a
  //    Chromium/CDP init hang inside the EB pod. Reset to pending so the next
  //    heartbeat redelivers; EB dedup prevents the original pod from running
  //    it twice if it's just slow.
  //
  //    Only result-bearing types qualify — session-control commands
  //    (start_recording, start_debug, …) never produce result rows, so
  //    reclaiming them here redispatches them into live sessions. They now
  //    complete on ack, but the type filter also protects rows acked by older
  //    runner builds.
  await db
    .update(runnerCommands)
    .set({
      status: "pending" as RunnerCommandStatus,
      claimedAt: null,
      dispatchedAt: null,
    })
    .where(
      and(
        eq(runnerCommands.status, "claimed"),
        inArray(runnerCommands.type, RESULT_BEARING_COMMAND_TYPES),
        lt(runnerCommands.claimedAt, noResultCutoff),
        notExists(
          db
            .select({ x: sql`1` })
            .from(runnerCommandResults)
            .where(eq(runnerCommandResults.commandId, runnerCommands.id)),
        ),
      ),
    );

  // 3. Timeout claimed commands older than maxClaimedAgeMs (i.e. EB acked,
  //    produced partial results, but never reached terminal status — stuck
  //    inside test code, retry won't help).
  await db
    .update(runnerCommands)
    .set({ status: "timeout" as RunnerCommandStatus, completedAt: new Date() })
    .where(
      and(
        eq(runnerCommands.status, "claimed"),
        lt(runnerCommands.claimedAt, claimedCutoff),
      ),
    );
}
