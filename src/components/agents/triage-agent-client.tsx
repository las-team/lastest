"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronRight,
  GitBranch,
  Loader2,
  Play,
  Stethoscope,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { timeAgo } from "@/lib/utils";
import { sessionNarration, sessionProgress } from "@/lib/agents/fleet";
import type { AgentSession } from "@/lib/db/schema";
import {
  runTriageForBuild,
  setTriageAgentEnabled,
} from "@/server/actions/triage";

/**
 * The Triage agent's home page body.
 *
 * The agent's real workspace is the per-build Run Results screen
 * (`/triage-agent/[buildId]`); this page is the way in — what it is doing right
 * now, whether it runs itself, and which builds it has already classified.
 */

/** One row in "Recent triage runs" — flattened server-side so this component
 *  never touches the DB row shapes. */
export interface TriageRunRow {
  triageRunId: string;
  buildId: string;
  status: string;
  headline: string | null;
  caseCount: number;
  groupCount: number;
  decidedCount: number;
  at: Date | string | null;
  gitBranch: string | null;
  gitCommit: string | null;
  failedCount: number | null;
}

export interface TriageLatestBuild {
  id: string;
  gitBranch: string | null;
  failedCount: number | null;
  changesDetected: number | null;
  createdAt: Date | string | null;
  alreadyTriaged: boolean;
}

/** Why the auto-triage toggle is locked, or null when it is settable. */
export type TriageLockReason = "plan" | "ai_off" | null;

const LOCK_COPY: Record<"plan" | "ai_off", string> = {
  plan: "Automatic triage is part of the Pro plan. The agent still classifies nothing until your team upgrades.",
  ai_off:
    "In-product AI is turned off for this team, so the agent has no model to classify with. Turn it on in Settings → AI.",
};

function LiveState({ session }: { session: AgentSession }) {
  const narration = sessionNarration(session);
  const progress = sessionProgress(session);
  return (
    <div className="flex items-center gap-3 rounded-md border border-info/40 bg-info/5 p-3">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-info" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Triaging now</div>
        <div className="truncate text-xs text-muted-foreground">
          {narration ?? "Starting up…"}
        </div>
      </div>
      <span className="font-mono text-xs font-medium">{progress}%</span>
    </div>
  );
}

function RunRow({ run }: { run: TriageRunRow }) {
  const open = Math.max(0, run.caseCount - run.decidedCount);
  return (
    <Link
      href={`/triage-agent/${run.buildId}`}
      className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
    >
      <Stethoscope className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">
            {run.headline ?? `Build ${run.buildId.slice(0, 8)}`}
          </span>
          {run.status !== "completed" && (
            <Badge variant="outline" className="px-1.5 text-[10px]">
              {run.status}
            </Badge>
          )}
          {open === 0 && run.caseCount > 0 && (
            <Badge variant="outline" className="px-1.5 text-[10px]">
              all resolved
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {run.gitBranch && (
            <span className="inline-flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              <span className="font-mono">{run.gitBranch}</span>
            </span>
          )}
          {run.gitCommit && (
            <span className="font-mono">{run.gitCommit.slice(0, 7)}</span>
          )}
          <span>
            {run.groupCount} group{run.groupCount === 1 ? "" : "s"} ·{" "}
            {run.caseCount} case{run.caseCount === 1 ? "" : "s"} ·{" "}
            {run.decidedCount}/{run.caseCount} resolved
          </span>
        </div>
      </div>
      {run.at && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {timeAgo(new Date(run.at))}
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </Link>
  );
}

export function TriageAgentClient({
  repositoryId,
  initialEnabled,
  lockReason,
  initialSession,
  runs,
  latestBuild,
}: {
  repositoryId: string;
  initialEnabled: boolean;
  lockReason: TriageLockReason;
  initialSession: AgentSession | null;
  runs: TriageRunRow[];
  latestBuild: TriageLatestBuild | null;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState<AgentSession | null>(initialSession);
  const [triaging, setTriaging] = useState(false);

  const live = session?.status === "active";

  // Poll the live session so the header narrates progress without a reload —
  // same envelope as the QA agent's `/api/qa-agent/[sessionId]`.
  useEffect(() => {
    if (!live || !session) return;
    const id = session.id;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/triage-agent/${id}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        setSession((await res.json()) as AgentSession);
      } catch {
        // Transient — the next tick retries.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [live, session]);

  const toggle = useCallback(
    async (next: boolean) => {
      // Optimistic: the switch is a single boolean, so a failed write just
      // snaps back rather than needing a dirty/Save dance.
      setEnabled(next);
      setSaving(true);
      try {
        const res = await setTriageAgentEnabled(repositoryId, next);
        if (!res.ok) throw new Error(res.error ?? "Failed to save");
        toast.success(
          next ? "Auto-triage on" : "Auto-triage off — run it manually instead",
        );
      } catch (err) {
        setEnabled(!next);
        toast.error(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [repositoryId],
  );

  const triageLatest = useCallback(async () => {
    if (!latestBuild) return;
    setTriaging(true);
    try {
      const res = await runTriageForBuild(latestBuild.id, { force: true });
      if (!res.ok) throw new Error(res.error ?? "Triage failed to start");
      toast.success("Triage started for the latest build");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Triage failed");
    } finally {
      setTriaging(false);
    }
  }, [latestBuild]);

  const locked = lockReason !== null;

  return (
    <div className="space-y-4">
      {session && live && <LiveState session={session} />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Stethoscope className="h-4 w-4" />
            Automatic triage
            <span className="text-xs font-normal text-muted-foreground">
              — classify every build that finishes with failures or changes
            </span>
            <span className="ml-auto flex items-center gap-2">
              {saving && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* A disabled Switch swallows pointer events, so the
                        trigger wraps it in a span that still gets them. */}
                    <span className="inline-flex">
                      <Switch
                        checked={enabled && !locked}
                        disabled={locked || saving}
                        aria-label="Run triage automatically"
                        onCheckedChange={(v) => void toggle(v)}
                      />
                    </span>
                  </TooltipTrigger>
                  {locked && (
                    <TooltipContent side="left" className="max-w-xs">
                      {LOCK_COPY[lockReason]}
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            When a build finishes with failures or visual changes, the agent
            collects every case, clusters them by root cause, and writes a
            verdict suggestion per cluster — so you review a handful of causes
            instead of a wall of diffs.
          </p>
          {locked && (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {LOCK_COPY[lockReason]}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={!latestBuild || triaging || locked}
              onClick={() => void triageLatest()}
            >
              {triaging ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Triage latest build
            </Button>
            {latestBuild ? (
              <span className="text-xs text-muted-foreground">
                {latestBuild.gitBranch && (
                  <span className="font-mono">{latestBuild.gitBranch}</span>
                )}
                {latestBuild.createdAt && (
                  <> · {timeAgo(new Date(latestBuild.createdAt))}</>
                )}
                {" · "}
                {latestBuild.failedCount ?? 0} failed,{" "}
                {latestBuild.changesDetected ?? 0} changed
                {latestBuild.alreadyTriaged && " · already triaged, re-runs it"}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                No build to triage yet.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent triage runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {runs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nothing triaged yet. Triage runs automatically when a build
              finishes with failures or visual changes — turn on{" "}
              <span className="font-medium text-foreground">
                Automatic triage
              </span>{" "}
              above, or classify the latest build by hand with{" "}
              <span className="font-medium text-foreground">
                Triage latest build
              </span>
              .
            </div>
          ) : (
            runs.map((run) => <RunRow key={run.triageRunId} run={run} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
