/**
 * Runner Status Event Emitter
 *
 * Simple pub/sub mechanism for broadcasting runner status changes
 * to SSE connections. Uses global state to persist across module reloads.
 */

export interface RunnerStatusEvent {
  runnerId: string;
  teamId: string;
  status: 'online' | 'offline' | 'busy';
  previousStatus?: 'online' | 'offline' | 'busy';
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
      console.error('[RunnerEvents] Listener error:', error);
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
  __runnerCommandListenInit?: Promise<void> | null;
};
if (!globalCommandWaiters.__runnerCommandWaiters) {
  globalCommandWaiters.__runnerCommandWaiters = new Map<string, CommandWaiter>();
}
const commandWaiters = globalCommandWaiters.__runnerCommandWaiters;

const COMMAND_CHANNEL = 'runner_cmd_queued';

function wakeLocalWaiter(runnerId: string): void {
  const waiter = commandWaiters.get(runnerId);
  if (waiter) waiter();
}

/**
 * Subscribe this pod to cross-pod NOTIFY events. Idempotent — only runs once.
 * Wakes local waiters when any pod (including this one) signals a command.
 */
function ensureListening(): Promise<void> {
  if (globalCommandWaiters.__runnerCommandListenInit) {
    return globalCommandWaiters.__runnerCommandListenInit;
  }
  globalCommandWaiters.__runnerCommandListenInit = (async () => {
    try {
      const { sql } = await import('@/lib/db');
      await sql.listen(COMMAND_CHANNEL, (payload: string) => {
        if (payload) wakeLocalWaiter(payload);
      });
      console.log('[RunnerEvents] Listening for command-queued notifications');
    } catch (error) {
      console.error('[RunnerEvents] Failed to subscribe to command NOTIFY channel:', error);
      // Reset so a later call can retry
      globalCommandWaiters.__runnerCommandListenInit = null;
      throw error;
    }
  })();
  return globalCommandWaiters.__runnerCommandListenInit;
}

/**
 * Wait until a command is queued for this runner, or until timeout.
 * Returns `true` if notified, `false` on timeout.
 */
export function waitForCommandQueued(
  runnerId: string,
  timeoutMs: number,
): Promise<boolean> {
  // Best-effort listener init — if it fails, the local Map still works for same-pod
  ensureListening().catch(() => {});

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
 * Wake any pending long-poll waiter for this runner across all pods.
 * Locally wakes the waiter immediately (no DB roundtrip) and broadcasts via
 * Postgres NOTIFY so waiters on other pods also wake.
 */
export function notifyCommandQueued(runnerId: string): void {
  wakeLocalWaiter(runnerId);
  void (async () => {
    try {
      const { sql } = await import('@/lib/db');
      await sql.notify(COMMAND_CHANNEL, runnerId);
    } catch (error) {
      console.error('[RunnerEvents] Failed to broadcast command NOTIFY:', error);
    }
  })();
}
