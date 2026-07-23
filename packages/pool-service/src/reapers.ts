/**
 * Pool-service reapers + periodic loop.
 *
 * `reapStalePoolEBs` and `reapIdleEBJobs` moved here verbatim from
 * `src/server/actions/embedded-sessions.ts` — they are pool-lifecycle
 * decisions (DB row GC + Job termination) with no app-domain hooks (no UI
 * events, no queue processing), so they belong to the singleton pool process.
 *
 * The app keeps its own 60s loop (`src/lib/eb/cleanup-loop.ts`) for
 * command-channel GC and runner-session liveness; this loop owns everything
 * that decides when EB capacity is created or destroyed.
 *
 * Known seam (until registration moves here in a later step): the app also
 * writes `runners` / `embedded_sessions` rows (auto-register, claim/release).
 * All deletes here are tx-guarded and `terminateEBJob` is 404-tolerant, so
 * the two writers are safe to overlap — first to delete wins.
 */

import { db } from "@lastest/db";
import {
  embeddedSessions,
  runners,
  runnerCommands,
  runnerCommandResults,
} from "@lastest/db/schema";
import { and, eq } from "drizzle-orm";
import { isDynamicPoolMode, jobNameForRunnerName } from "./common";
import {
  ensureWarmPool,
  ebIdleTTLMs,
  livePoolCount,
  terminateEBJob,
  warmPoolMin,
} from "./provisioner";

const LOOP_INTERVAL_MS = 60_000;

/**
 * Reaper: release EBs whose runner has stopped heartbeating.
 * Heartbeat is the authoritative liveness signal — a healthy long-running test
 * keeps the runner heartbeating, so this won't kill legitimate work. Per-test
 * timeouts are enforced separately by the executor.
 */
export async function reapStalePoolEBs(
  heartbeatTimeoutMs = 90_000,
): Promise<number> {
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
    .where(
      and(eq(runners.isSystem, true), eq(embeddedSessions.status, "busy")),
    );

  let reaped = 0;
  for (const row of stale) {
    if (!row.lastSeen || row.lastSeen < heartbeatCutoff) {
      await db
        .update(runners)
        .set({ status: "offline" })
        .where(eq(runners.id, row.runnerId));
      await db
        .update(embeddedSessions)
        .set({ status: "stopped", busySince: null, userId: null })
        .where(eq(embeddedSessions.id, row.sessionId));
      reaped++;
      console.warn(
        `[Reaper] Force-released stale EB ${row.runnerId.slice(0, 8)} (lastSeen ${row.lastSeen?.toISOString() ?? "never"}, busy since ${row.busySince?.toISOString() ?? "unknown"})`,
      );
    }
  }
  return reaped;
}

/**
 * Reaper: terminate Jobs for system EB runners that are offline or have
 * been idle (online & unclaimed) for longer than the idle TTL. Keeps the
 * configured warm-pool minimum alive.
 */
export async function reapIdleEBJobs(idleTtlMs: number): Promise<number> {
  if (!isDynamicPoolMode()) return 0;

  // livePoolCount counts live Jobs/children — including just-launched EBs
  // that haven't registered yet, which is the protective direction for the
  // warm-pool bound below. Offline reaping is always safe (we aren't burning
  // capacity by tearing them down); idle-online reaping is bounded by
  // warmPoolMin so we preserve the warm pool. A k8s-list failure throws out
  // to the loop's catch — don't reap on an unknown ledger; retried in 60s.
  const activeSize = await livePoolCount();
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
    .where(and(eq(runners.isSystem, true), eq(runners.type, "embedded")));

  let terminated = 0;
  let onlineReaped = 0;
  for (const row of candidates) {
    const isOffline = row.status === "offline";
    const isIdle =
      row.status === "online" &&
      (!row.lastActivityAt || row.lastActivityAt < cutoff);
    if (!isOffline && !isIdle) continue;

    // Protect warm pool: only reap an idle-online row if doing so would still
    // leave at least minKeep non-offline rows alive. Offline rows are unconditional.
    if (isIdle && activeSize - onlineReaped <= minKeep) continue;

    const jobName = jobNameForRunnerName(row.name);
    if (!jobName) continue; // docker-compose EB — don't touch

    try {
      // FK-order-respecting cleanup: children before parent.
      await db.transaction(async (tx) => {
        await tx
          .delete(embeddedSessions)
          .where(eq(embeddedSessions.runnerId, row.id));
        await tx
          .delete(runnerCommandResults)
          .where(eq(runnerCommandResults.runnerId, row.id));
        await tx
          .delete(runnerCommands)
          .where(eq(runnerCommands.runnerId, row.id));
        await tx.delete(runners).where(eq(runners.id, row.id));
      });
      // No stopDevPortForward here (unlike the app-side teardown): dev
      // `kubectl port-forward` children live in the APP process and exit on
      // their own when the target pod dies.
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

let loopHandle: ReturnType<typeof setInterval> | null = null;

/** Start the 60s pool-maintenance loop. Idempotent. */
export function startPoolLoop(): void {
  if (loopHandle) return;

  loopHandle = setInterval(async () => {
    try {
      const heartbeatTimeoutMs = parseInt(
        process.env.EB_HEARTBEAT_TIMEOUT_MS || "300000",
        10,
      );
      const reaped = await reapStalePoolEBs(heartbeatTimeoutMs);
      if (reaped > 0) {
        console.log(`[Reaper] Released ${reaped} stale pool EB(s)`);
      }
    } catch (error) {
      console.error("[Reaper] Failed to reap stale pool EBs:", error);
    }

    try {
      const idleTtlMs = await ebIdleTTLMs();
      await reapIdleEBJobs(idleTtlMs);
    } catch (error) {
      console.error("[Reaper] Failed to reap idle EB Jobs:", error);
    }

    try {
      await ensureWarmPool();
    } catch (error) {
      console.error("[WarmPool] ensureWarmPool failed:", error);
    }
  }, LOOP_INTERVAL_MS);

  console.log(`[PoolLoop] Started (interval=${LOOP_INTERVAL_MS}ms)`);
}

export function stopPoolLoop(): void {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}
