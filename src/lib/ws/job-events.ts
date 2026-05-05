/**
 * Background Job Event Emitter
 *
 * Pub/sub mechanism for broadcasting job status updates
 * to SSE connections. Uses globalThis to persist across module reloads.
 */

import type { BackgroundJobStatus, BackgroundJobType } from '@/lib/db/schema';

export interface JobUpdateEvent {
  type: 'job:update';
  jobId: string;
  jobType: BackgroundJobType;
  status: BackgroundJobStatus;
  progress: number;
  completedSteps: number;
  totalSteps: number | null;
  label: string;
  error: string | null;
  metadata: Record<string, unknown> | null;
  parentJobId: string | null;
  repositoryId: string | null;
  targetRunnerId: string | null;
  createdAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastActivityAt: Date | null;
}

export interface JobDeleteEvent {
  type: 'job:delete';
  jobId: string;
  // Used by the SSE route to scope deletes to the owning team. May be null
  // for repo-less jobs, which the SSE route already filters out.
  repositoryId: string | null;
}

export type JobEvent = JobUpdateEvent | JobDeleteEvent;

type JobEventListener = (event: JobEvent) => void;

const globalEvents = globalThis as typeof globalThis & {
  __jobEventListeners?: Map<string, JobEventListener>;
  __jobEventCounter?: number;
};

if (!globalEvents.__jobEventListeners) {
  globalEvents.__jobEventListeners = new Map<string, JobEventListener>();
}
if (globalEvents.__jobEventCounter === undefined) {
  globalEvents.__jobEventCounter = 0;
}

const listeners = globalEvents.__jobEventListeners;

export function subscribeToJobEvents(listener: JobEventListener): () => void {
  const id = String(++globalEvents.__jobEventCounter!);
  listeners.set(id, listener);
  return () => {
    listeners.delete(id);
  };
}

export function emitJobEvent(event: JobEvent): void {
  for (const listener of listeners.values()) {
    try {
      listener(event);
    } catch (error) {
      console.error('[JobEvents] Listener error:', error);
    }
  }
}

export function getJobEventSubscriberCount(): number {
  return listeners.size;
}
