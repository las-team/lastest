"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentSession, QaRunMode, QaTestGroup } from "@/lib/db/schema";
import {
  startQaAgent,
  approveQaPlan,
  rerunQaPlanner,
  pauseQaAgent,
  resumeQaAgent,
  cancelQaAgent,
  type StartQaAgentInput,
} from "@/server/actions/qa-agent";

const POLL_INTERVAL = 2000;

export interface StartQaOptions {
  targetUrl: string;
  mode?: QaRunMode;
  groups: QaTestGroup[];
  email?: string;
  password?: string;
  autoApprove?: boolean;
  allowRegistration?: boolean;
}

/**
 * Client driver for a QA agent session: starts/controls it via server actions
 * and polls /api/qa-agent/[sessionId] for live state, mirroring usePlayAgent.
 * The session id is remembered per-repo so a page reload re-attaches.
 */
export function useQaAgent(
  repositoryId: string | null | undefined,
  initialSession: AgentSession | null,
) {
  const [session, setSession] = useState<AgentSession | null>(initialSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const storageKey = repositoryId ? `qa-agent-session-${repositoryId}` : null;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    async (sid: string) => {
      try {
        const res = await fetch(`/api/qa-agent/${sid}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 404 && storageKey) {
            localStorage.removeItem(storageKey);
            setSession(null);
          }
          return;
        }
        const data: AgentSession = await res.json();
        setSession(data);
        if (data.status !== "active") {
          // paused (review gate) and terminal states don't need a 2s cadence;
          // paused keeps a slow poll via the effect below re-arming on action.
          if (data.status !== "paused") stopPolling();
        }
      } catch {
        // Transient network errors are ignored; next tick retries.
      }
    },
    [storageKey, stopPolling],
  );

  const startPolling = useCallback(
    (sid: string) => {
      stopPolling();
      pollRef.current = setInterval(() => poll(sid), POLL_INTERVAL);
      void poll(sid);
    },
    [poll, stopPolling],
  );

  // Re-attach on mount: prefer the server-provided session, else localStorage.
  useEffect(() => {
    const sid =
      initialSession?.id ??
      (storageKey ? localStorage.getItem(storageKey) : null);
    if (!sid) return;
    if (
      initialSession &&
      initialSession.status !== "active" &&
      initialSession.status !== "paused"
    ) {
      return; // terminal snapshot from the server — nothing to poll
    }
    startPolling(sid);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositoryId]);

  const runAction = useCallback(
    async (fn: () => Promise<unknown>, sid?: string) => {
      setLoading(true);
      setError(null);
      try {
        await fn();
        if (sid) startPolling(sid);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setLoading(false);
      }
    },
    [startPolling],
  );

  const start = useCallback(
    async (options: StartQaOptions) => {
      if (!repositoryId) return;
      setLoading(true);
      setError(null);
      try {
        const input: StartQaAgentInput = { repositoryId, ...options };
        const result = await startQaAgent(input);
        if (storageKey) localStorage.setItem(storageKey, result.sessionId);
        startPolling(result.sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start");
      } finally {
        setLoading(false);
      }
    },
    [repositoryId, storageKey, startPolling],
  );

  const approve = useCallback(
    (disabledItemIds: string[]) =>
      session
        ? runAction(
            () => approveQaPlan(session.id, { disabledItemIds }),
            session.id,
          )
        : Promise.resolve(),
    [session, runAction],
  );

  const requestChanges = useCallback(
    (feedback: string) =>
      session
        ? runAction(() => rerunQaPlanner(session.id, feedback), session.id)
        : Promise.resolve(),
    [session, runAction],
  );

  const pause = useCallback(
    () =>
      session
        ? runAction(() => pauseQaAgent(session.id), session.id)
        : Promise.resolve(),
    [session, runAction],
  );

  const resume = useCallback(
    () =>
      session
        ? runAction(() => resumeQaAgent(session.id), session.id)
        : Promise.resolve(),
    [session, runAction],
  );

  const cancel = useCallback(
    () =>
      session
        ? runAction(() => cancelQaAgent(session.id), session.id)
        : Promise.resolve(),
    [session, runAction],
  );

  /** Forget the current (terminal) session so the setup form shows again. */
  const dismiss = useCallback(() => {
    stopPolling();
    if (storageKey) localStorage.removeItem(storageKey);
    setSession(null);
  }, [storageKey, stopPolling]);

  const isRunning = session?.status === "active";
  const isPaused = session?.status === "paused";
  const isTerminal =
    session?.status === "completed" ||
    session?.status === "failed" ||
    session?.status === "cancelled";

  const completedSteps =
    session?.steps.filter(
      (s) => s.status === "completed" || s.status === "skipped",
    ).length ?? 0;
  const totalSteps = session?.steps.length ?? 9;
  const progress =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return {
    session,
    loading,
    error,
    isRunning,
    isPaused,
    isTerminal,
    progress,
    start,
    approve,
    requestChanges,
    pause,
    resume,
    cancel,
    dismiss,
  };
}
