/**
 * Live per-step execution state for headed playback.
 *
 * Runner-emitted `response:step_event` messages are recorded here keyed by
 * testRunId. The test detail page polls `getTestRunStepState(runId)` while a
 * headed run is in flight to drive the right-side step timeline.
 *
 * In-memory only — losing this on a pod restart is acceptable: the test
 * itself still completes (DB-persisted result), only the live indicator
 * goes blank for a few seconds.
 */

import type { StepEventPayload } from './protocol';

export type StepStatus = 'started' | 'passed' | 'failed';

export interface StepResult {
  status: 'passed' | 'failed';
  durationMs?: number;
  error?: string;
}

export interface LiveStepState {
  testRunId: string;
  totalSteps: number;
  currentStepIndex: number;          // -1 before first step:started
  currentStatus: StepStatus | null;  // status of currentStepIndex
  results: Record<number, StepResult>;
  lastEventAt: number;
}

const TTL_MS = 30 * 60 * 1000; // evict 30min after last update

const globalState = globalThis as typeof globalThis & {
  __liveStepState?: Map<string, LiveStepState>;
  __liveStepStateGCInit?: boolean;
};
if (!globalState.__liveStepState) {
  globalState.__liveStepState = new Map<string, LiveStepState>();
}
const store = globalState.__liveStepState;

if (!globalState.__liveStepStateGCInit) {
  globalState.__liveStepStateGCInit = true;
  setInterval(() => {
    const cutoff = Date.now() - TTL_MS;
    for (const [runId, state] of store) {
      if (state.lastEventAt < cutoff) store.delete(runId);
    }
  }, 60_000).unref?.();
}

export function recordStepEvent(payload: StepEventPayload): void {
  const { testRunId, stepIndex, totalSteps, status, durationMs, error } = payload;
  if (!testRunId) return;

  const existing = store.get(testRunId);
  const state: LiveStepState = existing ?? {
    testRunId,
    totalSteps,
    currentStepIndex: -1,
    currentStatus: null,
    results: {},
    lastEventAt: Date.now(),
  };

  // Keep totalSteps in sync — runner may send a refined value.
  if (totalSteps > state.totalSteps) state.totalSteps = totalSteps;

  if (status === 'started') {
    state.currentStepIndex = stepIndex;
    state.currentStatus = 'started';
  } else {
    // passed | failed — record the result and only roll the cursor forward
    // (out-of-order events shouldn't move the highlight back).
    state.results[stepIndex] = {
      status,
      durationMs,
      error,
    };
    if (stepIndex >= state.currentStepIndex) {
      state.currentStepIndex = stepIndex;
      state.currentStatus = status;
    }
  }

  state.lastEventAt = Date.now();
  store.set(testRunId, state);
}

export function getStepState(testRunId: string): LiveStepState | null {
  return store.get(testRunId) ?? null;
}

export function clearStepState(testRunId: string): void {
  store.delete(testRunId);
}
