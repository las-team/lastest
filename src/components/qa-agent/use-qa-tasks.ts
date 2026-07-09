"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { QaTask, QaTaskSource } from "@/lib/db/schema";
import {
  addQaTask,
  dropQaTask,
  listQaTasks,
  retryQaTask,
} from "@/server/actions/qa-agent";

const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 20000;

/**
 * Client driver for the QA agent direction queue: polls the board state
 * (fast while something is queued/working, slow otherwise) and wraps the
 * task server actions.
 */
export function useQaTasks(repositoryId: string, initialTasks: QaTask[]) {
  const [tasks, setTasks] = useState<QaTask[]>(initialTasks);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTasks(await listQaTasks(repositoryId));
    } catch {
      // Transient — next poll retries.
    }
  }, [repositoryId]);

  const hasOpenWork = useMemo(
    () => tasks.some((t) => t.status === "queued" || t.status === "working"),
    [tasks],
  );

  useEffect(() => {
    const interval = setInterval(
      () => void refresh(),
      hasOpenWork ? ACTIVE_POLL_MS : IDLE_POLL_MS,
    );
    return () => clearInterval(interval);
  }, [refresh, hasOpenWork]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setPending(true);
      setError(null);
      try {
        await fn();
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
        return false;
      } finally {
        setPending(false);
      }
    },
    [refresh],
  );

  const add = useCallback(
    (
      title: string,
      opts?: {
        description?: string;
        source?: Extract<QaTaskSource, "user" | "coverage_gap">;
      },
    ) =>
      run(() =>
        addQaTask({
          repositoryId,
          title,
          description: opts?.description,
          source: opts?.source,
        }),
      ),
    [repositoryId, run],
  );

  const retry = useCallback(
    (taskId: string) => run(() => retryQaTask(taskId)),
    [run],
  );

  const drop = useCallback(
    (taskId: string) => run(() => dropQaTask(taskId)),
    [run],
  );

  const workingTask = useMemo(
    () => tasks.find((t) => t.status === "working") ?? null,
    [tasks],
  );

  return { tasks, workingTask, pending, error, add, retry, drop, refresh };
}
