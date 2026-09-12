import {
  buildConfigSkeleton,
  describeEndpoints,
  MigrationConfigError,
  type BuildConfigInput,
  type MigrationConfigSkeleton,
} from "./config-builder";
import { orm } from "./data/db";
import * as queries from "./data/queries";
import {
  deriveFlowState,
  STAGE_BY_KEY,
  type FlowRun,
  type FlowState,
} from "./flow";
import { buildPlanPreview, type PlanFailure, type PlanResult } from "./plan";
import { readConsoleEngineData, type ConsoleEngineData } from "./reads";
import { veevaMigrationWiring } from "./wiring";
import type { VaultConnectorShape } from "./connector-shapes";
import type {
  ConnectorDetail,
  ConnectorSummary,
  EnvironmentDetail,
} from "./host";
import type {
  MigrationFindingAck,
  MigrationProject,
  MigrationRun,
  MigrationStage,
  MigrationWave,
} from "./schema";

/**
 * Everything the `/migrations` routes render, assembled inside the plugin.
 *
 * The three route files used to do this themselves, against
 * `@/lib/db/queries` and `@/lib/migration/*` — which is exactly the coupling
 * this migration removes: a page cannot reach a plugin's tables, and a plugin
 * cannot be a Next.js route. So the pages keep the routing (recipe §6 — Next
 * owns that) and call one function each from here.
 *
 * Three things are improvements rather than relocations:
 *
 *  - **Auth is one call, and it is not optional.** The pages each did
 *    `hasMigrationAccess(session?.team)` and the console page additionally
 *    re-read the repository to check team ownership, because
 *    `getMigrationProjectDetail` "takes an id and answers". Both are now inside
 *    `assertMigrationAccess`, which the console read calls itself — so a
 *    project id in a URL cannot be used to read another team's cutover even if
 *    a future page forgets the check.
 *  - **The skeleton sent to the browser stays secret-free**, structurally:
 *    `buildConfigSkeleton` takes no credentials and `withSecrets` is only ever
 *    called inside the job handler.
 *  - **The engine read is project-scoped.** The old page built its engine
 *    target from `process.env.DATABASE_URL` plus a `vaultDns` read off the
 *    target connector, which is what let one tenant's console read another's
 *    crosswalk.
 */

/** Gate a page, by repository. Throws for a member or team that may not see it. */
export async function assertMigrationAccess(
  repositoryId: string,
): Promise<{ userId: string; teamId: string }> {
  const { host } = veevaMigrationWiring();
  return host.assertRepoSettingsAccess(repositoryId);
}

export interface MigrationIndexData {
  projects: MigrationProject[];
  summaries: Array<{
    projectId: string;
    waves: MigrationWave[];
    lastRun: MigrationRun | null;
  }>;
  connectors: readonly ConnectorSummary[];
}

export async function readMigrationIndex(
  repositoryId: string,
): Promise<MigrationIndexData> {
  await assertMigrationAccess(repositoryId);
  const { host, data } = veevaMigrationWiring();
  const db = orm(data);
  const [projects, connectors] = await Promise.all([
    queries.listMigrationProjects(db, repositoryId),
    host.listConnectors(repositoryId, ["salesforce", "vault"]),
  ]);

  // Waves and the newest run per project drive the list's status line. Both are
  // small per project and the list is short, so a per-project pair of queries
  // is cheaper than the aggregate query it would take to avoid them.
  const summaries = await Promise.all(
    projects.map(async (p) => {
      const [waves, runs] = await Promise.all([
        queries.listMigrationWaves(db, p.id),
        queries.listMigrationRuns(db, p.id, 1),
      ]);
      return { projectId: p.id, waves, lastRun: runs[0] ?? null };
    }),
  );

  return { projects, summaries, connectors };
}

export interface MigrationConsoleData {
  project: MigrationProject;
  source: ConnectorDetail | null;
  target: ConnectorDetail | null;
  sourceEnvironment: EnvironmentDetail | null;
  targetEnvironment: EnvironmentDetail | null;
  connectors: readonly ConnectorSummary[];
  waves: MigrationWave[];
  activeWaveId: string | null;
  runs: MigrationRun[];
  acks: MigrationFindingAck[];
  flow: FlowState;
  stage: MigrationStage;
  focusedRun: MigrationRun | null;
  engine: ConsoleEngineData;
  endpoints: { source: string; target: string };
  configPreview: MigrationConfigSkeleton | null;
  configError: string | null;
  plan: PlanResult | PlanFailure | null;
}

export async function readMigrationConsole(
  projectId: string,
  opts: { stage?: string; waveId?: string | null } = {},
): Promise<MigrationConsoleData | null> {
  const { host, data, connectorDefaults } = veevaMigrationWiring();
  const db = orm(data);
  const detail = await queries.getMigrationProjectWithWaves(db, projectId);
  if (!detail) return null;
  const { project, waves } = detail;

  // Repo ownership: the project id comes from a URL, so this is the check that
  // stops one team reading another's cutover. It runs before anything else is
  // read, and it lives here rather than in the page so it cannot be skipped.
  await assertMigrationAccess(project.repositoryId);

  const [endpointsResolved, runs, acks, connectors] = await Promise.all([
    host.resolveEndpoints(project.repositoryId, {
      sourceConnectorId: project.sourceConnectorId,
      targetConnectorId: project.targetConnectorId,
    }),
    queries.listMigrationRuns(db, projectId, 100),
    queries.listFindingAcks(db, projectId),
    host.listConnectors(project.repositoryId, ["salesforce", "vault"]),
  ]);

  const activeWave =
    waves.find((w) => w.id === opts.waveId) ?? waves[0] ?? null;
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
    opts.stage && opts.stage in STAGE_BY_KEY
      ? (opts.stage as MigrationStage)
      : flow.activeStage;

  const skeletonInput: BuildConfigInput = {
    project,
    source: endpointsResolved.source,
    target: endpointsResolved.target,
    waves,
    apiDefaults: connectorDefaults,
    sourceEnvironment: endpointsResolved.sourceEnvironment,
    targetEnvironment: endpointsResolved.targetEnvironment,
  };

  // The plan is only built once both ends exist and the wave has countries —
  // otherwise `buildConfigSkeleton` throws the very message the Connect stage
  // is there to show, and building it would just move that message somewhere
  // less useful.
  let plan: PlanResult | PlanFailure | null = null;
  let configError: string | null = null;
  let configPreview: MigrationConfigSkeleton | null = null;
  try {
    configPreview = buildConfigSkeleton(skeletonInput);
    if (activeWave && activeWave.countries.length > 0) {
      plan = await buildPlanPreview(configPreview, { wave: activeWave.key });
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
  // would be six round trips for a screen that shows one of them.
  const focusedRunId = flow.stages.find((s) => s.key === stage)?.lastRunId;
  const focusedRun = focusedRunId
    ? (runs.find((r) => r.id === focusedRunId) ?? null)
    : null;
  const vaultDns = (
    endpointsResolved.target?.config as VaultConnectorShape | undefined
  )?.vaultDns;
  const engine = await readConsoleEngineData(
    { db, projectId, vaultDns },
    focusedRun?.engineRunId ?? null,
  );

  return {
    project,
    source: endpointsResolved.source,
    target: endpointsResolved.target,
    sourceEnvironment: endpointsResolved.sourceEnvironment,
    targetEnvironment: endpointsResolved.targetEnvironment,
    connectors,
    waves,
    activeWaveId: activeWave?.id ?? null,
    runs,
    acks,
    flow,
    stage,
    focusedRun,
    engine,
    endpoints: describeEndpoints(skeletonInput),
    configPreview,
    configError,
    plan,
  };
}

export interface MigrationRunPageData {
  project: MigrationProject;
  run: MigrationRun;
  /** The run's wave, for the page heading. Null for a project-wide run. */
  waveLabel: string | null;
  engine: ConsoleEngineData;
}

export async function readMigrationRun(
  projectId: string,
  runId: string,
): Promise<MigrationRunPageData | null> {
  const { host, data } = veevaMigrationWiring();
  const db = orm(data);
  const project = await queries.getMigrationProject(db, projectId);
  if (!project) return null;
  await assertMigrationAccess(project.repositoryId);

  const run = await queries.getMigrationRun(db, runId);
  if (!run || run.projectId !== projectId) return null;

  const waveLabel = run.waveId
    ? ((await queries.getMigrationWave(db, run.waveId))?.label ?? null)
    : null;

  const endpoints = await host.resolveEndpoints(project.repositoryId, {
    sourceConnectorId: null,
    targetConnectorId: project.targetConnectorId,
  });
  const vaultDns = (endpoints.target?.config as VaultConnectorShape | undefined)
    ?.vaultDns;

  const engine = await readConsoleEngineData(
    { db, projectId, vaultDns },
    run.engineRunId,
  );
  return { project, run, waveLabel, engine };
}

function toFlowRun(r: MigrationRun): FlowRun {
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
