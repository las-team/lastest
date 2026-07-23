"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Radar, Square, X } from "lucide-react";
import { useQaAgent } from "@/components/qa-agent/use-qa-agent";
import { BrowserViewer } from "@/components/embedded-browser/browser-viewer-client";
import { cancelQaAgent } from "@/server/actions/qa-agent";
import type { QaExplorerState } from "@/lib/db/schema";

const STATUS_DOT: Record<QaExplorerState["status"], string> = {
  claiming: "bg-muted-foreground/50",
  exploring: "bg-sky-500 animate-pulse",
  blocked: "bg-amber-500",
  done: "bg-emerald-500",
  failed: "bg-red-500",
};

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Floating live-progress panel for an exploration run: per-explorer cards
 * (status dot, pages-mapped counter, current URL, live EB screencast
 * thumbnail), amber BLOCKED rows, and header totals with a Stop button.
 * State comes from the same 2s /api/qa-agent/[sessionId] polling the QA
 * agent page uses.
 */
export function ExploreProgressPanel({
  sessionId,
  repositoryId,
  onFinished,
  onClose,
}: {
  sessionId: string;
  repositoryId: string;
  /** The session reached a terminal state (completed/failed/cancelled). */
  onFinished: () => void;
  /** Hide the panel without stopping the run. */
  onClose: () => void;
}) {
  const { session, attach, isTerminal } = useQaAgent(repositoryId, null);
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    attach(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (isTerminal) onFinished();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTerminal]);

  const explore = session?.metadata.qaExplore;
  const startedMs = explore ? new Date(explore.startedAt).getTime() : now;
  const budgetMs = explore
    ? new Date(explore.deadlineAt).getTime() - startedMs
    : 0;

  const stop = async () => {
    setStopping(true);
    try {
      await cancelQaAgent(sessionId);
      onFinished();
    } catch {
      setStopping(false);
    }
  };

  return (
    <div className="absolute bottom-3 left-3 z-20 w-80 overflow-hidden rounded-lg border bg-card/95 shadow-xl backdrop-blur">
      {/* Header totals */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Radar className="h-4 w-4 animate-pulse text-primary" />
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-semibold">
            {explore?.pagesDiscovered ?? 0} screen
            {(explore?.pagesDiscovered ?? 0) === 1 ? "" : "s"} found
          </span>
          <span className="text-muted-foreground">
            {" "}
            · {formatClock(now - startedMs)} / {formatClock(budgetMs)}
          </span>
        </div>
        <button
          type="button"
          onClick={stop}
          disabled={stopping}
          className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium hover:bg-muted disabled:opacity-60"
          title="Stop the exploration"
        >
          {stopping ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Square className="h-3 w-3" />
          )}
          Stop
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted"
          title="Hide (keeps exploring)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-96 space-y-2 overflow-y-auto p-2">
        {!explore && (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…
          </div>
        )}

        {/* Per-explorer cards */}
        {explore?.explorers.map((e) => (
          <div key={e.index} className="rounded-md border bg-background p-2">
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[e.status]}`}
              />
              <span className="font-medium">Explorer {e.index + 1}</span>
              <span className="text-muted-foreground">{e.status}</span>
              <span className="ml-auto text-muted-foreground">
                {e.pagesMapped} page{e.pagesMapped === 1 ? "" : "s"}
              </span>
            </div>
            {e.currentUrl && (
              <div
                className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                title={e.currentUrl}
              >
                {e.currentUrl}
              </div>
            )}
            {e.detail && e.status === "failed" && (
              <div className="mt-1 text-[10px] text-red-500">{e.detail}</div>
            )}
            {e.streamUrl && e.status === "exploring" && (
              <div className="mt-1.5 overflow-hidden rounded border">
                <BrowserViewer
                  streamUrl={e.streamUrl}
                  interactive={false}
                  hideToolbar
                  className="max-h-32"
                />
              </div>
            )}
          </div>
        ))}

        {/* BLOCKED rows */}
        {explore && explore.blocked.length > 0 && (
          <div className="space-y-1">
            {explore.blocked.map((b, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="font-medium uppercase">
                  {b.reason === "auth_wall" ? "Auth wall" : "Dead end"}
                </span>
                <span
                  className="min-w-0 flex-1 truncate font-mono"
                  title={b.url}
                >
                  {b.url}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
