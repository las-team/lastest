"use client";

import { useEffect, useState } from "react";
import type { QaSummaryData } from "@lastest/eb-protocol";
import type { QaSessionRow as AgentSession } from "../types";
// Activity rows arrive narrowed — `ActivityEvent` is core's row type and a
// plugin may not import it (recipe §6.1); `QaFeedEvent` is the slice read here.
import type { QaFeedEvent } from "./use-activity-events";
import type { QaTriggerState } from "./qa-trigger-config";
import { timeAgo } from "./format";
import { Card } from "@lastest/ui";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Clock,
  GitPullRequest,
  Hand,
  ListTodo,
  Radar,
  Rss,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Bento tiles for the QA agent console — each one reads live session, coverage,
// trigger or activity state. Every number here comes from the store; a tile
// with nothing to say says so rather than inventing a figure.
// ---------------------------------------------------------------------------

export function Tile({
  eyebrow,
  icon: Icon,
  className = "",
  children,
}: {
  eyebrow: string;
  icon: typeof Activity;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`gap-0 p-4 ${className}`}>
      <div className="mb-2.5 flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {eyebrow}
      </div>
      {children}
    </Card>
  );
}

/** Client-only clock. Null until mount, so anything derived from "now"
 *  (countdowns, relative times) renders identically on the server. */
function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Deliberate first paint from the server value, then the client clock.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Elapsed clock for the running phase — ticks client-side from a timestamp. */
function Elapsed({ since }: { since: string }) {
  const now = useNow(1000);
  const started = new Date(since).getTime();
  if (now === null || !Number.isFinite(started)) return null;
  const secs = Math.max(0, Math.floor((now - started) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <span className="font-mono tabular-nums">
      {mm}:{ss}
    </span>
  );
}

export function DoingNowTile({
  session,
  awaitingReview,
}: {
  /** The live (active/paused) session, or null when the agent is idle. */
  session: AgentSession | null;
  awaitingReview: boolean;
}) {
  const step = session?.steps.find(
    (s) => s.status === "active" || s.status === "waiting_user",
  );
  const substep = step
    ? [...(step.substeps ?? [])].reverse().find((s) => s.status === "running")
    : undefined;

  return (
    <Tile eyebrow="Doing now" icon={Activity}>
      {step ? (
        <>
          <div
            className={`text-sm font-semibold ${
              awaitingReview ? "text-warning" : "text-info"
            }`}
          >
            {step.label}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {substep?.detail ?? substep?.label ?? step.description}
          </p>
          {step.startedAt && (
            <div className="mt-auto pt-2 text-[11px] text-muted-foreground">
              running <Elapsed since={step.startedAt} />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="text-sm font-semibold text-muted-foreground">
            Idle
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Nothing running. Start a run, or drop a task in the direction queue
            — the agent picks it up on its own.
          </p>
        </>
      )}
    </Tile>
  );
}

export function CoverageTile({
  summary,
  updatedAt,
}: {
  summary: QaSummaryData | null;
  updatedAt?: Date | string | null;
}) {
  // Hydration guard: timeAgo() drifts between server render and client mount.
  const mounted = useNow(60_000) !== null;

  if (!summary) {
    return (
      <Tile eyebrow="Coverage" icon={ShieldCheck}>
        <div className="text-sm font-semibold text-muted-foreground">
          No plan yet
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Coverage appears after the first run produces a plan and a summary.
        </p>
      </Tile>
    );
  }

  const covered = summary.covered ?? 0;
  const done = covered + summary.generated;
  const gaps = Math.max(0, summary.planned - done);
  const pct =
    summary.planned > 0 ? Math.round((done / summary.planned) * 100) : 0;

  return (
    <Tile eyebrow="Coverage" icon={ShieldCheck}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tracking-tight tabular-nums text-success">
          {pct}%
        </span>
        <span className="text-xs text-muted-foreground">covered</span>
      </div>
      <div className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <span className="h-full bg-success" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {done} / {summary.planned} planned · {covered} existing ·{" "}
        {summary.generated} generated · {summary.passed} passing · {gaps} gap
        {gaps === 1 ? "" : "s"}
      </div>
      {updatedAt && mounted && (
        <div className="mt-auto pt-2 text-[10px] text-muted-foreground">
          updated {timeAgo(new Date(updatedAt))}
        </div>
      )}
    </Tile>
  );
}

/** Countdown to the next automated run, or the queue depth when the only
 *  thing due is user-queued work. */
export function UpNextTile({
  trigger,
  queuedCount,
}: {
  trigger: QaTriggerState;
  queuedCount: number;
}) {
  const now = useNow(30_000);

  const nextRun =
    trigger.scheduleEnabled && trigger.nextRunAt
      ? new Date(trigger.nextRunAt)
      : null;
  const modeLabel =
    trigger.scheduleMode === "fill_gaps"
      ? "fill coverage gaps"
      : trigger.scheduleMode === "refresh_spec"
        ? "refresh the specification"
        : "full run";

  return (
    <Tile eyebrow="Up next" icon={Clock}>
      {nextRun && now !== null ? (
        <>
          <div className="text-xl font-bold tracking-tight text-info">
            {nextRun.getTime() > now
              ? `in ${formatUntil(nextRun, now)}`
              : "due now"}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Scheduled run — <span className="text-foreground">{modeLabel}</span>{" "}
            · <span className="font-mono">{trigger.cronExpression}</span>
          </p>
        </>
      ) : queuedCount > 0 ? (
        <>
          <div className="text-xl font-bold tracking-tight text-info tabular-nums">
            {queuedCount} queued
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            The agent works the direction queue as soon as it is free.
          </p>
        </>
      ) : (
        <>
          <div className="text-sm font-semibold text-muted-foreground">
            Nothing scheduled
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Turn on a schedule or PR trigger below to let the agent run itself.
          </p>
        </>
      )}
    </Tile>
  );
}

function formatUntil(when: Date, now: number): string {
  const mins = Math.max(0, Math.round((when.getTime() - now) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function WatchingTile({
  trigger,
  githubConnected,
}: {
  trigger: QaTriggerState;
  githubConnected: boolean;
}) {
  const chips: Array<{ icon: typeof Radar; label: string }> = [];
  if (trigger.prEnabled) chips.push({ icon: GitPullRequest, label: "on PR" });
  if (trigger.scheduleEnabled)
    chips.push({ icon: CalendarClock, label: trigger.cronExpression });
  chips.push({ icon: Hand, label: "manual runs" });
  chips.push({ icon: ListTodo, label: "task queue" });

  return (
    <Tile eyebrow="Watching" icon={Radar}>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip.label}
            className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info"
          >
            <chip.icon className="h-3 w-3" />
            {chip.label}
          </span>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {trigger.prEnabled
          ? "Re-discovers changed routes on every pull request."
          : githubConnected
            ? "Connect a PR trigger below to re-check coverage on every pull request."
            : "Connect GitHub to let the agent react to pull requests."}
      </p>
    </Tile>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  play_agent: "Play agent",
  mcp_server: "MCP agent",
  generate_agent: "Generator",
  heal_agent: "Healer",
  qa_agent: "QA agent",
  explorer_agent: "Explorer",
};

/** Icon + tone per event family — keyed on the event type's verb. */
function eventTone(event: QaFeedEvent): {
  icon: typeof CheckCircle2;
  className: string;
} {
  const type = event.eventType;
  if (type.endsWith(":error") || type.endsWith(":failed")) {
    return { icon: XCircle, className: "bg-destructive/10 text-destructive" };
  }
  if (type.startsWith("heal") || type.includes("fix")) {
    return { icon: Wrench, className: "bg-warning/15 text-warning" };
  }
  if (type.endsWith(":complete") || type.includes("pass")) {
    return { icon: CheckCircle2, className: "bg-success/15 text-success" };
  }
  return { icon: Activity, className: "bg-info/10 text-info" };
}

export function LiveActivityTile({
  events,
  className = "",
}: {
  /** Newest last — seeded server-side, extended live over SSE. */
  events: QaFeedEvent[];
  className?: string;
}) {
  // Hydration guard for the relative timestamps.
  const mounted = useNow(60_000) !== null;
  const recent = [...events].reverse().slice(0, 8);

  return (
    <Tile eyebrow="Live activity" icon={Rss} className={className}>
      {recent.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No agent activity on this repo yet.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {recent.map((event) => {
            const tone = eventTone(event);
            const Icon = tone.icon;
            return (
              <div key={event.id} className="flex gap-2.5 py-2">
                <span
                  className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md ${tone.className}`}
                >
                  <Icon className="h-3 w-3" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs leading-snug text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {SOURCE_LABELS[event.sourceType] ?? event.sourceType}
                    </span>{" "}
                    {event.summary}
                  </div>
                  {event.createdAt && mounted && (
                    <div className="mt-0.5 font-mono text-[9.5px] uppercase text-muted-foreground/70">
                      {timeAgo(new Date(event.createdAt))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Tile>
  );
}
