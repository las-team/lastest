/**
 * Runner Status Event Emitter
 *
 * Simple pub/sub mechanism for broadcasting runner status changes
 * to SSE connections. Uses global state to persist across module reloads.
 */

export interface RunnerStatusEvent {
  runnerId: string;
  teamId: string;
  status: "online" | "offline" | "busy";
  previousStatus?: "online" | "offline" | "busy";
  timestamp: number;
}

type StatusListener = (event: RunnerStatusEvent) => void;

// Use globalThis to ensure single instance across Next.js module reloads
const globalEvents = globalThis as typeof globalThis & {
  __runnerStatusListeners?: Map<string, StatusListener>;
  __runnerStatusListenerCounter?: number;
};

if (!globalEvents.__runnerStatusListeners) {
  globalEvents.__runnerStatusListeners = new Map<string, StatusListener>();
}
if (globalEvents.__runnerStatusListenerCounter === undefined) {
  globalEvents.__runnerStatusListenerCounter = 0;
}

const listeners = globalEvents.__runnerStatusListeners;

/**
 * Subscribe to runner status changes
 * Returns an unsubscribe function
 */
export function subscribeToRunnerStatus(listener: StatusListener): () => void {
  const id = String(++globalEvents.__runnerStatusListenerCounter!);
  listeners.set(id, listener);

  return () => {
    listeners.delete(id);
  };
}

/**
 * Emit a runner status change event to all subscribers
 */
export function emitRunnerStatusChange(event: RunnerStatusEvent): void {
  for (const listener of listeners.values()) {
    try {
      listener(event);
    } catch (error) {
      console.error("[RunnerEvents] Listener error:", error);
    }
  }
}

/**
 * Get current subscriber count (for debugging)
 */
export function getSubscriberCount(): number {
  return listeners.size;
}

// ============================================
// Command-queued long-poll primitives
// ============================================

type CommandWaiter = () => void;

const globalCommandWaiters = globalThis as typeof globalThis & {
  __runnerCommandWaiters?: Map<string, CommandWaiter>;
};
if (!globalCommandWaiters.__runnerCommandWaiters) {
  globalCommandWaiters.__runnerCommandWaiters = new Map<
    string,
    CommandWaiter
  >();
}
const commandWaiters = globalCommandWaiters.__runnerCommandWaiters;

function wakeLocalWaiter(runnerId: string): void {
  const waiter = commandWaiters.get(runnerId);
  if (waiter) waiter();
}

/**
 * Sleep until a command is queued for this runner *on this pod*, or until
 * `timeoutMs` elapses. Returns `true` if woken locally, `false` on timeout.
 *
 * This is one tick of a poll loop, not a delivery guarantee. Cross-pod wakeup
 * used to ride on Postgres LISTEN/NOTIFY, which cannot survive a
 * transaction-mode connection pooler: LISTEN is session state, and the pooler
 * returns the server connection to its pool the moment the statement finishes,
 * so notifications stop arriving *silently*. With the app Deployment scaled out
 * behind an HPA the pod that queues a command is usually not the pod holding
 * that runner's long-poll anyway.
 *
 * So the contract is inverted: the local wake is a latency optimization for the
 * same-pod case, and the caller's re-query after each tick is what actually
 * delivers commands. See the heartbeat handler in `/api/ws/runner`.
 */
export function waitForCommandQueued(
  runnerId: string,
  timeoutMs: number,
): Promise<boolean> {
  // Abort any existing waiter for this runner before registering a new one
  const existingWaiter = commandWaiters.get(runnerId);
  if (existingWaiter) {
    existingWaiter(); // resolve previous waiter as notified
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      commandWaiters.delete(runnerId);
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => settle(false), timeoutMs);

    commandWaiters.set(runnerId, () => settle(true));
  });
}

/**
 * Wake a pending long-poll waiter for this runner if one happens to live on
 * this pod. Best-effort fast path only, and deliberately synchronous — there is
 * no cross-pod broadcast. A waiter on another pod picks the command up on its
 * next poll tick (bounded by `COMMAND_POLL_INTERVAL_MS` in `/api/ws/runner`).
 */
export function notifyCommandQueued(runnerId: string): void {
  wakeLocalWaiter(runnerId);
}
