'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Runner } from '@/lib/db/schema';
import { getRunnersWithCapability } from '@/server/actions/runners';
import type { RunnerCapability } from '@/lib/db/schema';

interface RunnerStatusEvent {
  type: 'init' | 'status';
  runners?: Array<{
    id: string;
    name: string;
    status: string;
    lastSeen?: string;
  }>;
  runnerId?: string;
  status?: string;
  previousStatus?: string;
  timestamp?: number;
}

/**
 * Hook for subscribing to runner status updates via SSE
 * Falls back to polling if SSE connection fails
 */
export function useRunnerStatus(capabilityFilter?: RunnerCapability) {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // Initial load of runners (for full data)
  const loadRunners = useCallback(async () => {
    try {
      const allRunners = await getRunnersWithCapability(capabilityFilter);
      setRunners(allRunners);
    } catch (error) {
      console.error('Failed to load runners:', error);
    } finally {
      setIsLoading(false);
    }
  }, [capabilityFilter]);

  // Connect to SSE stream
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource('/api/runners/status');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      reconnectAttempts.current = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const data: RunnerStatusEvent = JSON.parse(event.data);

        if (data.type === 'init' && data.runners) {
          // Update status for all runners from SSE init
          setRunners((prev) =>
            prev.map((runner) => {
              const updated = data.runners!.find((r) => r.id === runner.id);
              if (updated) {
                return { ...runner, status: updated.status as Runner['status'] };
              }
              return runner;
            })
          );
        } else if (data.type === 'status' && data.runnerId && data.status) {
          // Update single runner status
          setRunners((prev) =>
            prev.map((runner) =>
              runner.id === data.runnerId
                ? { ...runner, status: data.status as Runner['status'] }
                : runner
            )
          );
        }
      } catch (error) {
        console.error('Failed to parse SSE event:', error);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
      eventSourceRef.current = null;

      // Attempt reconnect with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;

        reconnectTimeoutRef.current = setTimeout(() => {
          connectSSE();
        }, delay);
      } else {
        // Fall back to polling
        console.warn('SSE connection failed, falling back to polling');
        const pollInterval = setInterval(loadRunners, 30000);
        return () => clearInterval(pollInterval);
      }
    };
  }, [loadRunners]);

  // Initial setup
  useEffect(() => {
    loadRunners();
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [loadRunners, connectSSE]);

  // Filter by capability
  const filteredRunners = capabilityFilter
    ? runners.filter((runner) => {
        const caps = runner.capabilities || ['run', 'record'];
        return caps.includes(capabilityFilter);
      })
    : runners;

  return {
    runners: filteredRunners,
    isLoading,
    isConnected,
    refresh: loadRunners,
  };
}
