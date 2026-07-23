"use client";

import { Badge } from "@/components/ui/badge";
import type { AgentStepState } from "@/lib/db/schema";
import {
  CheckCircle2,
  Circle,
  CircleDashed,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Explorer timeline: the linear setup/login prefix and keep/summary suffix
 * render as plain steps; the repeated research/plan/act/analyze entries are
 * grouped into one block per loop iteration.
 */

function StepIcon({ status }: { status: AgentStepState["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "active":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-600" />;
    case "skipped":
      return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground/50" />;
  }
}

function StepRow({ step }: { step: AgentStepState }) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          <StepIcon status={step.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm font-medium",
                step.status === "pending" && "text-muted-foreground",
                step.status === "skipped" &&
                  "text-muted-foreground line-through",
              )}
            >
              {step.label}
            </span>
            {step.status === "failed" && (
              <Badge variant="destructive" className="text-[10px]">
                failed
              </Badge>
            )}
          </div>
          {step.status === "pending" ? null : step.error ? (
            <p className="text-xs text-red-600 break-words">{step.error}</p>
          ) : step.result?.reason ? (
            <p className="text-xs text-muted-foreground">
              {String(step.result.reason)}
            </p>
          ) : null}
          {(step.substeps?.length ?? 0) > 0 && (
            <ul className="mt-1 space-y-0.5">
              {step.substeps!.map((sub, i) => (
                <li
                  key={i}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  {sub.status === "running" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : sub.status === "done" ? (
                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                  ) : sub.status === "error" ? (
                    <XCircle className="h-3 w-3 text-red-500" />
                  ) : (
                    <Circle className="h-3 w-3 opacity-40" />
                  )}
                  <span className="truncate">{sub.label}</span>
                  {sub.detail && (
                    <span className="truncate opacity-70">— {sub.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function ExplorerTimeline({ steps }: { steps: AgentStepState[] }) {
  const prefix = steps.filter((s) => s.iteration === undefined);
  const loops = new Map<number, AgentStepState[]>();
  for (const step of steps) {
    if (step.iteration === undefined) continue;
    const group = loops.get(step.iteration) ?? [];
    group.push(step);
    loops.set(step.iteration, group);
  }

  const linearHead = prefix.filter((s) =>
    ["explorer_setup", "explorer_login"].includes(s.id),
  );
  const linearTail = prefix.filter((s) =>
    ["explorer_keep", "explorer_summary"].includes(s.id),
  );

  return (
    <div className="space-y-3">
      {linearHead.map((step, i) => (
        <StepRow key={`head-${i}`} step={step} />
      ))}
      {Array.from(loops.entries()).map(([iteration, group]) => {
        const allPending = group.every((s) => s.status === "pending");
        const allSkipped = group.every((s) => s.status === "skipped");
        return (
          <div
            key={`loop-${iteration}`}
            className={cn(
              "rounded-md border p-3 space-y-2",
              allPending && "opacity-50",
              allSkipped && "opacity-40",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Iteration {iteration + 1}
              </span>
              {allSkipped && (
                <Badge variant="outline" className="text-[10px]">
                  skipped
                </Badge>
              )}
            </div>
            <div className="space-y-2">
              {group.map((step, i) => (
                <StepRow key={`it${iteration}-${i}`} step={step} />
              ))}
            </div>
          </div>
        );
      })}
      {linearTail.map((step, i) => (
        <StepRow key={`tail-${i}`} step={step} />
      ))}
    </div>
  );
}
