"use client";

import type { AgentSession, QaTask } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Ban,
  Bot,
  ChevronDown,
  ChevronUp,
  ListTodo,
  Pause,
  Play,
  Plug,
  Plus,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Agent status header — identity, live state, narration, controls
// ---------------------------------------------------------------------------

type AgentState = "working" | "waiting" | "paused" | "idle";

const STATE_META: Record<
  AgentState,
  { label: string; dotClass: string; pulse: boolean; textClass: string }
> = {
  working: {
    label: "Working",
    dotClass: "bg-info",
    pulse: true,
    textClass: "text-info",
  },
  waiting: {
    label: "Waiting for you",
    dotClass: "bg-warning",
    pulse: true,
    textClass: "text-warning",
  },
  paused: {
    label: "Paused",
    dotClass: "bg-warning",
    pulse: false,
    textClass: "text-warning",
  },
  idle: {
    label: "Idle",
    dotClass: "bg-muted-foreground/50",
    pulse: false,
    textClass: "text-muted-foreground",
  },
};

function StatusDot({ state }: { state: AgentState }) {
  const meta = STATE_META[state];
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {meta.pulse && (
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${meta.dotClass}`}
        />
      )}
      <span
        className={`relative inline-flex rounded-full h-2.5 w-2.5 ${meta.dotClass}`}
      />
    </span>
  );
}

/** Current one-line narration for a running session: the active step plus its
 *  freshest running substep. */
function sessionNarration(session: AgentSession): string | null {
  const step = session.steps.find(
    (s) => s.status === "active" || s.status === "waiting_user",
  );
  if (!step) return null;
  const running = [...(step.substeps ?? [])]
    .reverse()
    .find((s) => s.status === "running");
  if (running) {
    return `${step.label} — ${running.detail ?? running.label}`;
  }
  return `${step.label} — ${step.description}`;
}

export function QaAgentHeader({
  repositoryName,
  session,
  awaitingReview,
  workingTask,
  externalActivity,
  progress,
  loading,
  setupOpen,
  canStartRun,
  onToggleSetup,
  onPause,
  onResume,
  onCancel,
}: {
  repositoryName: string;
  /** The live (active/paused) session, or null when the agent is idle. */
  session: AgentSession | null;
  awaitingReview: boolean;
  /** Task from the direction queue the agent is currently working, if any. */
  workingTask: QaTask | null;
  /** Most recent activity from ANOTHER agent (MCP, quickstart…) on this repo,
   *  shown so the header reflects external agents driving the platform. */
  externalActivity: { summary: string; sourceLabel: string } | null;
  progress: number;
  loading: boolean;
  setupOpen: boolean;
  canStartRun: boolean;
  onToggleSetup: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const isRunning = session?.status === "active";
  const isPaused = session?.status === "paused";
  const state: AgentState = isRunning
    ? "working"
    : awaitingReview
      ? "waiting"
      : isPaused
        ? "paused"
        : "idle";
  const meta = STATE_META[state];

  const narration = session
    ? awaitingReview
      ? "The test plan is ready — review it below"
      : (sessionNarration(session) ?? "Starting up…")
    : "Ready — start a run, or drop a task in the queue below";

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-medium">
              QA agent
              <span
                className={`flex items-center gap-1.5 text-xs font-medium ${meta.textClass}`}
              >
                <StatusDot state={state} />
                {meta.label}
              </span>
              {session?.metadata.qaMode &&
                session.metadata.qaMode !== "full" && (
                  <Badge variant="outline" className="text-[10px] px-1.5">
                    {session.metadata.qaMode === "refresh_spec"
                      ? "spec refresh"
                      : "fill gaps"}
                  </Badge>
                )}
              {workingTask && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 gap-1 bg-primary/5 border-primary/30 max-w-56"
                  title={workingTask.title}
                >
                  <ListTodo className="h-3 w-3 shrink-0" />
                  <span className="truncate">{workingTask.title}</span>
                </Badge>
              )}
            </div>
            <div
              className="text-xs text-muted-foreground truncate"
              title={narration}
            >
              {narration}
              {session?.metadata.qaTargetUrl && (
                <span className="opacity-70">
                  {" "}
                  · {repositoryName} → {session.metadata.qaTargetUrl}
                </span>
              )}
            </div>
            {externalActivity && (
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-info truncate">
                <Plug className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {externalActivity.sourceLabel}: {externalActivity.summary}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Button
                size="sm"
                variant="outline"
                onClick={onPause}
                disabled={loading}
              >
                <Pause className="h-3.5 w-3.5" />
                Pause
              </Button>
            )}
            {isPaused && !awaitingReview && (
              <Button
                size="sm"
                variant="outline"
                onClick={onResume}
                disabled={loading}
              >
                <Play className="h-3.5 w-3.5" />
                Resume
              </Button>
            )}
            {(isRunning || isPaused) && (
              <Button
                size="sm"
                variant="outline"
                onClick={onCancel}
                disabled={loading}
              >
                <Ban className="h-3.5 w-3.5" />
                Cancel
              </Button>
            )}
            {!session && canStartRun && (
              <Button size="sm" variant="outline" onClick={onToggleSetup}>
                {setupOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                New run
                {!setupOpen && <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
        </div>
        {(isRunning || isPaused) && (
          <Progress value={progress} className="h-1.5" />
        )}
        <div className="text-[11px] text-muted-foreground">
          Triggers: manual runs · task queue · re-runs — PR and schedule
          triggers are coming next
        </div>
      </CardContent>
    </Card>
  );
}
