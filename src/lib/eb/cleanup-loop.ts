/**
 * Periodic cleanup + reaper loop.
 *
 * Used to live inside `src/app/api/ws/runner/route.ts` as a lazy
 * `ensureInitialized()` started on the first runner POST. That broke on Olares
 * because EBs hit the envoy-less `lastest-internal-dev` companion pod, leaving
 * the user-facing pod's reaper interval dormant — idle EBs accumulated and
 * eventually starved app-pod CPU during deploys.
 *
 * Lives in a standalone module so `instrumentation.ts` can start it at boot
 * regardless of HTTP traffic. The route handler still imports the shared
 * `activeRunnerSessions` map and calls `startCleanupLoop()` defensively in
 * case instrumentation didn't run (e.g. local `next dev` without instrumentation).
 *
 * The loop is idempotent across pod replicas: `terminateEBJob` is 404-tolerant
 * and the DB deletes are tx-guarded, so user-facing + internal pods running
 * the loop in parallel is safe (first to delete wins, the other no-ops).
 */

import { updateRunnerStatus, markStaleRunnersOffline, deleteStaleSystemRunners } from '@/server/actions/runners';
import { reapStalePoolEBs, reapIdleEBJobs } from '@/server/actions/embedded-sessions';
import { ensureWarmPool, isKubernetesMode, ebIdleTTLMs } from '@/lib/eb/provisioner';
import { ensureGlobalPlaywrightSettings } from '@/lib/db/queries/settings';
import { cleanupOldCommands, timeoutStaleCommands } from '@/lib/db/queries';

export const SESSION_TIMEOUT_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60_000;

type SessionEntry = { lastPoll: number; sessionId: string; connectCount: number; firstConnectAt: number };

const globalState = globalThis as typeof globalThis & {
  __runnerActiveSessions?: Map<string, SessionEntry>;
  __cleanupLoopStarted?: boolean;
  __cleanupLoopHandle?: ReturnType<typeof setInterval>;
};

if (!globalState.__runnerActiveSessions) {
  globalState.__runnerActiveSessions = new Map<string, SessionEntry>();
}

export const activeRunnerSessions = globalState.__runnerActiveSessions;

/**
 * Start the periodic cleanup + reaper loop. Idempotent — repeated calls no-op.
 *
 * Schedules `markStaleRunnersOffline`, `cleanupOldCommands`, `timeoutStaleCommands`,
 * `reapStalePoolEBs`, `reapIdleEBJobs`, and `ensureWarmPool` every 60s.
 */
export function startCleanupLoop(): void {
  if (globalState.__cleanupLoopStarted) return;
  globalState.__cleanupLoopStarted = true;

  // One-shot startup tasks
  markStaleRunnersOffline(SESSION_TIMEOUT_MS).then((count) => {
    if (count > 0) {
      console.log(`[Startup] Marked ${count} stale runner(s) as offline`);
    }
  }).catch((error) => {
    console.error('[Startup] Failed to mark stale runners offline:', error);
  });

  ensureGlobalPlaywrightSettings()
    .then(() => {
      if (isKubernetesMode()) {
        return ensureWarmPool();
      }
    })
    .catch((error) => {
      console.error('[Startup] ensureGlobalPlaywrightSettings / warm pool init failed:', error);
    });

  globalState.__cleanupLoopHandle = setInterval(async () => {
    const now = Date.now();
    for (const [runnerId, session] of activeRunnerSessions) {
      if (now - session.lastPoll > SESSION_TIMEOUT_MS) {
        activeRunnerSessions.delete(runnerId);
        try {
          await updateRunnerStatus(runnerId, 'offline');
          console.log(`[Cleanup] Runner ${runnerId} marked offline (no heartbeat for ${SESSION_TIMEOUT_MS}ms)`);
        } catch (error) {
          console.error(`[Cleanup] Failed to mark runner ${runnerId} offline:`, error);
        }
      }
    }

    try {
      await markStaleRunnersOffline(SESSION_TIMEOUT_MS);
    } catch (error) {
      console.error('[Cleanup] Failed to mark stale runners offline:', error);
    }

    try {
      const deleted = await deleteStaleSystemRunners(5 * 60 * 1000);
      if (deleted > 0) {
        console.log(`[GC] Deleted ${deleted} stale system runners`);
      }
    } catch (error) {
      console.error('[GC] Failed to delete stale system runners:', error);
    }

    try {
      const cleaned = await cleanupOldCommands(24 * 60 * 60 * 1000);
      if (cleaned > 0) {
        console.log(`[GC] Cleaned up ${cleaned} old runner commands`);
      }
    } catch (error) {
      console.error('[GC] Failed to clean old commands:', error);
    }

    try {
      await timeoutStaleCommands(30 * 60 * 1000, 10 * 60 * 1000);
    } catch (error) {
      console.error('[GC] Failed to timeout stale commands:', error);
    }

    try {
      const heartbeatTimeoutMs = parseInt(process.env.EB_HEARTBEAT_TIMEOUT_MS || '300000', 10);
      const reaped = await reapStalePoolEBs(heartbeatTimeoutMs);
      if (reaped > 0) {
        console.log(`[Reaper] Released ${reaped} stale pool EB(s)`);
      }
    } catch (error) {
      console.error('[Reaper] Failed to reap stale pool EBs:', error);
    }

    try {
      const idleTtlMs = await ebIdleTTLMs();
      await reapIdleEBJobs(idleTtlMs);
    } catch (error) {
      console.error('[Reaper] Failed to reap idle EB Jobs:', error);
    }

    try {
      await ensureWarmPool();
    } catch (error) {
      console.error('[WarmPool] ensureWarmPool failed:', error);
    }
  }, CLEANUP_INTERVAL_MS);

  console.log(`[CleanupLoop] Started (interval=${CLEANUP_INTERVAL_MS}ms)`);
}
