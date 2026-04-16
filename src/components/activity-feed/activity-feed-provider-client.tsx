'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { ActivityEvent } from '@/lib/db/schema';

interface ActivityFeedContextValue {
  events: ActivityEvent[];
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isConnected: boolean;
  activeSessionCount: number;
  clearEvents: () => void;
  historyLoaded: boolean;
}

const ActivityFeedContext = createContext<ActivityFeedContextValue | null>(null);

export function useActivityFeedContext() {
  const ctx = useContext(ActivityFeedContext);
  if (!ctx) throw new Error('useActivityFeedContext must be used within ActivityFeedProvider');
  return ctx;
}

/** Safe version that returns null when provider is not mounted (e.g. early adopter off) */
export function useActivityFeedContextSafe() {
  return useContext(ActivityFeedContext);
}

const MAX_EVENTS = 500;
const WS_RETRY_DELAY = 3000;
const WS_MAX_RETRIES = 10;

function buildWsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

export function ActivityFeedProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const lastMcpToast = useRef(0);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEvents = useCallback(() => setEvents([]), []);

  // Load recent history on mount so there's initial data
  useEffect(() => {
    fetch('/api/activity-feed/history?limit=50')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.events?.length) {
          // History comes in DESC order, reverse for chronological
          const history = [...data.events].reverse() as ActivityEvent[];
          setEvents(history);

          // Count active sessions from history
          const starts = history.filter((e: ActivityEvent) => e.eventType === 'session:start').length;
          const ends = history.filter((e: ActivityEvent) =>
            e.eventType === 'session:complete' || e.eventType === 'session:error'
          ).length;
          setActiveSessionCount(Math.max(0, starts - ends));
        }
        setHistoryLoaded(true);
      })
      .catch(() => {
        setHistoryLoaded(true);
      });
  }, []);

  // WebSocket connection with retry (deferred to next tick to avoid hydration mismatch)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;

      ws = new WebSocket(buildWsUrl('/api/activity-feed/ws'));

      ws.onopen = () => {
        setIsConnected(true);
        retryCount.current = 0;
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'connected') return;

          const event = data as ActivityEvent;
          setEvents((prev) => {
            // Dedupe by id
            if (prev.some(p => p.id === event.id)) return prev;
            const next = [...prev, event];
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
          });

          // Track active sessions
          if (event.eventType === 'session:start') {
            setActiveSessionCount((c) => c + 1);
          } else if (event.eventType === 'session:complete' || event.eventType === 'session:error') {
            setActiveSessionCount((c) => Math.max(0, c - 1));
          }

          // Toast notifications
          if (event.eventType === 'session:start') {
            toast('AI session started', {
              description: event.summary,
              action: { label: 'View', onClick: () => setIsOpen(true) },
            });
          } else if (event.eventType === 'session:complete') {
            toast.success('AI session completed', {
              description: event.summary,
              action: { label: 'View', onClick: () => setIsOpen(true) },
            });
          } else if (event.eventType === 'session:error') {
            toast.error('AI session failed', {
              description: event.summary,
              action: { label: 'View', onClick: () => setIsOpen(true) },
            });
          } else if (event.eventType === 'mcp:tool_call') {
            const now = Date.now();
            if (now - lastMcpToast.current > 5000) {
              lastMcpToast.current = now;
              toast('MCP tool called', { description: event.summary, duration: 3000 });
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        setIsConnected(false);

        // Retry with backoff
        if (!cancelled && retryCount.current < WS_MAX_RETRIES) {
          retryCount.current++;
          const delay = WS_RETRY_DELAY * Math.min(retryCount.current, 5);
          retryTimer.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    }

    connect();

    return () => {
      cancelled = true;
      ws?.close();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      setIsConnected(false);
    };
  }, []);

  return (
    <ActivityFeedContext.Provider
      value={{ events, isOpen, setIsOpen, isConnected, activeSessionCount, clearEvents, historyLoaded }}
    >
      {children}
    </ActivityFeedContext.Provider>
  );
}
