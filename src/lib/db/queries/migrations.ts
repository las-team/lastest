/**
 * `migration_projects` / `migration_waves` / `migration_runs` — the decisions
 * behind a Veeva CRM -> Vault CRM cutover.
 *
 * Everything the ENGINE produced (per-row results, crosswalk, reconciliation,
 * watermarks, findings) is read from its own `veeva_migration` schema through
 * `src/lib/migration/engine-store.ts`, not from here. This module only ever
 * touches rows a human created or a run header the console wrote.
 */
import { db } from "../index";
import {
  migrationProjects,
  migrationWaves,
  migrationRuns,
  migrationFindingAcks,
  sutConnectors,
  environments,
} from "../schema";
import type {
  Environment,
  MigrationFindingAck,
  MigrationProject,
  MigrationProjectConfig,
  MigrationProjectStatus,
  MigrationRun,
  MigrationRunMode,
  MigrationRunStatus,
  MigrationRunSummary,
  MigrationStage,
  MigrationWave,
  MigrationWaveStatus,
  SutConnector,
} from "../schema";
import { and, desc, eq, inArray, asc, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";

/** A project with both ends resolved — what every screen actually needs. */
export interface MigrationProjectDetail {
  project: MigrationProject;
  source: SutConnector | null;
  target: SutConnector | null;
  sourceEnvironment: Environment | null;
  targetEnvironment: Environment | null;
  waves: MigrationWave[];
}

export async function listMigrationProjects(
  repositoryId: string,
): Promise<MigrationProject[]> {
  return db
    .select()
    .from(migrationProjects)
    .where(eq(migrationProjects.repositoryId, repositoryId))
    .orderBy(desc(migrationProjects.updatedAt));
}

export async function getMigrationProject(
  id: string,
): Promise<MigrationProject | undefined> {
  const [row] = await db
    .select()
    .from(migrationProjects)
    .where(eq(migrationProjects.id, id));
  return row;
}

/**
 * The project with connectors, environments and waves in one round trip each.
 *
 * Four small selects rather than one four-way left join: the joins are all
 * nullable (a deleted connector, a repo-wide connector with no environment)
 * and Drizzle's row shape for a nullable join is `T | null` per table, which
 * every caller then has to re-narrow. The cost is four indexed primary-key
 * lookups on a page that already does more than that.
 */
export async function getMigrationProjectDetail(
  id: string,
): Promise<MigrationProjectDetail | undefined> {
  const project = await getMigrationProject(id);
  if (!project) return undefined;

  const connectorIds = [
    project.sourceConnectorId,
    project.targetConnectorId,
  ].filter((x): x is string => Boolean(x));
  const envIds = [
    project.sourceEnvironmentId,
    project.targetEnvironmentId,
  ].filter((x): x is string => Boolean(x));

  const [connectors, envs, waves] = await Promise.all([
    connectorIds.length
      ? db
          .select()
          .from(sutConnectors)
          .where(inArray(sutConnectors.id, connectorIds))
      : Promise.resolve([] as SutConnector[]),
    envIds.length
      ? db.select().from(environments).where(inArray(environments.id, envIds))
      : Promise.resolve([] as Environment[]),
    listMigrationWaves(id),
  ]);

  const byId = <T extends { id: string }>(rows: T[], key: string | null) =>
    (key ? rows.find((r) => r.id === key) : undefined) ?? null;

  return {
    project,
    source: byId(connectors, project.sourceConnectorId),
    target: byId(connectors, project.targetConnectorId),
    sourceEnvironment: byId(envs, project.sourceEnvironmentId),
    targetEnvironment: byId(envs, project.targetEnvironmentId),
    waves,
  };
}

export async function createMigrationProject(data: {
  repositoryId: string;
  name: string;
  description?: string;
  sourceConnectorId?: string | null;
  targetConnectorId?: string | null;
  sourceEnvironmentId?: string | null;
  targetEnvironmentId?: string | null;
  config?: MigrationProjectConfig;
  runDir?: string | null;
  createdBy?: string | null;
}): Promise<MigrationProject> {
  const now = new Date();
  const [row] = await db
    .insert(migrationProjects)
    .values({
      id: uuid(),
      repositoryId: data.repositoryId,
      name: data.name,
      description: data.description ?? null,
      status: "draft",
      stage: "connect",
      sourceConnectorId: data.sourceConnectorId ?? null,
      targetConnectorId: data.targetConnectorId ?? null,
      sourceEnvironmentId: data.sourceEnvironmentId ?? null,
      targetEnvironmentId: data.targetEnvironmentId ?? null,
      config: data.config ?? {},
      runDir: data.runDir ?? null,
      createdBy: data.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function updateMigrationProject(
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    status: MigrationProjectStatus;
    stage: MigrationStage;
    sourceConnectorId: string | null;
    targetConnectorId: string | null;
    sourceEnvironmentId: string | null;
    targetEnvironmentId: string | null;
    config: MigrationProjectConfig;
    runDir: string | null;
  }>,
): Promise<void> {
  await db
    .update(migrationProjects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(migrationProjects.id, id));
}

export async function deleteMigrationProject(id: string): Promise<void> {
  await db.delete(migrationProjects).where(eq(migrationProjects.id, id));
}

export async function projectNameTaken(
  repositoryId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: migrationProjects.id })
    .from(migrationProjects)
    .where(
      and(
        eq(migrationProjects.repositoryId, repositoryId),
        eq(migrationProjects.name, name),
      ),
    );
  return rows.some((r) => r.id !== excludeId);
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

export async function listMigrationWaves(
  projectId: string,
): Promise<MigrationWave[]> {
  return db
    .select()
    .from(migrationWaves)
    .where(eq(migrationWaves.projectId, projectId))
    .orderBy(asc(migrationWaves.sortOrder), asc(migrationWaves.createdAt));
}

export async function getMigrationWave(
  id: string,
): Promise<MigrationWave | undefined> {
  const [row] = await db
    .select()
    .from(migrationWaves)
    .where(eq(migrationWaves.id, id));
  return row;
}

export async function createMigrationWave(data: {
  projectId: string;
  key: string;
  label: string;
  countries: string[];
  plannedAt?: Date | null;
  sortOrder?: number;
}): Promise<MigrationWave> {
  const [row] = await db
    .insert(migrationWaves)
    .values({
      id: uuid(),
      projectId: data.projectId,
      key: data.key,
      label: data.label,
      countries: data.countries,
      plannedAt: data.plannedAt ?? null,
      sortOrder: data.sortOrder ?? 0,
    })
    .returning();
  return row;
}

export async function updateMigrationWave(
  id: string,
  patch: Partial<{
    label: string;
    countries: string[];
    status: MigrationWaveStatus;
    freezeAt: Date | null;
    plannedAt: Date | null;
    signedOffAt: Date | null;
    signedOffBy: string | null;
    signOffNote: string | null;
    sortOrder: number;
  }>,
): Promise<void> {
  await db
    .update(migrationWaves)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(migrationWaves.id, id));
}

export async function deleteMigrationWave(id: string): Promise<void> {
  await db.delete(migrationWaves).where(eq(migrationWaves.id, id));
}

export async function waveKeyTaken(
  projectId: string,
  key: string,
  excludeId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: migrationWaves.id })
    .from(migrationWaves)
    .where(
      and(eq(migrationWaves.projectId, projectId), eq(migrationWaves.key, key)),
    );
  return rows.some((r) => r.id !== excludeId);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function listMigrationRuns(
  projectId: string,
  limit = 50,
): Promise<MigrationRun[]> {
  return db
    .select()
    .from(migrationRuns)
    .where(eq(migrationRuns.projectId, projectId))
    .orderBy(desc(migrationRuns.startedAt))
    .limit(limit);
}

export async function getMigrationRun(
  id: string,
): Promise<MigrationRun | undefined> {
  const [row] = await db
    .select()
    .from(migrationRuns)
    .where(eq(migrationRuns.id, id));
  return row;
}

/**
 * Runs still in flight for a project.
 *
 * The console's launch guard reads this rather than trusting the rail it
 * rendered from: two operators on two tabs must not start the same init.
 */
export async function activeMigrationRuns(
  projectId: string,
): Promise<MigrationRun[]> {
  return db
    .select()
    .from(migrationRuns)
    .where(
      and(
        eq(migrationRuns.projectId, projectId),
        inArray(migrationRuns.status, ["queued", "running"]),
      ),
    );
}

export async function createMigrationRun(data: {
  projectId: string;
  waveId?: string | null;
  mode: MigrationRunMode;
  dryRun?: boolean;
  countries: string[];
  objects?: string[] | null;
  parentRunId?: string | null;
  freezeAt?: Date | null;
  justification?: string | null;
  startedBy?: string | null;
}): Promise<MigrationRun> {
  const [row] = await db
    .insert(migrationRuns)
    .values({
      id: uuid(),
      projectId: data.projectId,
      waveId: data.waveId ?? null,
      mode: data.mode,
      status: "queued",
      dryRun: data.dryRun ?? false,
      countries: data.countries,
      objects: data.objects ?? null,
      parentRunId: data.parentRunId ?? null,
      freezeAt: data.freezeAt ?? null,
      justification: data.justification ?? null,
      startedBy: data.startedBy ?? null,
      startedAt: new Date(),
    })
    .returning();
  return row;
}

export async function updateMigrationRun(
  id: string,
  patch: Partial<{
    engineRunId: string | null;
    jobId: string | null;
    status: MigrationRunStatus;
    summary: MigrationRunSummary;
    error: string | null;
    finishedAt: Date | null;
  }>,
): Promise<void> {
  await db.update(migrationRuns).set(patch).where(eq(migrationRuns.id, id));
}

/**
 * Mark runs that outlived the process that was executing them.
 *
 * A migration run is an in-process promise (like `coverage_sync`), so a deploy
 * mid-init leaves a `running` row with nobody behind it. Without this the
 * console's "a run is already in flight" guard would lock the project forever.
 * The engine itself is idempotent — re-running an interrupted init is a delta —
 * so failing the row is safe; what is NOT safe is silently starting a second
 * run beside a live one, which is why the threshold is generous.
 */
export async function failStaleMigrationRuns(
  staleMs = 30 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await db
    .update(migrationRuns)
    .set({
      status: "aborted",
      error:
        "The server restarted while this run was in flight. Re-run the step — loads are idempotent and the watermark did not advance.",
      finishedAt: new Date(),
    })
    .where(
      and(
        inArray(migrationRuns.status, ["queued", "running"]),
        sql`${migrationRuns.startedAt} < ${cutoff}`,
      ),
    )
    .returning({ id: migrationRuns.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Finding acknowledgements
// ---------------------------------------------------------------------------

export async function listFindingAcks(
  projectId: string,
): Promise<MigrationFindingAck[]> {
  return db
    .select()
    .from(migrationFindingAcks)
    .where(eq(migrationFindingAcks.projectId, projectId));
}

export async function acknowledgeFinding(data: {
  projectId: string;
  code: string;
  objectKey?: string;
  country?: string;
  justification: string;
  acknowledgedBy?: string | null;
}): Promise<void> {
  await db
    .insert(migrationFindingAcks)
    .values({
      id: uuid(),
      projectId: data.projectId,
      code: data.code,
      objectKey: data.objectKey ?? "",
      country: data.country ?? "",
      justification: data.justification,
      acknowledgedBy: data.acknowledgedBy ?? null,
      acknowledgedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        migrationFindingAcks.projectId,
        migrationFindingAcks.code,
        migrationFindingAcks.objectKey,
        migrationFindingAcks.country,
      ],
      set: {
        justification: data.justification,
        acknowledgedBy: data.acknowledgedBy ?? null,
        acknowledgedAt: new Date(),
      },
    });
}

export async function revokeFindingAck(id: string): Promise<void> {
  await db.delete(migrationFindingAcks).where(eq(migrationFindingAcks.id, id));
}
