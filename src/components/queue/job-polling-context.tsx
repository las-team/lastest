'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import type { BackgroundJob } from '@/lib/db/schema';

export type JobWithChildren = BackgroundJob & {
  _children?: BackgroundJob[];
  _childSummary?: { total: number; completed: number; failed: number; running: number; pending: number };
};

interface JobPollingContextValue {
  jobs: JobWithChildren[];
  startPolling: () => void;
  refreshJobs: () => void;
}

export const JobPollingContext = createContext<JobPollingContextValue | null>(null);

export function JobPollingProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobWithChildren[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const connectRef = useRef<(() => void) | null>(null);

  const connect = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const es = new EventSource('/api/jobs/events');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'snapshot') {
          // Full snapshot on connect — replace all jobs
          setJobs(data.jobs);
          reconnectAttemptRef.current = 0;
        } else if (data.type === 'job:update') {
          // Merge single job update into state
          setJobs(prev => {
            const idx = prev.findIndex(j => j.id === data.jobId);
            const updated: JobWithChildren = {
              id: data.jobId,
              type: data.jobType,
              status: data.status,
              progress: data.progress,
              completedSteps: data.completedSteps,
              totalSteps: data.totalSteps,
              label: data.label,
              error: data.error,
              metadata: data.metadata,
              parentJobId: data.parentJobId,
              repositoryId: data.repositoryId,
              targetRunnerId: data.targetRunnerId,
              actualRunnerId: data.actualRunnerId ?? null,
              createdAt: data.createdAt ? new Date(data.createdAt) : null,
              startedAt: data.startedAt ? new Date(data.startedAt) : null,
              completedAt: data.completedAt ? new Date(data.completedAt) : null,
              lastActivityAt: data.lastActivityAt ? new Date(data.lastActivityAt) : null,
              // Preserve existing children until next snapshot
              ...(idx >= 0 ? { _children: prev[idx]._children, _childSummary: prev[idx]._childSummary } : {}),
            };

            if (idx >= 0) {
              const next = [...prev];
              next[idx] = updated;
              return next;
            }
            // New job — only add if not a child job (parent list only)
            if (!data.parentJobId) {
              return [updated, ...prev];
            }
            return prev;
          });
        } else if (data.type === 'job:delete') {
          setJobs(prev => prev.filter(j => j.id !== data.jobId));
        }
      } catch {
        // Ignore parse errors (e.g. keepalive comments)
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      // Reconnect with exponential backoff (max 30s)
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      reconnectTimerRef.current = setTimeout(() => connectRef.current?.(), delay);
    };
  }, []);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connect]);

  // Manual refresh fallback — fetches from HTTP endpoint
  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/active');
      if (res.ok) {
        const data: JobWithChildren[] = await res.json();
        setJobs(data);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // startPolling is now a no-op since SSE is always connected
  // but kept for API compatibility with existing callers
  const startPolling = useCallback(() => {
    // If SSE is disconnected, reconnect immediately
    if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
      reconnectAttemptRef.current = 0;
      connect();
    }
  }, [connect]);

  return (
    <JobPollingContext.Provider value={{ jobs, startPolling, refreshJobs }}>
      {children}
    </JobPollingContext.Provider>
  );
}

export function useJobPollingContext() {
  const ctx = useContext(JobPollingContext);
  if (!ctx) {
    throw new Error('useJobPollingContext must be used within JobPollingProvider');
  }
  return ctx;
}

export function useNotifyJobStarted() {
  const ctx = useContext(JobPollingContext);
  return ctx?.startPolling ?? (() => {});
}
