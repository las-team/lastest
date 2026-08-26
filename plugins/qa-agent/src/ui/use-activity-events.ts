"use client";

import { useEffect, useState } from "react";

/**
 * The slice of a live activity-feed event the QA client reads — narrowed
 * from core's `ActivityEvent` row shape (recipe §6.1: the type belongs to
 * core, declare only the fields you read).
 */
export interface QaFeedEvent {
  id: string;
  eventType: string;
  summary: string;
  sourceType: string;
  createdAt: string | Date;
}

const MAX_EVENTS = 500;

/**
 * Live activity events for a repo over the app's SSE endpoint.
 *
 * This used to be the app's `useActivityFeed` hook
 * (`src/components/activity-feed/use-activity-feed.ts`), which a plugin may
 * not import. Subscribing to the *endpoint* is fine — `/api/activity-feed`
 * is the same public URL `plugins/app-map`'s exploration progress already
 * opens an `EventSource` against, and a URL is a contract, not an import.
 * Only the `events` half of the app hook is reproduced; the QA client never
 * read `isConnected`/`activeSessionCount`/`loadSessionHistory`.
 *
 * EventSource auto-reconnects (including across the endpoint's 90s
 * lifetime-cap close), same as the app hook relies on.
 */
export function useActivityEvents(repoId: string): { events: QaFeedEvent[] } {
  const [events, setEvents] = useState<QaFeedEvent[]>([]);

  useEffect(() => {
    const es = new EventSource(
      `/api/activity-feed?repo=${encodeURIComponent(repoId)}`,
    );
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "connected") return;
        const event = data as QaFeedEvent;
        setEvents((prev) => {
          const next = [...prev, event];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
      } catch {
        // Ignore parse errors — next event retries.
      }
    };
    return () => {
      es.close();
    };
  }, [repoId]);

  return { events };
}
