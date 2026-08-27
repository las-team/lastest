"use client";

import type {
  QaSessionRow as AgentSession,
  QaStepId as AgentStepId,
  QaStepState as AgentStepState,
} from "../types";
import { QA_PHASES } from "../phases";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  Loader2,
  Lock,
  Map as MapIcon,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Pipeline strip — the run's phases as one connected track across the top of
// the console. Reads a live session when there is one, the newest settled run
// otherwise, and falls back to the (dimmed) pipeline shape before a repo has
// ever run the agent.
// ---------------------------------------------------------------------------

const PHASE_ICONS: Record<string, typeof Search> = {
  qa_setup: ShieldCheck,
  qa_login: Lock,
  qa_discover: Search,
  qa_plan: MapIcon,
  qa_plan_review: CheckCircle2,
  qa_generate: Sparkles,
  qa_execute: Play,
  qa_heal: Wrench,
  qa_summary: FileCheck2,
};

/** Short per-phase result line, read from the payload the step itself wrote
 *  (`setStepCompleted` in the QA server action). Absent until it exists — the
 *  strip never guesses a count. */
function phaseDetail(step: AgentStepState): string | null {
  const result = step.result ?? {};
  const num = (key: string): number | null =>
    typeof result[key] === "number" ? (result[key] as number) : null;
  const str = (key: string): string | null =>
    typeof result[key] === "string" ? (result[key] as string) : null;

  switch (step.id) {
    case "qa_login":
      return str("strategy");
    case "qa_discover": {
      const routes = num("staticRoutes");
      const pages = num("pagesCrawled");
      if (routes !== null) return `${routes} routes`;
      return pages === null ? null : `${pages} pages`;
    }
    case "qa_plan": {
      const items = num("items");
      return items === null ? null : `${items} items`;
    }
    case "qa_plan_review":
      if (step.status === "waiting_user") return "needs you";
      return step.status === "completed"
        ? (step.userAction ?? "approved")
        : null;
    case "qa_generate": {
      const generated = num("generated");
      return generated === null ? null : `${generated} specs`;
    }
    case "qa_execute": {
      const passed = num("passed");
      const total = num("total");
      if (passed === null) return null;
      return total === null ? `${passed} passing` : `${passed} / ${total} pass`;
    }
    case "qa_heal": {
      const healed = num("healed");
      return healed === null ? null : `${healed} healed`;
    }
    case "qa_summary": {
      const passed = num("passed");
      return passed === null ? null : `${passed} passing`;
    }
    default:
      return null;
  }
}

type NodeTone =
  | "done"
  | "active"
  | "waiting"
  | "failed"
  | "skipped"
  | "pending";

function toneOf(status: AgentStepState["status"]): NodeTone {
  switch (status) {
    case "completed":
      return "done";
    case "active":
      return "active";
    case "waiting_user":
      return "waiting";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

const NODE_TONE: Record<
  NodeTone,
  { cell: string; icon: string; label: string }
> = {
  done: {
    cell: "bg-success/5",
    icon: "bg-success/15 text-success",
    label: "text-foreground",
  },
  active: {
    cell: "bg-info/5 ring-1 ring-inset ring-info/25 border-info/40",
    icon: "bg-info/15 text-info",
    label: "text-info",
  },
  waiting: {
    cell: "bg-warning/5 ring-1 ring-inset ring-warning/25 border-warning/40",
    icon: "bg-warning/15 text-warning",
    label: "text-warning",
  },
  failed: {
    cell: "bg-destructive/5 border-destructive/40",
    icon: "bg-destructive/15 text-destructive",
    label: "text-destructive",
  },
  skipped: {
    cell: "",
    icon: "bg-muted text-muted-foreground/60",
    label: "text-muted-foreground/60",
  },
  pending: {
    cell: "",
    icon: "bg-muted text-muted-foreground/60",
    label: "text-muted-foreground/60",
  },
};

/** The pipeline shape with nothing run yet — every phase pending. */
function skeletonSteps(): AgentStepState[] {
  return QA_PHASES.map((phase) => ({
    id: phase.id,
    status: "pending" as const,
    label: phase.label,
    description: phase.description,
  }));
}

export function QaPipelineStrip({
  session,
  className = "",
}: {
  /** Live session, else the newest settled run, else null (never ran). */
  session: AgentSession | null;
  className?: string;
}) {
  const steps = session?.steps?.length ? session.steps : skeletonSteps();

  return (
    <div className={`flex items-stretch overflow-x-auto ${className}`}>
      {steps.map((step, i) => {
        const tone = NODE_TONE[toneOf(step.status)];
        const Icon = PHASE_ICONS[step.id as AgentStepId] ?? ShieldCheck;
        const detail = phaseDetail(step);
        const first = i === 0;
        const last = i === steps.length - 1;
        return (
          <div
            key={step.id}
            title={step.description}
            className={`relative flex min-w-28 flex-1 flex-col gap-1.5 border border-border p-3 ${
              last ? "" : "border-r-0"
            } ${first ? "rounded-l-md" : ""} ${last ? "rounded-r-md" : ""} ${tone.cell}`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-md ${tone.icon}`}
            >
              {step.status === "active" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : step.status === "waiting_user" ? (
                <UserRound className="h-3.5 w-3.5" />
              ) : step.status === "failed" ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
            </span>
            <span className={`text-xs font-semibold ${tone.label}`}>
              {step.label}
            </span>
            <span className="min-h-4 truncate text-[10px] text-muted-foreground">
              {detail ?? " "}
            </span>
            {!last && (
              <span className="absolute -right-2.5 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
