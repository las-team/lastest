"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { toast } from "sonner";
import type { ActivityEvent } from "@/lib/db/schema";

interface ActivityFeedContextValue {
  events: ActivityEvent[];
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isConnected: boolean;
  activeSessionCount: number;
  clearEvents: () => void;
  historyLoaded: boolean;
}

const ActivityFeedContext = createContext<ActivityFeedContextValue | null>(
  null,
);

export function useActivityFeedContext() {
  const ctx = useContext(ActivityFeedContext);
  if (!ctx)
    throw new Error(
      "useActivityFeedContext must be used within ActivityFeedProvider",
    );
  return ctx;
}

/** Safe version that returns null when provider is not mounted (e.g. early adopter off) */
export function useActivityFeedContextSafe() {
  return useContext(ActivityFeedContext);
}

const MAX_EVENTS = 500;

export function ActivityFeedProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const lastMcpToast = useRef(0);
  const clearedAtRef = useRef<string | null>(
    typeof window !== "undefined"
      ? sessionStorage.getItem("activity-feed-cleared-at")
      : null,
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
    // Remember the timestamp so history reloads and WS messages don't bring them back
    const ts = new Date().toISOString();
    clearedAtRef.current = ts;
    try {
      sessionStorage.setItem("activity-feed-cleared-at", ts);
    } catch {}
  }, []);

  // Load recent history on mount so there's initial data
  useEffect(() => {
    fetch("/api/activity-feed/history?limit=50")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.events?.length) {
          // History comes in DESC order, reverse for chronological
          let history = [...data.events].reverse() as ActivityEvent[];
          // Filter out events before the last clear
          if (clearedAtRef.current) {
            history = history.filter(
              (e) =>
                e.createdAt &&
                new Date(e.createdAt) > new Date(clearedAtRef.current!),
            );
          }
          setEvents(history);

          // Count active sessions from history
          const starts = history.filter(
            (e: ActivityEvent) => e.eventType === "session:start",
          ).length;
          const ends = history.filter(
            (e: ActivityEvent) =>
              e.eventType === "session:complete" ||
              e.eventType === "session:error",
          ).length;
          setActiveSessionCount(Math.max(0, starts - ends));
        }
        setHistoryLoaded(true);
      })
      .catch(() => {
        setHistoryLoaded(true);
      });
  }, []);

  // Live feed via SSE. EventSource auto-reconnects (including across the
  // endpoint's 90s lifetime-cap close), so no hand-rolled retry loop.
  useEffect(() => {
    const es = new EventSource("/api/activity-feed");

    es.onopen = () => setIsConnected(true);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "connected") return;

        const event = data as ActivityEvent;
        // Skip events from before the last clear
        if (
          clearedAtRef.current &&
          event.createdAt &&
          new Date(event.createdAt) <= new Date(clearedAtRef.current)
        )
          return;
        setEvents((prev) => {
          // Dedupe by id
          if (prev.some((p) => p.id === event.id)) return prev;
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

        // Toast notifications
        if (event.eventType === "session:start") {
          toast("AI session started", {
            description: event.summary,
            action: { label: "View", onClick: () => setIsOpen(true) },
          });
        } else if (event.eventType === "session:complete") {
          toast.success("AI session completed", {
            description: event.summary,
            action: { label: "View", onClick: () => setIsOpen(true) },
          });
        } else if (event.eventType === "session:error") {
          toast.error("AI session failed", {
            description: event.summary,
            action: { label: "View", onClick: () => setIsOpen(true) },
          });
        } else if (event.eventType === "mcp:tool_call") {
          const now = Date.now();
          if (now - lastMcpToast.current > 5000) {
            lastMcpToast.current = now;
            toast("MCP tool called", {
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
      // EventSource retries automatically; just reflect the gap in the UI.
      setIsConnected(false);
    };

    return () => {
      es.close();
      setIsConnected(false);
    };
  }, []);

  return (
    <ActivityFeedContext.Provider
      value={{
        events,
        isOpen,
        setIsOpen,
        isConnected,
        activeSessionCount,
        clearEvents,
        historyLoaded,
      }}
    >
      {children}
    </ActivityFeedContext.Provider>
  );
}
