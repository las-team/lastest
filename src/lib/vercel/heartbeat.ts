/**
 * Vercel check staleness heartbeat.
 *
 * Vercel marks a check stale if it gets no status update for ~5 minutes while
 * `running`. Lastest suites can exceed that, so while a build runs we re-PATCH
 * `status: running` on a 2-minute cadence, and enforce a per-config timeout that
 * concludes the check `neutral` if the build never reports back (crash / hang).
 *
 * This is an in-process timer manager — consistent with the app's other
 * in-memory lifecycle state (EB pool, webhook replay guard). Best-effort across
 * replicas; a missed heartbeat just risks a single stale check, never a wrong
 * conclusion.
 */
import { updateCheck } from "./checks";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

interface HeartbeatHandle {
  interval: ReturnType<typeof setInterval>;
  timeout: ReturnType<typeof setTimeout>;
}

// Keyed on the vercel_checks row id.
const heartbeats = new Map<string, HeartbeatHandle>();

interface StartHeartbeatArgs {
  checkRowId: string;
  accessToken: string;
  deploymentId: string;
  vercelCheckId: string;
  teamId: string | null;
  timeoutMinutes: number;
  // Called when the timeout fires so the caller can flip the DB row + stop.
  onTimeout: () => Promise<void> | void;
}

export function startHeartbeat(args: StartHeartbeatArgs): void {
  stopHeartbeat(args.checkRowId); // never double-run

  const interval = setInterval(() => {
    updateCheck(
      args.accessToken,
      args.deploymentId,
      args.vercelCheckId,
      args.teamId,
      { status: "running" },
    ).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

  const timeout = setTimeout(
    () => {
      stopHeartbeat(args.checkRowId);
      // Best-effort: conclude neutral so a hung build doesn't leave a blocking
      // check pinned forever.
      updateCheck(
        args.accessToken,
        args.deploymentId,
        args.vercelCheckId,
        args.teamId,
        {
          status: "completed",
          conclusion: "neutral",
          output: {
            summary: `Lastest run exceeded ${args.timeoutMinutes}m and timed out.`,
          },
        },
      ).catch(() => {});
      Promise.resolve(args.onTimeout()).catch(() => {});
    },
    Math.max(1, args.timeoutMinutes) * 60 * 1000,
  );

  // Don't keep the event loop alive purely for these timers.
  interval.unref?.();
  timeout.unref?.();

  heartbeats.set(args.checkRowId, { interval, timeout });
}

export function stopHeartbeat(checkRowId: string): void {
  const handle = heartbeats.get(checkRowId);
  if (!handle) return;
  clearInterval(handle.interval);
  clearTimeout(handle.timeout);
  heartbeats.delete(checkRowId);
}
