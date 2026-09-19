"use client";

/**
 * The flow rail — nine steps down the left of the console.
 *
 * The rail is the screen's spine: it is always visible, it is the only
 * navigation, and its dots are the only place the flow's state is expressed.
 * A stage is clickable even when locked — you should be able to READ what
 * cutover will involve long before you can run it — and the lock shows up on
 * the panel's button with the reason, not as an unreachable rail item.
 */

import { cn } from "@lastest/ui";
import { Check, Loader2, Lock, AlertTriangle, Circle } from "lucide-react";
import { STAGE_DEFINITIONS } from "../flow";
import type { MigrationStage, StageState } from "../flow";

const DOT: Record<
  StageState["status"],
  { icon: typeof Check; ring: string; fill: string; label: string }
> = {
  done: {
    icon: Check,
    ring: "ring-emerald-500/40",
    fill: "bg-emerald-500 text-white",
    label: "done",
  },
  running: {
    icon: Loader2,
    ring: "ring-primary/40",
    fill: "bg-primary text-primary-foreground",
    label: "running",
  },
  attention: {
    icon: AlertTriangle,
    ring: "ring-amber-500/40",
    fill: "bg-amber-500 text-white",
    label: "needs attention",
  },
  ready: {
    icon: Circle,
    ring: "ring-primary/30",
    fill: "bg-background text-primary border border-primary",
    label: "ready",
  },
  locked: {
    icon: Lock,
    ring: "ring-transparent",
    fill: "bg-muted text-muted-foreground",
    label: "locked",
  },
};

export function StageRail({
  stages,
  current,
  onSelect,
}: {
  stages: StageState[];
  current: MigrationStage;
  onSelect: (stage: MigrationStage) => void;
}) {
  return (
    <nav aria-label="Migration steps" className="relative">
      {/* The spine. Sits behind the dots and stops one dot short at each end so
          it reads as a connector rather than an overrun rule. */}
      <span
        aria-hidden
        className="absolute left-[15px] top-5 bottom-5 w-px bg-border"
      />
      <ol className="space-y-1">
        {stages.map((state, i) => {
          const def = STAGE_DEFINITIONS[i];
          const dot = DOT[state.status];
          const Icon = dot.icon;
          const active = current === state.key;
          return (
            <li key={state.key}>
              <button
                type="button"
                onClick={() => onSelect(state.key)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "relative w-full text-left rounded-md pl-9 pr-3 py-2 transition-colors",
                  active ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "absolute left-[6px] top-[9px] flex h-[19px] w-[19px] items-center justify-center rounded-full ring-4 ring-background",
                    dot.fill,
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3 w-3",
                      state.status === "running" && "animate-spin",
                      state.status === "ready" && "h-1.5 w-1.5 fill-current",
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "block text-sm leading-tight",
                    active ? "font-semibold" : "font-medium",
                    state.status === "locked" &&
                      !active &&
                      "text-muted-foreground",
                  )}
                >
                  {def.label}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {state.status === "locked" ? "locked" : dot.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
