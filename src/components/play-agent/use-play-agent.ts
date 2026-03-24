'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentSession } from '@/lib/db/schema';
import { startPlayAgent, resumePlayAgent, pausePlayAgent, cancelPlayAgent, approvePlayAgentPlan, rerunPlanner as rerunPlannerAction, skipSettingsStep } from '@/server/actions/play-agent';

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
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        return;
      }
      const data: AgentSession = await res.json();
      setSession(data);

      if (data.status !== 'active' && data.status !== 'paused') {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      // Ignore transient errors
    }
  }, []);

  useEffect(() => {
    const sid = sessionId;
    if (!sid) return;

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
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => poll(session.id), POLL_INTERVAL);
      await poll(session.id);
    } finally {
      setLoading(false);
    }
  }, [session?.id, poll]);

  const cancel = useCallback(async () => {
    if (!session?.id) return;
    setLoading(true);
    try {
      await pausePlayAgent(session.id);
      await poll(session.id);
      // Keep polling so UI stays in sync when paused
    } finally {
      setLoading(false);
    }
  }, [session?.id, poll]);

  const approvePlan = useCallback(async (approvedAreaIds: string[], autoApprove: boolean) => {
    if (!session?.id || loading) return;
    setLoading(true);
    try {
      // If empty array, approve all areas from plan step
      let ids = approvedAreaIds;
      if (ids.length === 0) {
        const planStep = session.steps.find(s => s.id === 'plan');
        const planRich = planStep?.richResult as { type: 'plan'; areas: Array<{ id: string }> } | undefined;
        ids = planRich?.areas?.map(a => a.id) || [];
      }
      await approvePlayAgentPlan(session.id, ids, autoApprove);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => poll(session.id), POLL_INTERVAL);
      await poll(session.id);
    } finally {
      setLoading(false);
    }
  }, [session?.id, session?.steps, poll, loading]);

  const rerunPlanner = useCallback(async (source: string) => {
    if (!session?.id) return;
    setLoading(true);
    try {
      await rerunPlannerAction(session.id, source);
      // Resume polling to pick up the update
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => poll(session.id), POLL_INTERVAL);
      await poll(session.id);
    } finally {
      setLoading(false);
    }
  }, [session?.id, poll]);

  const skipSettings = useCallback(async () => {
    if (!session?.id) return;
    setLoading(true);
    try {
      await skipSettingsStep(session.id);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => poll(session.id), POLL_INTERVAL);
      await poll(session.id);
    } finally {
      setLoading(false);
    }
  }, [session?.id, poll]);

  const dismiss = useCallback(async () => {
    if (session?.id) {
      await cancelPlayAgent(session.id).catch(() => {});
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [session?.id]);

  const isActive = session?.status === 'active' || session?.status === 'paused';
  const isTerminal = session?.status === 'completed' || session?.status === 'cancelled' || session?.status === 'failed';

  const completedSteps = session?.steps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  ).length ?? 0;
  const totalSteps = session?.steps.length ?? 11;
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
    approvePlan,
    rerunPlanner,
    skipSettings,
  };
}
