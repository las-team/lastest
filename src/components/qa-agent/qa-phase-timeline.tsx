"use client";

import type { AgentSession, AgentStepState } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDashed,
  Loader2,
  Lock,
  SkipForward,
  UserRound,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Phase timeline (shared by the active-run view and expanded history rows)
// ---------------------------------------------------------------------------

export function StepDot({ step }: { step: AgentStepState }) {
  switch (step.status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case "active":
      return <Loader2 className="h-4 w-4 text-info animate-spin" />;
    case "waiting_user":
      return <UserRound className="h-4 w-4 text-warning" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "skipped":
      return <SkipForward className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground/40" />;
  }
}

export const AGENT_BADGE_STYLES: Record<string, string> = {
  orchestrator: "bg-primary/10 text-primary border-primary/30",
  planner: "bg-info/10 text-info border-info/30",
  scout: "bg-success/10 text-success border-success/30",
  ranger: "bg-success/10 text-success border-success/30",
  generator: "bg-warning/10 text-warning border-warning/30",
  healer: "bg-destructive/10 text-destructive border-destructive/30",
};

function SubstepRow({
  substep,
}: {
  substep: NonNullable<AgentStepState["substeps"]>[number];
}) {
  return (
    <div className="flex items-start gap-2 text-sm py-0.5">
      <span className="mt-0.5 shrink-0">
        {substep.status === "running" ? (
          <Loader2 className="h-3.5 w-3.5 text-info animate-spin" />
        ) : substep.status === "done" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        ) : substep.status === "error" ? (
          <XCircle className="h-3.5 w-3.5 text-destructive" />
        ) : (
          <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
      </span>
      {substep.agent && (
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 shrink-0 ${AGENT_BADGE_STYLES[substep.agent] ?? ""}`}
        >
          {substep.agent}
        </Badge>
      )}
      <span className="min-w-0">
        <span className="truncate">{substep.label}</span>
        {substep.detail && (
          <span className="block text-xs text-muted-foreground truncate">
            {substep.detail}
          </span>
        )}
      </span>
      {substep.durationMs !== undefined && (
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {(substep.durationMs / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

export function PhaseTimeline({
  session,
  bare = false,
}: {
  session: AgentSession;
  /** Render without the Card wrapper (inside an expanded history row). */
  bare?: boolean;
}) {
  const activeStep = session.steps.find(
    (s) =>
      s.status === "active" ||
      s.status === "waiting_user" ||
      s.status === "failed",
  );
  const body = (
    <>
      <div className="flex items-start gap-0 overflow-x-auto pb-1">
        {session.steps.map((step, i) => (
          <div key={step.id} className="flex items-start min-w-0">
            {i > 0 && (
              <div
                className={`h-px w-5 sm:w-8 mt-2 shrink-0 ${
                  step.status === "pending" ? "bg-border" : "bg-success/50"
                }`}
              />
            )}
            <div
              className="flex flex-col items-center gap-1 px-1 min-w-14"
              title={step.description}
            >
              <StepDot step={step} />
              <span
                className={`text-[11px] leading-tight text-center ${
                  step.status === "active" || step.status === "waiting_user"
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                }`}
              >
                {step.id === "qa_login" && (
                  <Lock className="inline h-3 w-3 mr-0.5 align-[-1px]" />
                )}
                {step.label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {activeStep && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <StepDot step={activeStep} />
            {activeStep.label}
            <span className="font-normal text-muted-foreground text-xs">
              {activeStep.description}
            </span>
          </div>
          {activeStep.error && (
            <div className="flex items-start gap-1.5 text-sm text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {activeStep.error}
            </div>
          )}
          {activeStep.result?.manual === true && (
            <div className="mt-2 space-y-2 rounded-md border border-warning/40 bg-warning/5 p-2">
              <div className="text-xs font-medium">Proceed manually</div>
              {typeof activeStep.result.manualHint === "string" && (
                <p className="text-xs text-muted-foreground">
                  {activeStep.result.manualHint}
                </p>
              )}
              {typeof activeStep.result.rawOutput === "string" && (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    Raw planner output
                  </div>
                  <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-snug whitespace-pre-wrap break-words">
                    {activeStep.result.rawOutput}
                  </pre>
                </div>
              )}
            </div>
          )}
          {(activeStep.substeps?.length ?? 0) > 0 && (
            <div className="max-h-56 overflow-y-auto">
              {activeStep.substeps!.map((substep, i) => (
                <SubstepRow key={`${substep.label}-${i}`} substep={substep} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );

  if (bare) return <div className="space-y-4">{body}</div>;
  return (
    <Card>
      <CardContent className="pt-4 space-y-4">{body}</CardContent>
    </Card>
  );
}
