'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { BackgroundJob } from '@/lib/db/schema';

export function useJobPolling(intervalMs = 2000) {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [isPolling, setIsPolling] = useState(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/active');
      if (res.ok) {
        const data: BackgroundJob[] = await res.json();
        setJobs(data);
        // Stop polling if no active jobs
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
    queueMicrotask(() => fetchJobs());
  }, [fetchJobs]);

  useEffect(() => {
    if (isPolling) {
      timerRef.current = setInterval(fetchJobs, intervalMs);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPolling, intervalMs, fetchJobs]);

  // Allow external trigger to start polling (e.g., after kicking off a job)
  const startPolling = useCallback(() => {
    setIsPolling(true);
    fetchJobs();
  }, [fetchJobs]);

  return { jobs, startPolling };
}
