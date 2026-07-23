"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ActivityEvent } from "@/lib/db/schema";

const MAX_EVENTS = 500;

interface UseActivityFeedOpts {
  repoId?: string;
  sourceType?: string;
  enabled?: boolean;
}

export function useActivityFeed(opts: UseActivityFeedOpts = {}) {
  const { repoId, sourceType, enabled = true } = opts;
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  const clearEvents = useCallback(() => setEvents([]), []);

  // Live feed via SSE — EventSource auto-reconnects (including across the
  // endpoint's 90s lifetime-cap close).
  useEffect(() => {
    if (!enabled) return;

    const params = new URLSearchParams();
    if (repoId) params.set("repo", repoId);
    if (sourceType) params.set("source", sourceType);

    const qs = params.toString() ? `?${params}` : "";
    const es = new EventSource(`/api/activity-feed${qs}`);
    esRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "connected") return;

        const event = data as ActivityEvent;
        setEvents((prev) => {
          const next = [...prev, event];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });

        // Track active sessions
        if (event.eventType === "session:start") {
          setActiveSessionCount((c) => c + 1);
        } else if (
          event.eventType === "session:complete" ||
          event.eventType === "session:error"
        ) {
          setActiveSessionCount((c) => Math.max(0, c - 1));
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource retries automatically; just reflect the gap in the UI.
      setIsConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
      setIsConnected(false);
    };
  }, [enabled, repoId, sourceType]);

  // Load history for a specific session (replay mode)
  const loadSessionHistory = useCallback(async (sessionId: string) => {
    const res = await fetch(
      `/api/activity-feed/history?sessionId=${sessionId}&limit=500`,
    );
    if (!res.ok) return;
    const { events: history } = await res.json();
    setEvents(history);
  }, []);

  return {
    events,
    isConnected,
    activeSessionCount,
    clearEvents,
    loadSessionHistory,
  };
}
