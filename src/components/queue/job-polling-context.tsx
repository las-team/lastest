'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import type { BackgroundJob } from '@/lib/db/schema';

export type JobWithChildren = BackgroundJob & {
  _children?: BackgroundJob[];
  _childSummary?: { total: number; completed: number; failed: number; running: number; pending: number };
};

type JobClickHandler = (job: JobWithChildren) => void;

interface JobPollingContextValue {
  jobs: JobWithChildren[];
  startPolling: () => void;
  refreshJobs: () => void;
  registerJobClickHandler: (handler: JobClickHandler) => void;
  unregisterJobClickHandler: (handler: JobClickHandler) => void;
  onJobClick: (job: JobWithChildren) => void;
}

export const JobPollingContext = createContext<JobPollingContextValue | null>(null);

export function JobPollingProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobWithChildren[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/active');
      if (res.ok) {
        const data: JobWithChildren[] = await res.json();
        setJobs(data);
        const hasActive = data.some(j => j.status === 'pending' || j.status === 'running');
        setIsPolling(hasActive);
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => fetchJobs());
  }, [fetchJobs]);

  useEffect(() => {
    if (isPolling) {
      timerRef.current = setInterval(fetchJobs, 3000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPolling, fetchJobs]);

  const startPolling = useCallback(() => {
    setIsPolling(true);
    fetchJobs();
  }, [fetchJobs]);

  const handlersRef = useRef<Set<JobClickHandler>>(new Set());

  const registerJobClickHandler = useCallback((handler: JobClickHandler) => {
    handlersRef.current.add(handler);
  }, []);

  const unregisterJobClickHandler = useCallback((handler: JobClickHandler) => {
    handlersRef.current.delete(handler);
  }, []);

  const onJobClick = useCallback((job: JobWithChildren) => {
    for (const handler of handlersRef.current) {
      handler(job);
    }
  }, []);

  return (
    <JobPollingContext.Provider value={{ jobs, startPolling, refreshJobs: fetchJobs, registerJobClickHandler, unregisterJobClickHandler, onJobClick }}>
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
