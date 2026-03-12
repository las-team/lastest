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
};
if (!globalCommandWaiters.__runnerCommandWaiters) {
  globalCommandWaiters.__runnerCommandWaiters = new Map<string, CommandWaiter>();
}
const commandWaiters = globalCommandWaiters.__runnerCommandWaiters;

/**
 * Wait until a command is queued for this runner, or until timeout.
 * Returns `true` if notified, `false` on timeout.
 * Supports an optional AbortSignal for request cancellation.
 */
export function waitForCommandQueued(
  runnerId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      commandWaiters.delete(runnerId);
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => settle(false), timeoutMs);

    // AbortSignal listener (request disconnected)
    signal?.addEventListener('abort', () => settle(false), { once: true });

    commandWaiters.set(runnerId, () => settle(true));
  });
}

/**
 * Wake any pending long-poll waiter for this runner.
 */
export function notifyCommandQueued(runnerId: string): void {
  const waiter = commandWaiters.get(runnerId);
  if (waiter) {
    waiter();
  }
}
