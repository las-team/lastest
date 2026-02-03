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
