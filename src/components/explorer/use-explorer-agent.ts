"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  AgentFinding,
  AgentSession,
  ExplorerStyle,
} from "@/lib/db/schema";
import {
  startExplorerAgent,
  pauseExplorerAgent,
  resumeExplorerAgent,
  cancelExplorerAgent,
} from "@/server/actions/explorer-agent";

const POLL_INTERVAL = 2000;

export type ExplorerSessionWithFindings = AgentSession & {
  findings?: AgentFinding[];
};

export interface StartExplorerOptions {
  targetUrl: string;
  maxIterations?: number;
  styleRotation?: ExplorerStyle[];
  email?: string;
  password?: string;
}

/**
 * Client driver for an explorer session: starts/controls it via server
 * actions and polls /api/explorer-agent/[sessionId] for live state (session +
 * findings), mirroring useQaAgent. The session id is remembered per-repo so a
 * page reload re-attaches.
 */
export function useExplorerAgent(
  repositoryId: string | null | undefined,
  initialSession: ExplorerSessionWithFindings | null,
) {
  const [session, setSession] = useState<ExplorerSessionWithFindings | null>(
    initialSession,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const storageKey = repositoryId ? `explorer-session-${repositoryId}` : null;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    async (sid: string) => {
      try {
        const res = await fetch(`/api/explorer-agent/${sid}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 404 && storageKey) {
            localStorage.removeItem(storageKey);
            setSession(null);
          }
          return;
        }
        const data: ExplorerSessionWithFindings = await res.json();
        setSession(data);
        if (data.status !== "active" && data.status !== "paused") {
          stopPolling();
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
      return;
    }
    startPolling(sid);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositoryId]);

  const start = useCallback(
    async (options: StartExplorerOptions) => {
      if (!repositoryId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await startExplorerAgent({ repositoryId, ...options });
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

  const pause = useCallback(
    () =>
      session
        ? runAction(() => pauseExplorerAgent(session.id), session.id)
        : Promise.resolve(),
    [session, runAction],
  );

  const resume = useCallback(
    () =>
      session
        ? runAction(() => resumeExplorerAgent(session.id), session.id)
        : Promise.resolve(),
    [session, runAction],
  );

  const cancel = useCallback(
    () =>
      session
        ? runAction(() => cancelExplorerAgent(session.id), session.id)
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
  const totalSteps = session?.steps.length ?? 1;
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
    pause,
    resume,
    cancel,
    dismiss,
  };
}
