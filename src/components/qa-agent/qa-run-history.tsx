"use client";

import { useState } from "react";
import type { AgentSession, QaSessionTrigger } from "@/lib/db/schema";
import { timeAgo } from "@/lib/utils";
import { PhaseTimeline } from "./qa-phase-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Ban,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  ListTodo,
  Loader2,
  Play,
  Plug,
  RotateCcw,
  UserRound,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Run history — every run collapsed to a headline, expandable, re-runnable
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<
  AgentSession["status"],
  { icon: typeof CheckCircle2; className: string; spin?: boolean }
> = {
  active: { icon: Loader2, className: "text-info", spin: true },
  paused: { icon: UserRound, className: "text-warning" },
  completed: { icon: CheckCircle2, className: "text-success" },
  failed: { icon: XCircle, className: "text-destructive" },
  cancelled: { icon: Ban, className: "text-muted-foreground" },
};

const TRIGGER_META: Record<
  QaSessionTrigger,
  { label: string; icon: typeof UserRound }
> = {
  manual: { label: "manual", icon: UserRound },
  task: { label: "task", icon: ListTodo },
  rerun: { label: "re-run", icon: RotateCcw },
  schedule: { label: "schedule", icon: History },
  pr: { label: "PR", icon: Play },
  mcp: { label: "via MCP", icon: Plug },
};

const MODE_LABEL: Record<string, string> = {
  full: "full",
  refresh_spec: "spec refresh",
  fill_gaps: "fill gaps",
};

/** One-line outcome for a collapsed run row. */
function headline(session: AgentSession): string {
  const s = session.metadata.qaSummary;
  if (session.status === "completed" && s) {
    const parts = [`${s.planned} planned`];
    if (s.covered > 0) parts.push(`${s.covered} covered`);
    if (s.generated > 0) parts.push(`${s.generated} generated`);
    parts.push(`${s.passed} passing`);
    return parts.join(" · ");
  }
  if (session.status === "completed") return "Completed";
  if (session.status === "cancelled") return "Cancelled";
  if (session.status === "failed") {
    const step = session.steps.find((st) => st.status === "failed");
    return step ? `Failed at ${step.label}` : "Failed";
  }
  const current = session.steps.find(
    (st) => st.status === "active" || st.status === "waiting_user",
  );
  return current ? `Running — ${current.label}` : "Running";
}

function durationOf(session: AgentSession): string | null {
  if (!session.createdAt || !session.completedAt) return null;
  const ms =
    new Date(session.completedAt).getTime() -
    new Date(session.createdAt).getTime();
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function RunRow({
  session,
  isLive,
  loading,
  onRerun,
}: {
  session: AgentSession;
  /** This row is the currently-running session (shown expanded above). */
  isLive: boolean;
  loading: boolean;
  onRerun: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_ICON[session.status];
  const StatusIcon = status.icon;
  const trigger = TRIGGER_META[session.metadata.qaTrigger ?? "manual"];
  const TriggerIcon = trigger.icon;
  const duration = durationOf(session);

  return (
    <div className="text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-2 min-w-0 flex-1 text-left group"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <StatusIcon
            className={`h-4 w-4 shrink-0 ${status.className} ${status.spin ? "animate-spin" : ""}`}
          />
          <span className="min-w-0 truncate group-hover:underline underline-offset-2">
            {headline(session)}
          </span>
        </button>
        <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">
          {MODE_LABEL[session.metadata.qaMode ?? "full"]}
        </Badge>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 gap-1 shrink-0 text-muted-foreground"
          title={`Triggered by ${trigger.label}`}
        >
          <TriggerIcon className="h-3 w-3" />
          {trigger.label}
        </Badge>
        {isLive && (
          <Badge className="text-[10px] px-1.5 shrink-0 bg-info/15 text-info border-info/30">
            live
          </Badge>
        )}
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {duration && `${duration} · `}
          {timeAgo(session.createdAt)}
        </span>
        {!isLive && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 shrink-0"
            title="Re-run with the same configuration"
            disabled={loading}
            onClick={() => onRerun(session.id)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="rounded-md border bg-muted/20 p-3 space-y-2">
            <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 shrink-0" />
              {session.metadata.qaTargetUrl}
              {(session.metadata.qaDocs?.length ?? 0) > 0 &&
                ` · ${session.metadata.qaDocs!.length} doc${
                  session.metadata.qaDocs!.length === 1 ? "" : "s"
                }`}
            </div>
            <PhaseTimeline session={session} bare />
          </div>
        </div>
      )}
    </div>
  );
}

export function QaRunHistory({
  sessions,
  liveSessionId,
  loading,
  onRerun,
}: {
  sessions: AgentSession[];
  liveSessionId: string | null;
  loading: boolean;
  onRerun: (sessionId: string) => void;
}) {
  if (sessions.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Runs
          <span className="text-xs font-normal text-muted-foreground">
            — every run collapses to a headline; expand for the step trail, or
            re-run it with the same configuration
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="rounded-md border divide-y">
          {sessions.map((session) => (
            <RunRow
              key={session.id}
              session={session}
              isLive={session.id === liveSessionId}
              loading={loading}
              onRerun={onRerun}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
