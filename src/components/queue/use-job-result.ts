'use client';

import { useState, useEffect, useCallback } from 'react';
import type { BackgroundJob } from '@/lib/db/schema';

interface UseJobResultOptions {
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number;
  /** Stop polling when job completes (default: true) */
  stopOnComplete?: boolean;
}

interface UseJobResultReturn {
  job: BackgroundJob | null;
  isLoading: boolean;
  isComplete: boolean;
  isFailed: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to poll a background job's status and retrieve results from metadata.
 *
 * Usage:
 *   const { job, isComplete, isFailed } = useJobResult(jobId);
 *   if (isComplete) console.log(job?.metadata);
 */
export function useJobResult(
  jobId: string | null,
  options: UseJobResultOptions = {}
): UseJobResultReturn {
  const { pollInterval = 2000, stopOnComplete = true } = options;

  const [job, setJob] = useState<BackgroundJob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isComplete = job?.status === 'completed';
  const isFailed = job?.status === 'failed';

  const fetchJob = useCallback(async () => {
    if (!jobId) return;

    try {
      setIsLoading(true);
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) {
        setError(`Failed to fetch job: ${response.status}`);
        return;
      }
      const data = await response.json();
      setJob(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch job');
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    // Initial fetch
    fetchJob();

    // Poll until complete
    const interval = setInterval(() => {
      if (stopOnComplete && (isComplete || isFailed)) return;
      fetchJob();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [jobId, pollInterval, stopOnComplete, isComplete, isFailed, fetchJob]);

  return { job, isLoading, isComplete, isFailed, error, refetch: fetchJob };
}
