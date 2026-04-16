'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ActivityEvent } from '@/lib/db/schema';

const MAX_EVENTS = 500;

interface UseActivityFeedOpts {
  repoId?: string;
  sourceType?: string;
  enabled?: boolean;
}

function buildWsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

export function useActivityFeed(opts: UseActivityFeedOpts = {}) {
  const { repoId, sourceType, enabled = true } = opts;
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  const clearEvents = useCallback(() => setEvents([]), []);

  // WebSocket connection for live feed
  useEffect(() => {
    if (!enabled) return;

    const params = new URLSearchParams();
    if (repoId) params.set('repo', repoId);
    if (sourceType) params.set('source', sourceType);

    const qs = params.toString() ? `?${params}` : '';
    const ws = new WebSocket(buildWsUrl(`/api/activity-feed/ws${qs}`));
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') return;

        const event = data as ActivityEvent;
        setEvents((prev) => {
          const next = [...prev, event];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });

        // Track active sessions
        if (event.eventType === 'session:start') {
          setActiveSessionCount((c) => c + 1);
        } else if (event.eventType === 'session:complete' || event.eventType === 'session:error') {
          setActiveSessionCount((c) => Math.max(0, c - 1));
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setIsConnected(false);
    };
  }, [enabled, repoId, sourceType]);

  // Load history for a specific session (replay mode)
  const loadSessionHistory = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/activity-feed/history?sessionId=${sessionId}&limit=500`);
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
