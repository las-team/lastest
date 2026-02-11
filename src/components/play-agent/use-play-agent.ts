'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentSession } from '@/lib/db/schema';
import { startPlayAgent, resumePlayAgent, cancelPlayAgent } from '@/server/actions/play-agent';

const SESSION_KEY = 'play-agent-session-id';
const POLL_INTERVAL = 2000;

export function usePlayAgent(repositoryId?: string | null) {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sessionId = session?.id ?? (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null);

  const poll = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/play-agent/${sid}`);
      if (!res.ok) {
        // Session gone — clear
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        return;
      }
      const data: AgentSession = await res.json();
      setSession(data);

      // Stop polling if terminal
      if (data.status === 'completed' || data.status === 'cancelled' || data.status === 'failed') {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      // Ignore transient errors
    }
  }, []);

  // Start polling when we have a session ID
  useEffect(() => {
    const sid = sessionId;
    if (!sid) return;

    // Initial fetch
    poll(sid);

    pollRef.current = setInterval(() => poll(sid), POLL_INTERVAL);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [sessionId, poll]);

  const start = useCallback(async () => {
    if (!repositoryId) return;
    setLoading(true);
    try {
      const result = await startPlayAgent(repositoryId);
      localStorage.setItem(SESSION_KEY, result.sessionId);
      await poll(result.sessionId);

      // Start polling
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => poll(result.sessionId), POLL_INTERVAL);
    } finally {
      setLoading(false);
    }
  }, [repositoryId, poll]);

  const resume = useCallback(async () => {
    if (!session?.id) return;
    setLoading(true);
    try {
      await resumePlayAgent(session.id);
      // Resume polling
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => poll(session.id), POLL_INTERVAL);
    } finally {
      setLoading(false);
    }
  }, [session?.id, poll]);

  const cancel = useCallback(async () => {
    if (!session?.id) return;
    setLoading(true);
    try {
      await cancelPlayAgent(session.id);
      localStorage.removeItem(SESSION_KEY);
      setSession(null);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } finally {
      setLoading(false);
    }
  }, [session?.id]);

  const dismiss = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const isActive = session?.status === 'active' || session?.status === 'paused';
  const isTerminal = session?.status === 'completed' || session?.status === 'cancelled' || session?.status === 'failed';

  // Compute progress
  const completedSteps = session?.steps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  ).length ?? 0;
  const totalSteps = session?.steps.length ?? 9;
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return {
    session,
    loading,
    isActive,
    isTerminal,
    progress,
    start,
    resume,
    cancel,
    dismiss,
  };
}
