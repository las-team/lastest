"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type {
  ActivitySourceType,
  AgentSession,
  QaRunMode,
  QaTask,
  QaTestGroup,
} from "@/lib/db/schema";
import { QA_GROUPS } from "@/lib/qa-agent/plan";
import { useQaAgent } from "./use-qa-agent";
import { useQaTasks } from "./use-qa-tasks";
import { useActivityFeed } from "@/components/activity-feed/use-activity-feed";
import { QaAgentHeader } from "./qa-agent-header";
import { PhaseTimeline } from "./qa-phase-timeline";
import { QaPlanReview } from "./qa-plan-review";
import { QaGeneratedTestsPanel, QaSummaryPanel } from "./qa-results-panel";
import type { CoverageRequestHint } from "./qa-results-panel";
import { BrowserViewer } from "@/components/embedded-browser/browser-viewer-client";
import { QaTaskBoard } from "./qa-task-board";
import { QaRunHistory } from "./qa-run-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle,
  Bot,
  FileText,
  Github,
  Loader2,
  Lock,
  MonitorPlay,
  PackagePlus,
  Play,
  RefreshCw,
  X,
} from "lucide-react";

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
    docs?: Array<{ name: string; contentBase64: string }>;
  }) => void;
}) {
  const [targetUrl, setTargetUrl] = useState(defaultUrl);
  const [mode, setMode] = useState<QaRunMode>("full");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [docs, setDocs] = useState<File[]>([]);
  const [groups, setGroups] = useState<Set<QaTestGroup>>(
    () => new Set(QA_GROUPS.map((g) => g.id)),
  );

  const addDocs = (files: FileList | null) => {
    if (!files) return;
    setDocs((prev) => {
      const next = [...prev];
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) continue;
        if (next.some((f) => f.name === file.name)) continue;
        next.push(file);
      }
      return next.slice(0, 5);
    });
  };

  const encodeDocs = async (): Promise<
    Array<{ name: string; contentBase64: string }>
  > => {
    const encoded: Array<{ name: string; contentBase64: string }> = [];
    for (const file of docs) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      encoded.push({ name: file.name, contentBase64: btoa(binary) });
    }
    return encoded;
  };

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
            <Label htmlFor="qa-docs" className="flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Product documentation{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="qa-docs"
              type="file"
              multiple
              accept=".md,.txt,.pdf,.docx"
              onChange={(e) => {
                addDocs(e.target.files);
                e.target.value = "";
              }}
            />
            {docs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {docs.map((file) => (
                  <Badge
                    key={file.name}
                    variant="outline"
                    className="gap-1 text-xs font-normal"
                  >
                    <FileText className="h-3 w-3" />
                    {file.name}
                    <button
                      type="button"
                      className="ml-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setDocs((prev) =>
                          prev.filter((f) => f.name !== file.name),
                        )
                      }
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Requirements, specs, or manuals (.md/.txt/.pdf/.docx, up to 5
              files). The planner treats them as authoritative for intended
              behavior — including flows the crawl can&apos;t reach. Only a
              condensed digest is stored.
            </p>
          </div>
        )}

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
          onClick={async () =>
            onStart({
              targetUrl: targetUrl.trim(),
              mode,
              groups: [...groups],
              email: email.trim() || undefined,
              password: password || undefined,
              autoApprove,
              allowRegistration,
              docs:
                mode !== "fill_gaps" && docs.length > 0
                  ? await encodeDocs()
                  : undefined,
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
// Main client — the ongoing agent management page
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<ActivitySourceType, string> = {
  play_agent: "Play agent",
  mcp_server: "MCP agent",
  generate_agent: "Generator agent",
  heal_agent: "Healer agent",
  qa_agent: "QA agent",
};

const EXTERNAL_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;

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
  recentSessions,
  initialTasks,
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
  /** Recent runs (any status), newest first — the run-history list. */
  recentSessions: AgentSession[];
  /** Direction-queue snapshot for the task board. */
  initialTasks: QaTask[];
}) {
  const {
    session,
    loading,
    error,
    progress,
    start,
    rerun,
    attach,
    approve,
    requestChanges,
    addJourneys,
    pause,
    resume,
    cancel,
  } = useQaAgent(repositoryId, initialSession);

  const {
    tasks,
    workingTask,
    pending: taskPending,
    error: taskError,
    add: addTask,
    retry: retryTask,
    drop: dropTask,
    refresh: refreshTasks,
  } = useQaTasks(repositoryId, initialTasks);

  // Team-wide live feed for this repo: powers the header narration for
  // task-run pickups and the "another agent is working via MCP" indicator.
  const { events } = useActivityFeed({ repoId: repositoryId });
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const [setupOpen, setSetupOpen] = useState(false);

  // A dispatcher-started task run isn't in this tab's polling loop yet —
  // attach as soon as the board reports its session id.
  const workingSessionId = workingTask?.sessionId;
  useEffect(() => {
    if (workingSessionId && workingSessionId !== session?.id) {
      attach(workingSessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingSessionId]);

  // Task events arrive over the feed faster than the board's poll — refresh.
  const lastEvent = events[events.length - 1];
  useEffect(() => {
    if (lastEvent?.eventType.startsWith("task:")) void refreshTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent?.id]);

  const liveSession =
    session && (session.status === "active" || session.status === "paused")
      ? session
      : null;

  const reviewStep = liveSession?.steps.find((s) => s.id === "qa_plan_review");
  const awaitingReview = reviewStep?.status === "waiting_user";
  const plan = liveSession?.metadata.qaPlan;
  const planStepDone = Boolean(
    liveSession?.steps.some(
      (s) => s.id === "qa_plan" && s.status === "completed",
    ),
  );
  const generated = useMemo(
    () => liveSession?.metadata.qaGeneratedTests ?? [],
    [liveSession?.metadata.qaGeneratedTests],
  );
  const streamUrl = liveSession?.metadata.streamUrl;
  const queuedForBrowser = liveSession?.metadata.queuedForBrowser;

  // Run history: the polled session is fresher than the server snapshot.
  const historySessions = useMemo(() => {
    const map = new Map<string, AgentSession>();
    if (session) map.set(session.id, session);
    for (const s of recentSessions) if (!map.has(s.id)) map.set(s.id, s);
    return [...map.values()].sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() -
        new Date(a.createdAt ?? 0).getTime(),
    );
  }, [session, recentSessions]);

  // Persistent coverage dashboard: the newest summary from any run.
  const coverageSource = useMemo(
    () => historySessions.find((s) => s.metadata.qaSummary),
    [historySessions],
  );

  // Most recent activity from another agent (MCP, quickstart…) on this repo.
  const externalActivity = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.sourceType === "qa_agent") continue;
      if (
        new Date(e.createdAt as unknown as string).getTime() <
        nowTick - EXTERNAL_ACTIVITY_WINDOW_MS
      ) {
        return null;
      }
      return {
        summary: e.summary,
        sourceLabel: SOURCE_LABELS[e.sourceType] ?? e.sourceType,
      };
    }
    return null;
  }, [events, nowTick]);

  const handleRequestCoverage = useCallback(
    (hint: CoverageRequestHint) => {
      const groupLabel = hint.group
        ? (QA_GROUPS.find((g) => g.id === hint.group)?.label ?? hint.group)
        : null;
      const title =
        hint.area && groupLabel
          ? `Increase coverage: ${hint.area} × ${groupLabel}`
          : "Increase overall coverage — close the current gaps";
      void addTask(title, { source: "coverage_gap" }).then((ok) => {
        if (ok) toast.success("Coverage task queued for the agent");
      });
    },
    [addTask],
  );

  const neverRan = historySessions.length === 0;
  const showSetup = !liveSession && (setupOpen || neverRan);

  return (
    <div className="space-y-4">
      <QaAgentHeader
        repositoryName={repositoryName}
        session={liveSession}
        awaitingReview={awaitingReview}
        workingTask={workingTask}
        externalActivity={externalActivity}
        progress={progress}
        loading={loading}
        setupOpen={showSetup}
        canStartRun={!neverRan}
        onToggleSetup={() => setSetupOpen((v) => !v)}
        onPause={pause}
        onResume={resume}
        onCancel={cancel}
      />

      {error && (
        <div className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {showSetup && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
          <SetupCard
            defaultUrl={defaultUrl}
            githubConnected={githubConnected}
            aiConfigured={aiConfigured}
            hasStoredPlan={hasStoredPlan}
            storedPlanInfo={storedPlanInfo}
            hasExistingAuthSetup={hasExistingAuthSetup}
            loading={loading}
            error={error}
            onStart={(opts) => {
              setSetupOpen(false);
              void start(opts);
            }}
          />
        </div>
      )}

      {/* Active run — collapses into history when it ends */}
      {liveSession && (
        <>
          <PhaseTimeline session={liveSession} />
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
          {plan && (awaitingReview || planStepDone) && (
            <QaPlanReview
              key={awaitingReview ? "review" : "readonly"}
              plan={plan}
              discovery={liveSession.metadata.qaDiscovery}
              readOnly={!awaitingReview}
              loading={loading}
              onApprove={approve}
              onRequestChanges={requestChanges}
              onAddJourneys={addJourneys}
            />
          )}
          {generated.length > 0 && (
            <QaGeneratedTestsPanel generated={generated} />
          )}
        </>
      )}

      {/* Persistent coverage dashboard — the agent's standing artifact */}
      {coverageSource?.metadata.qaSummary && (
        <QaSummaryPanel
          summary={coverageSource.metadata.qaSummary}
          plan={coverageSource.metadata.qaPlan}
          persistent
          updatedAt={coverageSource.completedAt ?? coverageSource.createdAt}
          onRequestCoverage={handleRequestCoverage}
          requestPending={taskPending}
        />
      )}

      {/* Direction queue */}
      <QaTaskBoard
        tasks={tasks}
        pending={taskPending}
        error={taskError}
        onAdd={addTask}
        onRetry={retryTask}
        onDrop={dropTask}
      />

      <QaRunHistory
        sessions={historySessions}
        liveSessionId={liveSession?.id ?? null}
        loading={loading}
        onRerun={(sid) => void rerun(sid)}
      />
    </div>
  );
}
