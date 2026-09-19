"use client";

/**
 * Chrome shared by all nine stage panels.
 *
 * Every stage is the same shape — what this step is, the exact command it
 * corresponds to, one primary action, then the results of the last time it ran
 * — and that repetition is the point: once you have read one panel you can
 * operate all of them. The pieces live here so a stage body is only its own
 * content.
 */

import { useState } from "react";
import { cn } from "@lastest/ui";
import { Button } from "@lastest/ui";
import { Badge } from "@lastest/ui";
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  Play,
  Terminal,
} from "lucide-react";
import { timeAgo } from "@lastest/ui";
import type { StageDefinition, StageState } from "../flow";
import type { MigrationRun } from "../schema";

export function PanelShell({
  def,
  state,
  command,
  children,
  actions,
}: {
  def: StageDefinition;
  state: StageState;
  /** The resolved command line (wave and freeze substituted), or null. */
  command: string | null;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="space-y-5 min-w-0">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">
              {def.label}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-3xl">
              {def.blurb}
            </p>
          </div>
          {actions && (
            <div className="shrink-0 flex items-center gap-2">{actions}</div>
          )}
        </div>
        {command && <CommandLine command={command} />}
        {state.status === "locked" && state.blockedReason && (
          <p className="text-xs text-muted-foreground">{state.blockedReason}</p>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * The CLI equivalent of the button beside it.
 *
 * Not decoration: this tool is a CLI first, every run is auditable from a
 * terminal, and a regulated programme will want the command in a change
 * record. Showing it also means the console never becomes the only way to
 * understand what it did.
 */
export function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs overflow-x-auto">
      <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <code className="flex-1 whitespace-pre">{command}</code>
      <button
        type="button"
        aria-label="Copy command"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          navigator.clipboard?.writeText(command).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => {},
          );
        }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

export function RunButton({
  label,
  state,
  pending,
  onRun,
  variant = "default",
}: {
  label: string;
  state: StageState;
  pending: boolean;
  onRun: () => void;
  variant?: "default" | "outline" | "destructive";
}) {
  const disabled =
    pending || state.status === "locked" || state.status === "running";
  return (
    <Button
      onClick={onRun}
      disabled={disabled}
      variant={variant}
      title={state.status === "locked" ? state.blockedReason : undefined}
    >
      {pending || state.status === "running" ? (
        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
      ) : (
        <Play className="h-4 w-4 mr-1.5" />
      )}
      {state.status === "running" ? "Running…" : label}
    </Button>
  );
}

/**
 * "Last run: init · 4 minutes ago · exit 0" — the panel's provenance line,
 * plus the run's error when it has one.
 *
 * The error belongs HERE rather than only on the run page: a run that died
 * during wiring produces no findings and no unit rows, so without it the panel
 * below would be empty and the emptiness would read as a pass.
 */
export function LastRunLine({ run }: { run: MigrationRun | null }) {
  if (!run) {
    return (
      <p className="text-xs text-muted-foreground">
        This step has not run yet.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <RunStatusBadge status={run.status} />
        <span className="font-mono">{run.mode}</span>
        {run.dryRun && <Badge variant="outline">dry run</Badge>}
        <span>{run.startedAt ? timeAgo(run.startedAt) : ""}</span>
        {typeof run.summary?.exitCode === "number" && (
          <span className="font-mono">exit {run.summary.exitCode}</span>
        )}
        {run.countries.length > 0 && (
          <span className="font-mono">{run.countries.join(", ")}</span>
        )}
      </div>
      {run.error && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
          <span>{run.error}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Did this run get far enough for its empty tables to mean anything?
 *
 * A finished run with no findings is good news. A run that never reached the
 * target has no findings either, and saying "no findings" about it would be a
 * lie the operator acts on.
 */
export function runProduced(run: MigrationRun | null): boolean {
  return Boolean(run) && run!.status !== "failed" && run!.status !== "aborted";
}

export function RunStatusBadge({ status }: { status: MigrationRun["status"] }) {
  const map: Record<
    MigrationRun["status"],
    { label: string; className: string }
  > = {
    queued: { label: "queued", className: "bg-muted text-muted-foreground" },
    running: {
      label: "running",
      className: "bg-primary text-primary-foreground",
    },
    succeeded: { label: "succeeded", className: "bg-emerald-600 text-white" },
    // `blocked` is exit 2 — the run completed and refused. Amber, not red: the
    // tool did its job, the config did not.
    blocked: { label: "blocked", className: "bg-amber-500 text-white" },
    failed: { label: "failed", className: "bg-destructive text-white" },
    aborted: { label: "aborted", className: "bg-muted text-muted-foreground" },
  };
  const s = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}

/** A labelled block of numbers — the roll-up above every unit table. */
export function StatRow({
  stats,
}: {
  stats: Array<{
    label: string;
    value: number | string;
    tone?: "bad" | "good" | "muted";
  }>;
}) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px rounded-md border bg-border overflow-hidden">
      {stats.map((s) => (
        <div key={s.label} className="bg-card px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {s.label}
          </dt>
          <dd
            className={cn(
              "font-mono tabular-nums text-lg leading-tight",
              s.tone === "bad" && Number(s.value) > 0 && "text-destructive",
              s.tone === "good" && "text-emerald-600",
              s.tone === "muted" && "text-muted-foreground",
            )}
          >
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
