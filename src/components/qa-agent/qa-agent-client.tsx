"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  AgentSession,
  AgentStepState,
  QaRunMode,
  QaTestGroup,
} from "@/lib/db/schema";
import { QA_GROUPS } from "@/lib/qa-agent/plan";
import { useQaAgent } from "./use-qa-agent";
import { QaPlanReview } from "./qa-plan-review";
import { QaGeneratedTestsPanel, QaSummaryPanel } from "./qa-results-panel";
import { BrowserViewer } from "@/components/embedded-browser/browser-viewer-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle,
  Ban,
  Bot,
  CheckCircle2,
  Circle,
  CircleDashed,
  Github,
  Loader2,
  Lock,
  MonitorPlay,
  PackagePlus,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SkipForward,
  UserRound,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Status hero
// ---------------------------------------------------------------------------

const SESSION_STATUS_META: Record<
  AgentSession["status"],
  { label: string; className: string; spin?: boolean; icon: typeof Bot }
> = {
  active: {
    label: "Running",
    className: "bg-info/10 border-info/30 text-info",
    spin: true,
    icon: Loader2,
  },
  paused: {
    label: "Waiting for you",
    className: "bg-warning/10 border-warning/30 text-warning",
    icon: UserRound,
  },
  completed: {
    label: "Completed",
    className: "bg-success/10 border-success/30 text-success",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 border-destructive/30 text-destructive",
    icon: XCircle,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted border-border text-muted-foreground",
    icon: Ban,
  },
};

// ---------------------------------------------------------------------------
// Phase timeline
// ---------------------------------------------------------------------------

function StepDot({ step }: { step: AgentStepState }) {
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

const AGENT_BADGE_STYLES: Record<string, string> = {
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

function PhaseTimeline({ session }: { session: AgentSession }) {
  const activeStep = session.steps.find(
    (s) =>
      s.status === "active" ||
      s.status === "waiting_user" ||
      s.status === "failed",
  );
  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
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
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Setup form
// ---------------------------------------------------------------------------

const RUN_MODES: Array<{
  id: QaRunMode;
  label: string;
  description: string;
  /** Needs a previously stored plan. */
  needsPlan?: boolean;
}> = [
  {
    id: "full",
    label: "Full run",
    description: "Discover → plan → review → generate → run → heal → summary",
  },
  {
    id: "refresh_spec",
    label: "Refresh specification",
    description:
      "Re-discover the app and re-plan against the current suite (code or manual test changes) — no generation, ends with a covered-vs-gaps report",
  },
  {
    id: "fill_gaps",
    label: "Fill coverage gaps",
    description:
      "Reuse the latest plan and generate + run only the items not yet covered by an existing test",
    needsPlan: true,
  },
];

function SetupCard({
  defaultUrl,
  githubConnected,
  aiConfigured,
  hasStoredPlan,
  storedPlanInfo,
  hasExistingAuthSetup,
  loading,
  error,
  onStart,
}: {
  defaultUrl: string;
  githubConnected: boolean;
  aiConfigured: boolean;
  hasStoredPlan: boolean;
  storedPlanInfo: string | null;
  hasExistingAuthSetup: boolean;
  loading: boolean;
  error: string | null;
  onStart: (opts: {
    targetUrl: string;
    mode: QaRunMode;
    groups: QaTestGroup[];
    email?: string;
    password?: string;
    autoApprove?: boolean;
    allowRegistration?: boolean;
  }) => void;
}) {
  const [targetUrl, setTargetUrl] = useState(defaultUrl);
  const [mode, setMode] = useState<QaRunMode>("full");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [groups, setGroups] = useState<Set<QaTestGroup>>(
    () => new Set(QA_GROUPS.map((g) => g.id)),
  );

  const toggleGroup = (id: QaTestGroup) => {
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      next.add("journey");
      return next;
    });
  };

  const canStart =
    aiConfigured && /^https?:\/\/.+/i.test(targetUrl.trim()) && !loading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4" />
          Build a comprehensive test suite
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The QA agent discovers your app (source routes + live DOM), designs a
          risk-prioritized plan across the selected coverage groups, waits for
          your approval, then generates, runs, and heals the suite. Re-run it
          any time — repeat runs plan against the tests that already exist.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label>Run mode</Label>
          <div className="grid sm:grid-cols-3 gap-1.5">
            {RUN_MODES.map((m) => {
              const disabled = Boolean(m.needsPlan && !hasStoredPlan);
              const selected = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setMode(m.id)}
                  className={`rounded-md border p-2.5 text-left text-sm transition-colors ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span className="font-medium flex items-center gap-1.5">
                    {m.id === "full" && <Play className="h-3.5 w-3.5" />}
                    {m.id === "refresh_spec" && (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {m.id === "fill_gaps" && (
                      <PackagePlus className="h-3.5 w-3.5" />
                    )}
                    {m.label}
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {m.description}
                  </span>
                  {m.needsPlan && !hasStoredPlan && (
                    <span className="block text-[11px] text-warning mt-1">
                      Run full or refresh first to store a plan
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {mode === "fill_gaps" && storedPlanInfo && (
            <p className="text-xs text-muted-foreground">
              Using stored plan: {storedPlanInfo}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className={
              githubConnected
                ? "bg-success/10 text-success border-success/30"
                : "bg-muted text-muted-foreground"
            }
          >
            <Github className="h-3 w-3" />
            {githubConnected
              ? "GitHub connected — repo-aware discovery"
              : "GitHub not connected — live discovery only"}
          </Badge>
          {!aiConfigured && (
            <Badge
              variant="outline"
              className="bg-destructive/10 text-destructive border-destructive/30"
            >
              <AlertTriangle className="h-3 w-3" />
              No AI provider —{" "}
              <Link href="/settings" className="underline">
                configure in Settings
              </Link>
            </Badge>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="qa-url">Target app URL</Label>
          <Input
            id="qa-url"
            placeholder="https://your-app.example.com"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="qa-email" className="flex items-center gap-1.5">
              <Lock className="h-3 w-3" />
              Login email{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="qa-email"
              type="email"
              autoComplete="off"
              placeholder="qa@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-password">
              Password <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="qa-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-3">
          Credentials are encrypted at rest. The Login step verifies them live,
          captures the session, and runs discovery on the post-login state — any
          existing setup script or storage state is checked first.
        </p>
        {hasExistingAuthSetup && (
          <Badge
            variant="outline"
            className="bg-success/10 text-success border-success/30"
          >
            <Lock className="h-3 w-3" />
            Existing login setup detected — the agent will reuse it
          </Badge>
        )}

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">
              Allow the agent to register a test account
            </div>
            <div className="text-xs text-muted-foreground">
              Used only when no credentials or working setup exist and a sign-up
              page is discovered — creates a throwaway account on the target app
            </div>
          </div>
          <Switch
            checked={allowRegistration}
            onCheckedChange={setAllowRegistration}
          />
        </div>

        {mode !== "fill_gaps" && (
          <div className="space-y-1.5">
            <Label>Coverage groups</Label>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {QA_GROUPS.map((group) => (
                <label
                  key={group.id}
                  className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                    group.locked
                      ? "opacity-90"
                      : "cursor-pointer hover:bg-muted/50"
                  }`}
                >
                  <Checkbox
                    checked={groups.has(group.id)}
                    disabled={group.locked}
                    onCheckedChange={() => toggleGroup(group.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">
                      {group.label}
                      {group.locked && (
                        <span className="text-xs text-muted-foreground font-normal">
                          {" "}
                          (always on)
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {group.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {mode !== "fill_gaps" && (
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Auto-approve plan</div>
              <div className="text-xs text-muted-foreground">
                Skip the human review gate and continue immediately
              </div>
            </div>
            <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <Button
          disabled={!canStart}
          onClick={() =>
            onStart({
              targetUrl: targetUrl.trim(),
              mode,
              groups: [...groups],
              email: email.trim() || undefined,
              password: password || undefined,
              autoApprove,
              allowRegistration,
            })
          }
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Start QA agent
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------

export function QaAgentClient({
  repositoryId,
  repositoryName,
  defaultUrl,
  githubConnected,
  aiConfigured,
  hasStoredPlan,
  storedPlanInfo,
  hasExistingAuthSetup,
  initialSession,
}: {
  repositoryId: string;
  repositoryName: string;
  defaultUrl: string;
  githubConnected: boolean;
  aiConfigured: boolean;
  /** A prior run stored a plan — enables the "fill coverage gaps" mode. */
  hasStoredPlan: boolean;
  storedPlanInfo: string | null;
  /** Repo already has default setup steps or a storage state — the Login
   *  step will check/reuse them. */
  hasExistingAuthSetup: boolean;
  initialSession: AgentSession | null;
}) {
  const {
    session,
    loading,
    error,
    isRunning,
    isPaused,
    isTerminal,
    progress,
    start,
    approve,
    requestChanges,
    pause,
    resume,
    cancel,
    dismiss,
  } = useQaAgent(repositoryId, initialSession);

  const reviewStep = session?.steps.find((s) => s.id === "qa_plan_review");
  const awaitingReview = reviewStep?.status === "waiting_user";
  const plan = session?.metadata.qaPlan;
  const generated = useMemo(
    () => session?.metadata.qaGeneratedTests ?? [],
    [session?.metadata.qaGeneratedTests],
  );
  const summary = session?.metadata.qaSummary;
  const streamUrl = session?.metadata.streamUrl;
  const queuedForBrowser = session?.metadata.queuedForBrowser;

  if (!session) {
    return (
      <SetupCard
        defaultUrl={defaultUrl}
        githubConnected={githubConnected}
        aiConfigured={aiConfigured}
        hasStoredPlan={hasStoredPlan}
        storedPlanInfo={storedPlanInfo}
        hasExistingAuthSetup={hasExistingAuthSetup}
        loading={loading}
        error={error}
        onStart={start}
      />
    );
  }

  const statusMeta = SESSION_STATUS_META[session.status];
  const StatusIcon = statusMeta.icon;
  const planStepDone = session.steps.some(
    (s) => s.id === "qa_plan" && s.status === "completed",
  );

  return (
    <div className="space-y-4">
      {/* Status hero + controls */}
      <Card className={`border ${statusMeta.className}`}>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusIcon
              className={`h-5 w-5 ${statusMeta.spin ? "animate-spin" : ""}`}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                QA agent — {statusMeta.label}
                {awaitingReview && ": review the plan below"}
                {session.metadata.qaMode &&
                  session.metadata.qaMode !== "full" && (
                    <Badge
                      variant="outline"
                      className="ml-2 align-middle text-[10px] px-1.5"
                    >
                      {session.metadata.qaMode === "refresh_spec"
                        ? "spec refresh"
                        : "fill gaps"}
                    </Badge>
                  )}
              </div>
              <div className="text-xs opacity-80 truncate">
                {repositoryName} → {session.metadata.qaTargetUrl}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isRunning && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={pause}
                  disabled={loading}
                >
                  <Pause className="h-3.5 w-3.5" />
                  Pause
                </Button>
              )}
              {isPaused && !awaitingReview && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={resume}
                  disabled={loading}
                >
                  <Play className="h-3.5 w-3.5" />
                  Resume
                </Button>
              )}
              {(isRunning || isPaused) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={cancel}
                  disabled={loading}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
              {isTerminal && (
                <Button size="sm" variant="outline" onClick={dismiss}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  New run
                </Button>
              )}
            </div>
          </div>
          <Progress value={progress} className="mt-3 h-1.5" />
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <PhaseTimeline session={session} />

      {/* Live browser while an agent holds an EB */}
      {(streamUrl || queuedForBrowser) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MonitorPlay className="h-4 w-4" />
              Live browser
              <span className="text-xs font-normal text-muted-foreground">
                {queuedForBrowser
                  ? "waiting for a browser from the pool…"
                  : "watching the agent work"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {streamUrl ? (
              <BrowserViewer
                streamUrl={streamUrl}
                interactive={false}
                hideToolbar
                className="rounded-md overflow-hidden border"
              />
            ) : (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Waiting for an embedded browser…
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plan: interactive at the review gate, read-only afterwards */}
      {plan && (awaitingReview || planStepDone) && (
        <QaPlanReview
          key={awaitingReview ? "review" : "readonly"}
          plan={plan}
          readOnly={!awaitingReview}
          loading={loading}
          onApprove={approve}
          onRequestChanges={requestChanges}
        />
      )}

      {generated.length > 0 && <QaGeneratedTestsPanel generated={generated} />}

      {summary && <QaSummaryPanel summary={summary} plan={plan} />}
    </div>
  );
}
