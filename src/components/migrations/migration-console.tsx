"use client";

/**
 * The migration console — one screen, nine steps.
 *
 * Structure is deliberately flat: a header that says what this migration talks
 * to, a rail that says where in the flow it is, and a panel for the step you
 * are on. There is no dashboard, no tab set and no second level of navigation,
 * because a cutover is a sequence and a screen that lets you wander is a screen
 * that lets you run `init` before `preflight`.
 *
 * All state that matters lives on the server. This component holds three
 * things and nothing else: which stage is open, which action is in flight, and
 * a poll timer that refreshes the route while a run is running.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  ChevronLeft,
  Cloud,
  Database,
  History,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StageRail } from "./stage-rail";
import { ConnectPanel } from "./connect-panel";
import { PlanPanel, WaveStatusBadge } from "./plan-panel";
import {
  CrosswalkLookup,
  CutoverPanel,
  LoadPanel,
  PreflightPanel,
  ReportLinks,
  type RunPanelData,
} from "./run-panels";
import { PanelShell, RunButton, RunStatusBadge } from "./panel-shell";
import { SignoffPanel } from "./signoff-panel";
import { STAGE_BY_KEY } from "@/lib/migration/stages";
import type { FlowState, MigrationStage } from "@/lib/migration/stages";
import {
  acceptFinding,
  lookupCrosswalk,
  revokeFinding,
  signOffWave,
  startMigrationRun,
  updateWave,
} from "@/server/actions/migrations";
import { timeAgo } from "@/lib/utils";
import type {
  Environment,
  MigrationFindingAck,
  MigrationProject,
  MigrationRun,
  MigrationWave,
  SutConnector,
} from "@/lib/db/schema";
import type { ConnectorWithEnvironment } from "@/lib/db/queries/connectors";
import type { PlanFailure, PlanResult } from "@/lib/migration/plan";
import type { MigrationConfigSkeleton } from "@/lib/migration/config-builder";
import type {
  ReconciliationRow,
  RowResult,
  StoredFinding,
  Watermark,
} from "@lastest/veeva-migration";

/** How often the route is refreshed while a run is in flight. */
const POLL_MS = 4000;

interface Props {
  project: MigrationProject;
  source: SutConnector | null;
  target: SutConnector | null;
  sourceEnvironment: Environment | null;
  targetEnvironment: Environment | null;
  connectors: ConnectorWithEnvironment[];
  environments: Environment[];
  waves: MigrationWave[];
  activeWaveId: string | null;
  runs: MigrationRun[];
  flow: FlowState;
  stage: MigrationStage;
  endpoints: { source: string; target: string };
  configError: string | null;
  configPreview: MigrationConfigSkeleton | null;
  plan: PlanResult | PlanFailure | null;
  focusedRun: MigrationRun | null;
  engine: {
    findings: StoredFinding[];
    previousFindings: StoredFinding[];
    reconciliation: ReconciliationRow[];
    watermarks: Watermark[];
    frozenCountries: Array<{ country: string; frozenAt: string }>;
    failedRows: RowResult[];
  };
  acks: MigrationFindingAck[];
}

export function MigrationConsole(props: Props) {
  const {
    project,
    source,
    target,
    connectors,
    waves,
    activeWaveId,
    runs,
    flow,
    stage,
    endpoints,
    configError,
    plan,
    focusedRun,
    engine,
    acks,
  } = props;

  const router = useRouter();
  const [, startNavigation] = useTransition();
  const [pending, setPending] = useState<string | null>(null);

  const activeWave = waves.find((w) => w.id === activeWaveId) ?? null;
  const stageState = flow.stages.find((s) => s.key === stage)!;
  const def = STAGE_BY_KEY[stage];
  const anyRunning = runs.some(
    (r) => r.status === "running" || r.status === "queued",
  );

  // While a run is in flight the server page is the source of truth for its
  // progress — the engine writes reconciliation rows as each unit finishes —
  // so the cheapest correct live view is to re-render the route. No socket, no
  // second data path that could disagree with the page.
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [anyRunning, router]);

  const go = (next: MigrationStage) => {
    const params = new URLSearchParams();
    params.set("stage", next);
    if (activeWaveId) params.set("wave", activeWaveId);
    startNavigation(() => {
      router.push(`/migrations/${project.id}?${params.toString()}`, {
        scroll: false,
      });
    });
  };

  const selectWave = (waveId: string) => {
    const params = new URLSearchParams();
    params.set("wave", waveId);
    startNavigation(() => {
      router.push(`/migrations/${project.id}?${params.toString()}`, {
        scroll: false,
      });
    });
  };

  const run = async (
    forStage: MigrationStage,
    extra: { objects?: string[]; parentEngineRunId?: string } = {},
  ) => {
    setPending(forStage);
    try {
      const result = await startMigrationRun({
        projectId: project.id,
        stage: forStage,
        waveId: activeWaveId,
        ...extra,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${STAGE_BY_KEY[forStage].label} started`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start the run",
      );
    } finally {
      setPending(null);
    }
  };

  const panelData: RunPanelData = useMemo(
    () => ({
      run: focusedRun,
      reconciliation: engine.reconciliation,
      findings: engine.findings,
      previousFindings: engine.previousFindings,
      failedRows: engine.failedRows,
      watermarks: engine.watermarks,
    }),
    [focusedRun, engine],
  );

  const objectKeys = useMemo(
    () =>
      plan?.ok
        ? [...new Set(plan.units.map((u) => u.objectKey))]
        : ["account", "address", "call2"],
    [plan],
  );

  /**
   * The run Sign-off is a statement ABOUT.
   *
   * Sign-off has no run of its own — `report` is something you ask for after
   * the fact — so `focusedRun` is null there and both the report link and the
   * `--run` in the command line would be blank. The wave's most recent
   * finished run is what an auditor is handed, so that is what is shown.
   */
  const reportRun = useMemo(() => {
    if (focusedRun) return focusedRun;
    return (
      runs.find(
        (r) =>
          r.waveId === activeWaveId &&
          Boolean(r.engineRunId) &&
          Boolean(r.summary),
      ) ?? null
    );
  }, [focusedRun, runs, activeWaveId]);

  const command = useMemo(() => {
    if (!def.command) return null;
    return def.command
      .replace("{wave}", activeWave?.key ?? "<wave>")
      .replace(
        "{freezeAt}",
        activeWave?.freezeAt
          ? new Date(activeWave.freezeAt).toISOString()
          : "<freeze-at>",
      )
      .replace("{runId}", reportRun?.engineRunId ?? "<run-id>");
  }, [def.command, activeWave, reportRun]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <ConsoleHeader
        project={project}
        endpoints={endpoints}
        waves={waves}
        activeWave={activeWave}
        onSelectWave={selectWave}
        completed={flow.completed}
        total={flow.stages.length}
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 p-6 overflow-y-auto">
        <aside className="lg:sticky lg:top-0 lg:self-start space-y-4">
          <StageRail stages={flow.stages} current={stage} onSelect={go} />
          <RunHistory runs={runs} projectId={project.id} />
        </aside>

        <main className="min-w-0 space-y-6">
          <PanelShell
            def={def}
            state={stageState}
            command={command}
            actions={
              def.mode ? (
                <RunButton
                  label={def.action}
                  state={stageState}
                  pending={pending === stage}
                  onRun={() => run(stage)}
                />
              ) : undefined
            }
          >
            {stage === "connect" && (
              <ConnectPanel
                projectId={project.id}
                connectors={connectors}
                source={source}
                target={target}
                configError={configError}
              />
            )}

            {stage === "plan" && (
              <PlanPanel
                projectId={project.id}
                waves={waves}
                activeWaveId={activeWaveId}
                plan={plan}
              />
            )}

            {stage === "preflight" && (
              <PreflightPanel
                data={panelData}
                acks={acks.map((a) => ({
                  id: a.id,
                  code: a.code,
                  objectKey: a.objectKey,
                  country: a.country,
                  justification: a.justification,
                }))}
                onAccept={async (input) => {
                  await acceptFinding({ projectId: project.id, ...input });
                  toast.success("Finding accepted");
                  router.refresh();
                }}
                onRevoke={async (ackId) => {
                  await revokeFinding(project.id, ackId);
                  toast.success("Acceptance revoked");
                  router.refresh();
                }}
              />
            )}

            {stage === "dryrun" && (
              <LoadPanel data={panelData} variant="load" dryRun />
            )}

            {stage === "initial" && (
              <LoadPanel
                data={panelData}
                variant="load"
                retryPending={pending === "retry"}
                onRetryFailed={
                  focusedRun?.engineRunId
                    ? () => {
                        setPending("retry");
                        void run("initial", {
                          parentEngineRunId: focusedRun.engineRunId!,
                        });
                      }
                    : undefined
                }
              />
            )}

            {stage === "delta" && (
              <div className="space-y-6">
                <LoadPanel data={panelData} variant="delta" />
                <CrosswalkLookup
                  objectKeys={objectKeys}
                  onLookup={(objectKey, id) =>
                    lookupCrosswalk(project.id, objectKey, id)
                  }
                />
              </div>
            )}

            {stage === "cutover" && (
              <CutoverPanel
                data={panelData}
                freezeAt={
                  activeWave?.freezeAt
                    ? new Date(activeWave.freezeAt).toISOString().slice(0, 16)
                    : null
                }
                freezeAtIso={
                  activeWave?.freezeAt
                    ? new Date(activeWave.freezeAt).toISOString()
                    : null
                }
                freezePending={pending === "freeze"}
                waveSignedOff={activeWave?.status === "signed_off"}
                onFreeze={async (value) => {
                  if (!activeWave) return;
                  setPending("freeze");
                  try {
                    await updateWave(activeWave.id, { freezeAt: value });
                    toast.success(value ? "Freeze recorded" : "Freeze cleared");
                    router.refresh();
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Could not record the freeze",
                    );
                  } finally {
                    setPending(null);
                  }
                }}
              />
            )}

            {stage === "verify" && (
              <LoadPanel data={panelData} variant="verify" />
            )}

            {stage === "signoff" && (
              <SignoffPanel
                wave={activeWave}
                runs={runs}
                focusedRun={reportRun}
                frozenCountries={engine.frozenCountries}
                pending={pending === "signoff"}
                onSignOff={async (note) => {
                  if (!activeWave) return;
                  setPending("signoff");
                  try {
                    const result = await signOffWave({
                      waveId: activeWave.id,
                      note,
                    });
                    if (!result.ok) toast.error(result.error);
                    else {
                      toast.success("Wave signed off");
                      router.refresh();
                    }
                  } finally {
                    setPending(null);
                  }
                }}
                report={<ReportLinks run={reportRun} />}
              />
            )}
          </PanelShell>
        </main>
      </div>
    </div>
  );
}

function ConsoleHeader({
  project,
  endpoints,
  waves,
  activeWave,
  onSelectWave,
  completed,
  total,
}: {
  project: MigrationProject;
  endpoints: { source: string; target: string };
  waves: MigrationWave[];
  activeWave: MigrationWave | null;
  onSelectWave: (id: string) => void;
  completed: number;
  total: number;
}) {
  return (
    <header className="border-b px-6 py-4 space-y-3 shrink-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/migrations"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            Migrations
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight truncate">
            {project.name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground font-mono">
            <span className="inline-flex items-center gap-1.5">
              <Cloud className="h-3.5 w-3.5" />
              {endpoints.source}
            </span>
            <ArrowRight className="h-3 w-3" />
            <span className="inline-flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" />
              {endpoints.target}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {waves.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={activeWave?.id ?? ""} onValueChange={onSelectWave}>
                <SelectTrigger className="w-[200px] h-8 text-xs">
                  <SelectValue placeholder="Select a wave" />
                </SelectTrigger>
                <SelectContent>
                  {waves.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.label} · {w.countries.join(", ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeWave && <WaveStatusBadge status={activeWave.status} />}
            </div>
          )}
          <Badge variant="outline" className="font-mono">
            {completed}/{total}
          </Badge>
        </div>
      </div>

      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${Math.round((completed / total) * 100)}%` }}
        />
      </div>
    </header>
  );
}

function RunHistory({
  runs,
  projectId,
}: {
  runs: MigrationRun[];
  projectId: string;
}) {
  if (runs.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <History className="h-3 w-3" />
        Run history
      </h3>
      <ul className="space-y-1">
        {runs.slice(0, 8).map((r) => (
          <li key={r.id}>
            <Link
              href={`/migrations/${projectId}/runs/${r.id}`}
              className="block rounded-md px-2 py-1.5 hover:bg-muted transition-colors"
            >
              <span className="flex items-center gap-1.5 text-xs">
                {r.status === "running" || r.status === "queued" ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                ) : null}
                <span className="font-mono font-medium">{r.mode}</span>
                {r.dryRun && (
                  <span className="text-[10px] text-muted-foreground">dry</span>
                )}
                <RunStatusBadge status={r.status} />
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {r.startedAt ? timeAgo(r.startedAt) : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
