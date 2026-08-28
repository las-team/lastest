"use client";

import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  Compass,
  ListTodo,
  Network,
  Play,
  UserRound,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { timeAgo } from "@/lib/utils";
import type {
  Escalation,
  FleetAgentKind,
  FleetRow,
  FleetState,
  FleetSummary,
} from "@/lib/agents/fleet";

const KIND_ICONS: Record<FleetAgentKind, typeof Bot> = {
  qa: Bot,
  ranger: Play,
  play: Play,
  quickstart: Bot,
  explorer: Compass,
};

const STATE_META: Record<
  FleetState,
  { label: string; dot: string; text: string; pulse: boolean }
> = {
  working: {
    label: "Working",
    dot: "bg-info",
    text: "text-info",
    pulse: true,
  },
  blocked: {
    label: "Blocked on you",
    dot: "bg-warning",
    text: "text-warning",
    pulse: true,
  },
  paused: {
    label: "Paused",
    dot: "bg-warning",
    text: "text-warning",
    pulse: false,
  },
  idle: {
    label: "Idle",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    pulse: false,
  },
};

function StatusDot({ state }: { state: FleetState }) {
  const meta = STATE_META[state];
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {meta.pulse && (
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${meta.dot}`}
        />
      )}
      <span
        className={`relative inline-flex rounded-full h-2.5 w-2.5 ${meta.dot}`}
      />
    </span>
  );
}

function FleetRowItem({ row }: { row: FleetRow }) {
  const Icon = KIND_ICONS[row.kind];
  const meta = STATE_META[row.state];
  const blocked = row.state === "blocked";
  return (
    <Link
      href={row.href}
      className={`flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50 ${
        blocked ? "border-warning/40 bg-warning/5" : ""
      }`}
    >
      <StatusDot state={row.state} />
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{row.label}</span>
          <span className={`text-xs ${meta.text}`}>{meta.label}</span>
          {row.role && (
            <Badge variant="outline" className="text-[10px] px-1.5">
              {row.role}
            </Badge>
          )}
          {row.holdsBrowser && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 text-muted-foreground"
              title="Holding an embedded browser from the pool"
            >
              browser
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {row.narration ??
            (row.state === "idle"
              ? "Idle — open to give it something to do"
              : "Starting up…")}
        </div>
      </div>
      {row.progress !== null && row.state !== "idle" && (
        <div className="hidden w-28 shrink-0 sm:block">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[11px] text-muted-foreground">
              {row.startedAt ? timeAgo(row.startedAt) : ""}
            </span>
            <span className="font-mono text-[11px] font-medium">
              {row.progress}%
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-primary/20">
            <div
              className="h-full bg-primary"
              style={{ width: `${row.progress}%` }}
            />
          </div>
        </div>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </Link>
  );
}

function SettledRow({
  entry,
}: {
  entry: {
    id: string;
    kind: FleetAgentKind;
    status: string;
    completedAt: Date | null;
  };
}) {
  const ok = entry.status === "completed";
  return (
    <div className="flex items-center gap-2 py-1.5 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className="font-medium">{entry.kind}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {entry.status}
      </span>
      {entry.completedAt && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {timeAgo(entry.completedAt)}
        </span>
      )}
    </div>
  );
}

export function AgentsConsole({
  repositoryName,
  rows,
  summary,
  escalations,
  settled,
  queuedCount,
  runUsage,
}: {
  repositoryName: string;
  rows: FleetRow[];
  summary: FleetSummary;
  escalations: Escalation[];
  settled: Array<{
    id: string;
    kind: FleetAgentKind;
    status: string;
    completedAt: Date | null;
  }>;
  queuedCount: number;
  runUsage: { used: number; quota: number } | null;
}) {
  const minutePct =
    runUsage && runUsage.quota > 0
      ? Math.min(100, Math.round((runUsage.used / runUsage.quota) * 100))
      : null;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Network className="h-6 w-6" />
              Agents
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every agent working{" "}
              <span className="font-mono text-foreground">
                {repositoryName}
              </span>{" "}
              — what it is doing, and what it needs from you. Open one for its
              full workspace.
            </p>
          </div>
        </header>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-info" />
              <span className="font-semibold">{summary.working}</span>
              <span className="text-muted-foreground">working</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-warning" />
              <span className="font-semibold">{summary.blocked}</span>
              <span className="text-muted-foreground">blocked on you</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
              <span className="font-semibold">
                {summary.idle + summary.paused}
              </span>
              <span className="text-muted-foreground">at rest</span>
            </span>
            {/* Derived from run state, not read back from the EB pool — see
                `FleetSummary.browsersHeld`. Labelled as an estimate so the
                number is not mistaken for live pool capacity. */}
            <span
              className="text-muted-foreground"
              title="Estimated from what each agent is doing — not read from the browser pool."
            >
              <span className="font-semibold text-foreground">
                ~{summary.browsersHeld}
              </span>{" "}
              browser{summary.browsersHeld === 1 ? "" : "s"} held (est.)
            </span>
            {minutePct !== null && runUsage && (
              <span className="flex items-center gap-2 text-muted-foreground">
                Run minutes
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-primary/20">
                  <span
                    className="block h-full bg-primary"
                    style={{ width: `${minutePct}%` }}
                  />
                </span>
                <span className="font-mono text-xs font-medium text-foreground">
                  {runUsage.used} / {runUsage.quota}
                </span>
              </span>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardContent className="space-y-2 pt-0">
              <div className="flex items-center gap-2 pb-1">
                <span className="text-base font-semibold">Fleet</span>
                <span className="text-sm text-muted-foreground">
                  {rows.length} agent{rows.length === 1 ? "" : "s"}
                </span>
              </div>
              {rows.map((row) => (
                <FleetRowItem key={row.id} row={row} />
              ))}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className={escalations.length > 0 ? "border-warning/40" : ""}>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-warning" />
                  <span className="text-sm font-semibold">Waiting on you</span>
                  {escalations.length > 0 && (
                    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1.5 font-mono text-[10px] font-semibold text-white">
                      {escalations.length}
                    </span>
                  )}
                </div>
                {escalations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing is blocked. Agents will queue a question here when
                    they hit one.
                  </p>
                ) : (
                  escalations.map((e) => (
                    <Link
                      key={e.id}
                      href={e.href}
                      className="block rounded-md border p-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{e.label}</span>
                        {e.holdsBrowser && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 text-muted-foreground"
                          >
                            holding a browser
                          </Badge>
                        )}
                        {e.since && (
                          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                            {timeAgo(e.since)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm">{e.question}</p>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2 pt-0">
                <div className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Next up</span>
                  <span className="text-sm text-muted-foreground">
                    {queuedCount} queued
                  </span>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7"
                  >
                    <Link href="/qa-agent">Open queue</Link>
                  </Button>
                </div>
                {queuedCount === 0 && (
                  <p className="text-sm text-muted-foreground">
                    The direction queue is empty.
                  </p>
                )}
              </CardContent>
            </Card>

            {settled.length > 0 && (
              <Card>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-2 pb-1">
                    <Circle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">
                      Recently settled
                    </span>
                  </div>
                  <div className="divide-y">
                    {settled.map((entry) => (
                      <SettledRow key={entry.id} entry={entry} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
