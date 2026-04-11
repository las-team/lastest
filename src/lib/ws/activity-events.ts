/**
 * Activity Feed Event Emitter
 *
 * Pub/sub mechanism for broadcasting agent & MCP activity events
 * to SSE connections. Uses globalThis to persist across module reloads.
 */

import type { ActivityEventType, ActivitySourceType, ActivityArtifactType, PwAgentType } from '@/lib/db/schema';

export interface ActivityFeedEvent {
  id: string;
  teamId: string;
  repositoryId?: string | null;
  sessionId?: string | null;
  sourceType: ActivitySourceType;
  eventType: ActivityEventType;
  agentType?: PwAgentType | null;
  stepId?: string | null;
  summary: string;
  detail?: Record<string, unknown> | null;
  artifactType?: ActivityArtifactType | null;
  artifactId?: string | null;
  artifactLabel?: string | null;
  promptLogId?: string | null;
  durationMs?: number | null;
  createdAt: Date;
}

type ActivityFeedListener = (event: ActivityFeedEvent) => void;

const globalEvents = globalThis as typeof globalThis & {
  __activityFeedListeners?: Map<string, ActivityFeedListener>;
  __activityFeedCounter?: number;
};

if (!globalEvents.__activityFeedListeners) {
  globalEvents.__activityFeedListeners = new Map<string, ActivityFeedListener>();
}
if (globalEvents.__activityFeedCounter === undefined) {
  globalEvents.__activityFeedCounter = 0;
}

const listeners = globalEvents.__activityFeedListeners;

export function subscribeToActivityFeed(listener: ActivityFeedListener): () => void {
  const id = String(++globalEvents.__activityFeedCounter!);
  listeners.set(id, listener);
  return () => {
    listeners.delete(id);
  };
}

export function emitActivityEvent(event: ActivityFeedEvent): void {
  for (const listener of listeners.values()) {
    try {
      listener(event);
    } catch (error) {
      console.error('[ActivityFeed] Listener error:', error);
    }
  }
}

export function getActivityFeedSubscriberCount(): number {
  return listeners.size;
}
