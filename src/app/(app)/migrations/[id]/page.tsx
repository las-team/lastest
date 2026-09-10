import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { hasMigrationAccess } from "@/lib/migration/access";
import { MigrationLocked } from "@/components/migrations/migration-locked";
import { MigrationConsole } from "@/components/migrations/migration-console";
import { deriveFlowState, STAGE_BY_KEY } from "@/lib/migration/stages";
import {
  buildConfigSkeleton,
  describeEndpoints,
  MigrationConfigError,
} from "@/lib/migration/config-builder";
import { buildPlanPreview } from "@/lib/migration/plan";
import {
  engineTarget,
  readConsoleEngineData,
} from "@/lib/migration/engine-store";
import type { MigrationStage, VaultConnectorConfig } from "@/lib/db/schema";
import type { FlowRun } from "@/lib/migration/stages";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string; wave?: string }>;
}

/**
 * `/migrations/[id]` — the flow console.
 *
 * Everything the nine stages render is assembled here so the client component
 * is a renderer, not a data layer. Three things are resolved server-side that
 * could not be resolved anywhere else:
 *
 *  1. the flow state, from `deriveFlowState` — the same function the actions
 *     re-run before launching, so the rail and the guard cannot disagree;
 *  2. the plan, built inline from the config skeleton (no credentials, no I/O);
 *  3. the focused run's detail, read from the engine's own state store.
 */
export default async function MigrationConsolePage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { stage: stageParam, wave: waveParam } = await searchParams;

  const session = await getCurrentSession();
  if (!hasMigrationAccess(session?.team)) return <MigrationLocked />;

  const detail = await queries.getMigrationProjectDetail(id);
  if (!detail) notFound();
  const {
    project,
    source,
    target,
    sourceEnvironment,
    targetEnvironment,
    waves,
  } = detail;

  // Repo ownership: the project id is a URL, so this is the check that stops
  // one team reading another's cutover. `getMigrationProjectDetail` does not
  // do it — it takes an id and answers.
  const repo = await queries.getRepository(project.repositoryId);
  if (!repo || repo.teamId !== session?.team?.id) notFound();

  const [connectors, environments, runs, acks] = await Promise.all([
    queries.listConnectors(project.repositoryId),
    queries.listEnvironments(project.repositoryId),
    queries.listMigrationRuns(project.id, 100),
    queries.listFindingAcks(project.id),
  ]);

  const activeWave = waves.find((w) => w.id === waveParam) ?? waves[0] ?? null;

  const waveRuns = runs.filter((r) => !r.waveId || r.waveId === activeWave?.id);
  const flow = deriveFlowState({
    hasSource: Boolean(project.sourceConnectorId),
    hasTarget: Boolean(project.targetConnectorId),
    wave: activeWave
      ? {
          id: activeWave.id,
          status: activeWave.status,
          countries: activeWave.countries,
          freezeAt: activeWave.freezeAt,
        }
      : null,
    runs: waveRuns.map(toFlowRun),
    planned: Boolean(activeWave && activeWave.countries.length > 0),
  });

  const stage: MigrationStage =
    stageParam && stageParam in STAGE_BY_KEY
      ? (stageParam as MigrationStage)
      : flow.activeStage;

  // The plan is only built once both ends exist and the wave has countries —
  // otherwise `buildConfigSkeleton` throws the very message the Connect stage
  // is there to show, and building it would just move that message somewhere
  // less useful.
  let plan = null;
  let configError: string | null = null;
  let skeleton = null;
  try {
    skeleton = buildConfigSkeleton({
      project,
      source,
      target,
      waves,
      sourceEnvironment,
      targetEnvironment,
    });
    if (activeWave && activeWave.countries.length > 0) {
      plan = await buildPlanPreview(skeleton, { wave: activeWave.key });
    }
  } catch (err) {
    configError =
      err instanceof MigrationConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
  }

  // Detail is read for the focused stage's run only. Reading every stage's run
  // would be six round trips into the engine schema for a screen that shows
  // one of them.
  const focusedRunId = flow.stages.find((s) => s.key === stage)?.lastRunId;
  const focusedRun = focusedRunId
    ? (runs.find((r) => r.id === focusedRunId) ?? null)
    : null;
  const vaultDns = (target?.config as VaultConnectorConfig | undefined)
    ?.vaultDns;
  const engine = await readConsoleEngineData(
    engineTarget(vaultDns),
    focusedRun?.engineRunId ?? null,
  );

  return (
    <MigrationConsole
      project={project}
      source={source}
      target={target}
      sourceEnvironment={sourceEnvironment}
      targetEnvironment={targetEnvironment}
      connectors={connectors}
      environments={environments}
      waves={waves}
      activeWaveId={activeWave?.id ?? null}
      runs={runs}
      flow={flow}
      stage={stage}
      endpoints={describeEndpoints({
        project,
        source,
        target,
        waves,
        sourceEnvironment,
        targetEnvironment,
      })}
      configError={configError}
      configPreview={skeleton}
      plan={plan}
      focusedRun={focusedRun}
      engine={{
        findings: engine.findings,
        previousFindings: engine.previousFindings,
        reconciliation: engine.reconciliation,
        watermarks: engine.watermarks,
        frozenCountries: engine.frozenCountries,
        failedRows: engine.failedRows,
      }}
      acks={acks}
    />
  );
}

function toFlowRun(r: {
  id: string;
  mode: FlowRun["mode"];
  status: FlowRun["status"];
  dryRun: boolean;
  waveId: string | null;
  startedAt: Date | null;
  summary: {
    findings?: { blocking: number };
    gate?: "pass" | "fail" | "pending";
  } | null;
}): FlowRun {
  return {
    id: r.id,
    mode: r.mode,
    status: r.status,
    dryRun: r.dryRun,
    waveId: r.waveId,
    startedAt: r.startedAt,
    blockingFindings: r.summary?.findings?.blocking,
    gate: r.summary?.gate,
  };
}
