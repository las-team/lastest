'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import type { BackgroundJob } from '@/lib/db/schema';

interface JobPollingContextValue {
  jobs: BackgroundJob[];
  startPolling: () => void;
}

const JobPollingContext = createContext<JobPollingContextValue | null>(null);

export function JobPollingProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [isPolling, setIsPolling] = useState(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/active');
      if (res.ok) {
        const data: BackgroundJob[] = await res.json();
        setJobs(data);
        const hasActive = data.some(j => j.status === 'pending' || j.status === 'running');
        if (!hasActive && data.length === 0) {
          setIsPolling(false);
        } else {
          setIsPolling(true);
        }
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (isPolling) {
      timerRef.current = setInterval(fetchJobs, 2000);
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

  return (
    <JobPollingContext.Provider value={{ jobs, startPolling }}>
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
