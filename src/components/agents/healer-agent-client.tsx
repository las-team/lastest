"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  HeartPulse,
  Loader2,
  Play,
  Square,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { timeAgo } from "@/lib/utils";
import { sessionNarration, sessionProgress } from "@/lib/agents/fleet";
import type {
  AgentSession,
  HealerOutcome,
  HealerOutcomeKind,
} from "@/lib/db/schema";
import { HEALER_LIMITS } from "@/lib/healer/limits";
import {
  runHealerForBuild,
  setHealerAgentEnabled,
  setHealerLimits,
  stopHealerCampaign,
} from "@/server/actions/healer";

/**
 * The Healer agent's home page body: the automation switch, the two budgets,
 * what it is doing right now, and every campaign it ran with a per-test
 * ledger — including what it refused to touch and why.
 */

export interface HealerCampaignRow {
  sessionId: string;
  buildId: string | null;
  status: string;
  rounds: number;
  outcomes: HealerOutcome[];
  at: Date | string | null;
  gitBranch: string | null;
  gitCommit: string | null;
}

export interface HealerLatestBuild {
  id: string;
  gitBranch: string | null;
  failedCount: number | null;
  createdAt: Date | string | null;
}

export type HealerLockReason = "plan" | "ai_off" | "triage_off" | null;

const LOCK_COPY: Record<Exclude<HealerLockReason, null>, string> = {
  plan: "The Healer is part of the Pro plan. It repairs nothing until your team upgrades.",
  ai_off:
    "In-product AI is turned off for this team, so the Healer has no model to patch with. Turn it on in Settings → AI.",
  triage_off:
    "The Healer needs the Triage agent on — it only repairs failures triage has classified as a test problem. Switch on Automatic triage first.",
};

const OUTCOME_META: Record<
  HealerOutcomeKind,
  { label: string; tone: "good" | "bad" | "muted" | "warn" }
> = {
  healed: { label: "Healed", tone: "good" },
  still_failing: { label: "Still failing", tone: "bad" },
  heal_failed: { label: "Heal failed", tone: "bad" },
  skipped_real_bug: { label: "Real bug — left red", tone: "warn" },
  skipped_environment: { label: "Environment — left alone", tone: "warn" },
  skipped_unclassified: { label: "Unclassified — skipped", tone: "muted" },
  skipped_human_verdict: { label: "Human verdict — skipped", tone: "muted" },
  skipped_budget: { label: "Budget exhausted", tone: "bad" },
  skipped_cap: { label: "Over per-build cap", tone: "muted" },
};

const TONE_CLASS: Record<"good" | "bad" | "muted" | "warn", string> = {
  good: "text-success",
  bad: "text-destructive",
  muted: "text-muted-foreground",
  warn: "text-warning",
};

function OutcomeIcon({ kind }: { kind: HealerOutcomeKind }) {
  const tone = OUTCOME_META[kind].tone;
  const cls = `h-3.5 w-3.5 shrink-0 ${TONE_CLASS[tone]}`;
  if (kind === "healed") return <CheckCircle2 className={cls} />;
  if (kind === "skipped_real_bug" || kind === "skipped_environment")
    return <Bug className={cls} />;
  if (tone === "bad") return <XCircle className={cls} />;
  return <ChevronRight className={cls} />;
}

function LiveState({
  session,
  onStop,
  stopping,
}: {
  session: AgentSession;
  onStop: () => void;
  stopping: boolean;
}) {
  const narration = sessionNarration(session);
  const progress = sessionProgress(session);
  const rounds = session.metadata.healerRounds ?? 0;
  return (
    <div className="flex items-center gap-3 rounded-md border border-info/40 bg-info/5 p-3">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-info" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          Healing now{rounds > 0 && ` · round ${rounds}`}
          {session.metadata.queuedForBrowser && " · waiting for a browser"}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {narration ?? "Starting up…"}
        </div>
      </div>
      <span className="font-mono text-xs font-medium">{progress}%</span>
      <Button
        size="sm"
        variant="outline"
        disabled={stopping}
        onClick={onStop}
        aria-label="Stop the campaign"
      >
        {stopping ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Square className="h-3.5 w-3.5" />
        )}
        Stop
      </Button>
    </div>
  );
}

function CampaignRow({ row }: { row: HealerCampaignRow }) {
  const [open, setOpen] = useState(false);
  const healed = row.outcomes.filter((o) => o.outcome === "healed").length;
  const bugs = row.outcomes.filter(
    (o) =>
      o.outcome === "skipped_real_bug" || o.outcome === "skipped_environment",
  ).length;
  const needsHuman = row.outcomes.filter(
    (o) =>
      o.outcome === "still_failing" ||
      o.outcome === "heal_failed" ||
      o.outcome === "skipped_budget",
  ).length;
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50"
      >
        <HeartPulse className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">
              {row.buildId
                ? `Build ${row.buildId.slice(0, 8)}`
                : `Campaign ${row.sessionId.slice(0, 8)}`}
            </span>
            {row.status !== "completed" && (
              <Badge variant="outline" className="px-1.5 text-[10px]">
                {row.status}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {row.gitBranch && (
              <span className="inline-flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                <span className="font-mono">{row.gitBranch}</span>
              </span>
            )}
            {row.gitCommit && (
              <span className="font-mono">{row.gitCommit.slice(0, 7)}</span>
            )}
            <span>
              <span className={TONE_CLASS.good}>{healed} healed</span> ·{" "}
              <span className={TONE_CLASS.warn}>{bugs} left red</span> ·{" "}
              <span className={TONE_CLASS.bad}>{needsHuman} need you</span> ·{" "}
              {row.rounds} round{row.rounds === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {row.at && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {timeAgo(new Date(row.at))}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul className="divide-y border-t">
          {row.outcomes.length === 0 && (
            <li className="p-3 text-xs text-muted-foreground">
              No failed tests in this build.
            </li>
          )}
          {row.outcomes.map((o) => (
            <li
              key={`${row.sessionId}:${o.testId}`}
              className="flex items-start gap-2 p-3 text-xs"
            >
              <OutcomeIcon kind={o.outcome} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/tests/${o.testId}`}
                    className="truncate font-medium hover:underline"
                  >
                    {o.testName}
                  </Link>
                  <span className={TONE_CLASS[OUTCOME_META[o.outcome].tone]}>
                    {OUTCOME_META[o.outcome].label}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {o.attempts} attempt{o.attempts === 1 ? "" : "s"}
                  </span>
                </div>
                {o.detail && (
                  <div className="mt-0.5 text-muted-foreground">{o.detail}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HealerAgentClient({
  repositoryId,
  initialEnabled,
  initialLimits,
  lockReason,
  initialSession,
  campaigns,
  latestBuild,
}: {
  repositoryId: string;
  initialEnabled: boolean;
  initialLimits: { maxAttemptsPerTest: number; maxTestsPerBuild: number };
  lockReason: HealerLockReason;
  initialSession: AgentSession | null;
  campaigns: HealerCampaignRow[];
  latestBuild: HealerLatestBuild | null;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [limits, setLimits] = useState(initialLimits);
  const [savingLimits, setSavingLimits] = useState(false);
  const [session, setSession] = useState<AgentSession | null>(initialSession);
  const [healing, setHealing] = useState(false);
  const [stopping, setStopping] = useState(false);

  const live = session?.status === "active";

  useEffect(() => {
    if (!live || !session) return;
    const id = session.id;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/healer-agent/${id}`, {
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
      setEnabled(next);
      setSaving(true);
      try {
        const res = await setHealerAgentEnabled(repositoryId, next);
        if (!res.ok) throw new Error(res.error ?? "Failed to save");
        toast.success(
          next
            ? "Auto-heal on — runs after triage on every failing build"
            : "Auto-heal off — run it manually instead",
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

  const limitsDirty =
    limits.maxAttemptsPerTest !== initialLimits.maxAttemptsPerTest ||
    limits.maxTestsPerBuild !== initialLimits.maxTestsPerBuild;

  const saveLimits = useCallback(async () => {
    setSavingLimits(true);
    try {
      const res = await setHealerLimits(repositoryId, limits);
      if (!res.ok) throw new Error(res.error ?? "Failed to save");
      toast.success("Healer budgets saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingLimits(false);
    }
  }, [repositoryId, limits]);

  const healLatest = useCallback(async () => {
    if (!latestBuild) return;
    setHealing(true);
    try {
      const res = await runHealerForBuild(latestBuild.id);
      if (!res.ok) throw new Error(res.error ?? "Healer failed to start");
      toast.success("Healing campaign started for the latest build");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Healer failed");
    } finally {
      setHealing(false);
    }
  }, [latestBuild]);

  const stop = useCallback(async () => {
    if (!session) return;
    setStopping(true);
    try {
      const res = await stopHealerCampaign(session.id);
      if (!res.ok) throw new Error(res.error ?? "Could not stop");
      toast.success("Stopping after the current test");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not stop");
    } finally {
      setStopping(false);
    }
  }, [session]);

  const locked = lockReason !== null;

  return (
    <div className="space-y-4">
      {session && live && (
        <LiveState
          session={session}
          onStop={() => void stop()}
          stopping={stopping}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <HeartPulse className="h-4 w-4" />
            Automatic healing
            <span className="text-xs font-normal text-muted-foreground">
              — repair test problems after every build that fails
            </span>
            <span className="ml-auto flex items-center gap-2">
              {saving && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Switch
                        checked={enabled && !locked}
                        disabled={locked || saving}
                        aria-label="Heal failing tests automatically"
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
            After the Triage agent classifies a failing build, the Healer takes
            the failures marked <em>test maintenance</em> or <em>flaky</em>,
            inspects the live page, patches selectors and timing, re-runs the
            patched tests, and repeats while they still fail and budget remains.
            Real regressions, environment issues and anything unclassified are
            left exactly as they are, with the reason recorded. Every patch is a
            versioned <code>ai_fix</code> edit you can revert.
          </p>
          {locked && (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {LOCK_COPY[lockReason]}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="healer-attempts" className="text-xs">
                Max attempts per test
              </Label>
              <Input
                id="healer-attempts"
                type="number"
                min={HEALER_LIMITS.attempts.min}
                max={HEALER_LIMITS.attempts.max}
                value={limits.maxAttemptsPerTest}
                disabled={locked}
                onChange={(e) =>
                  setLimits((l) => ({
                    ...l,
                    maxAttemptsPerTest: Number(e.target.value),
                  }))
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Counted since the test last passed or was hand-edited; then it
                is handed to you instead.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="healer-cap" className="text-xs">
                Max tests per build
              </Label>
              <Input
                id="healer-cap"
                type="number"
                min={HEALER_LIMITS.tests.min}
                max={HEALER_LIMITS.tests.max}
                value={limits.maxTestsPerBuild}
                disabled={locked}
                onChange={(e) =>
                  setLimits((l) => ({
                    ...l,
                    maxTestsPerBuild: Number(e.target.value),
                  }))
                }
              />
              <p className="text-[11px] text-muted-foreground">
                A wall of red is a smell, not a queue — the rest waits for the
                next build.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant={limitsDirty ? "default" : "outline"}
              disabled={!limitsDirty || savingLimits || locked}
              onClick={() => void saveLimits()}
            >
              {savingLimits && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save budgets
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!latestBuild || healing || locked || live}
              onClick={() => void healLatest()}
            >
              {healing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Heal latest build
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
                {latestBuild.failedCount ?? 0} failed
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                No build to heal yet.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent campaigns</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {campaigns.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nothing healed yet. The Healer runs after triage on every build
              that fails — turn on{" "}
              <span className="font-medium text-foreground">
                Automatic healing
              </span>{" "}
              above, or start one by hand with{" "}
              <span className="font-medium text-foreground">
                Heal latest build
              </span>
              .
            </div>
          ) : (
            campaigns.map((row) => (
              <CampaignRow key={row.sessionId} row={row} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
