/**
 * Test Execution Event Emitter
 *
 * Simple pub/sub mechanism for broadcasting test execution updates
 * to SSE connections. Uses global state to persist across module reloads.
 */

export interface TestStartEvent {
  type: 'test:start';
  testId: string;
  runId: string;
  buildId: string;
  teamId: string;
  timestamp: number;
}

export interface TestProgressEvent {
  type: 'test:progress';
  testId: string;
  runId: string;
  buildId: string;
  teamId: string;
  step: string;
  progress: number;
  timestamp: number;
}

export interface TestCompleteEvent {
  type: 'test:complete';
  testId: string;
  runId: string;
  buildId: string;
  teamId: string;
  status: 'passed' | 'failed' | 'error';
  errorMessage?: string;
  duration: number;
  timestamp: number;
}

export interface BuildCompleteEvent {
  type: 'build:complete';
  buildId: string;
  teamId: string;
  status: 'safe_to_merge' | 'review_required' | 'blocked';
  passedCount: number;
  failedCount: number;
  totalTests: number;
  timestamp: number;
}

export type TestEvent = TestStartEvent | TestProgressEvent | TestCompleteEvent | BuildCompleteEvent;

type TestEventListener = (event: TestEvent) => void;

// Use globalThis to ensure single instance across Next.js module reloads
const globalEvents = globalThis as typeof globalThis & {
  __testEventListeners?: Map<string, TestEventListener>;
  __testEventListenerCounter?: number;
};

if (!globalEvents.__testEventListeners) {
  globalEvents.__testEventListeners = new Map<string, TestEventListener>();
}
if (globalEvents.__testEventListenerCounter === undefined) {
  globalEvents.__testEventListenerCounter = 0;
}

const listeners = globalEvents.__testEventListeners;

/**
 * Subscribe to test execution events
 * Returns an unsubscribe function
 */
export function subscribeToTestEvents(listener: TestEventListener): () => void {
  const id = String(++globalEvents.__testEventListenerCounter!);
  listeners.set(id, listener);

  return () => {
    listeners.delete(id);
  };
}

/**
 * Emit a test event to all subscribers
 */
export function emitTestEvent(event: TestEvent): void {
  for (const listener of listeners.values()) {
    try {
      listener(event);
    } catch (error) {
      console.error('[TestEvents] Listener error:', error);
    }
  }
}

/**
 * Get current subscriber count (for debugging)
 */
export function getTestEventSubscriberCount(): number {
  return listeners.size;
}
