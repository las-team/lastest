"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SESSION_KEY_PREFIX = "quickstart-session-id:";
const POLL_INTERVAL_MS = 2500;

export interface QuickstartStep {
  id: string;
  status:
    | "pending"
    | "active"
    | "waiting_user"
    | "completed"
    | "failed"
    | "skipped";
  label: string;
  description?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: Record<string, unknown>;
}

export interface QuickstartSessionView {
  id: string;
  kind: "quickstart";
  repositoryId: string;
  status: "active" | "paused" | "completed" | "failed" | "cancelled";
  currentStepId: string | null;
  steps: QuickstartStep[];
  metadata: {
    quickstartEmail?: string;
    quickstartSlug?: string;
    publicScout?: {
      classification?: string;
      authAutomatable?: boolean;
      tagline?: string;
      concept?: string;
    };
    authSetup?: {
      testId?: string;
      storageStateId?: string;
      captured: boolean;
      failureReason?: string;
    };
    walkthroughTestId?: string;
    buildId?: string;
    demoNotesId?: string;
    disabledReason?: string;
  };
  createdAt?: string;
  completedAt?: string;
}

export function useQuickstart(repositoryId?: string | null) {
  const [session, setSession] = useState<QuickstartSessionView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const storageKey = repositoryId
    ? `${SESSION_KEY_PREFIX}${repositoryId}`
    : null;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    async (sid: string) => {
      try {
        const res = await fetch(`/api/v1/quickstart/${sid}`);
        if (!res.ok) {
          if (storageKey) localStorage.removeItem(storageKey);
          setSession(null);
          stopPolling();
          return;
        }
        const data = (await res.json()) as QuickstartSessionView;
        setSession(data);
        if (data.status !== "active" && data.status !== "paused") {
          stopPolling();
        }
      } catch {
        // transient — keep polling
      }
    },
    [storageKey, stopPolling],
  );

  // Restore session id from localStorage on mount / repo switch.
  useEffect(() => {
    stopPolling();
    setSession(null);
    setError(null);
    if (!storageKey) return;
    const sid = localStorage.getItem(storageKey);
    if (!sid) return;
    poll(sid);
    pollRef.current = setInterval(() => poll(sid), POLL_INTERVAL_MS);
    return stopPolling;
  }, [storageKey, poll, stopPolling]);

  const start = useCallback(
    async (creds?: { appEmail?: string; appPassword?: string }) => {
      if (!repositoryId || !storageKey) return;
      setLoading(true);
      setError(null);
      try {
        const reqBody =
          creds?.appEmail && creds?.appPassword
            ? { appEmail: creds.appEmail, appPassword: creds.appPassword }
            : {};
        const res = await fetch(`/api/v1/repos/${repositoryId}/quickstart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            hint?: string;
            reason?: string;
          };
          setError(body.hint ?? body.error ?? `HTTP ${res.status}`);
          return;
        }
        const { sessionId } = (await res.json()) as { sessionId: string };
        localStorage.setItem(storageKey, sessionId);
        stopPolling();
        await poll(sessionId);
        pollRef.current = setInterval(() => poll(sessionId), POLL_INTERVAL_MS);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [repositoryId, storageKey, poll, stopPolling],
  );

  const cancel = useCallback(async () => {
    if (!session?.id) return;
    setLoading(true);
    try {
      await fetch(`/api/v1/quickstart/${session.id}`, {
        method: "DELETE",
      }).catch(() => {});
      await poll(session.id);
    } finally {
      setLoading(false);
    }
  }, [session?.id, poll]);

  const dismiss = useCallback(() => {
    if (storageKey) localStorage.removeItem(storageKey);
    setSession(null);
    setError(null);
    stopPolling();
  }, [storageKey, stopPolling]);

  const isActive = session?.status === "active" || session?.status === "paused";
  const isTerminal =
    session?.status === "completed" ||
    session?.status === "failed" ||
    session?.status === "cancelled";

  return {
    session,
    loading,
    error,
    isActive,
    isTerminal,
    start,
    cancel,
    dismiss,
  };
}
