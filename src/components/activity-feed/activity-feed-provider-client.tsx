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
}

const ActivityFeedContext = createContext<ActivityFeedContextValue | null>(null);

export function useActivityFeedContext() {
  const ctx = useContext(ActivityFeedContext);
  if (!ctx) throw new Error('useActivityFeedContext must be used within ActivityFeedProvider');
  return ctx;
}

const MAX_EVENTS = 500;

export function ActivityFeedProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const isOpenRef = useRef(isOpen);
  const lastMcpToast = useRef(0);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const clearEvents = useCallback(() => setEvents([]), []);

  // Global SSE connection
  useEffect(() => {
    const es = new EventSource('/api/activity-feed');

    es.onopen = () => setIsConnected(true);

    es.onmessage = (e) => {
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

        // Toast notifications
        if (event.eventType === 'session:start') {
          toast('AI session started', {
            description: event.summary,
            action: {
              label: 'View',
              onClick: () => setIsOpen(true),
            },
          });
        } else if (event.eventType === 'session:complete') {
          toast.success('AI session completed', {
            description: event.summary,
            action: {
              label: 'View',
              onClick: () => setIsOpen(true),
            },
          });
        } else if (event.eventType === 'session:error') {
          toast.error('AI session failed', {
            description: event.summary,
            action: {
              label: 'View',
              onClick: () => setIsOpen(true),
            },
          });
        } else if (event.eventType === 'mcp:tool_call') {
          const now = Date.now();
          if (now - lastMcpToast.current > 5000) {
            lastMcpToast.current = now;
            toast('MCP tool called', {
              description: event.summary,
              duration: 3000,
            });
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      es.close();
      setIsConnected(false);
    };
  }, []);

  return (
    <ActivityFeedContext.Provider
      value={{ events, isOpen, setIsOpen, isConnected, activeSessionCount, clearEvents }}
    >
      {children}
    </ActivityFeedContext.Provider>
  );
}
