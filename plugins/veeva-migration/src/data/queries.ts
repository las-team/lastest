import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";

import type { VeevaMigrationDb } from "./db";
import {
  veevaMigrationFindingAcks as findingAcks,
  veevaMigrationProjects as projects,
  veevaMigrationRuns as runs,
  veevaMigrationWaves as waves,
  type MigrationFindingAck,
  type MigrationProject,
  type MigrationProjectConfig,
  type MigrationProjectStatus,
  type MigrationRun,
  type MigrationRunMode,
  type MigrationRunStatus,
  type MigrationRunSummary,
  type MigrationStage,
  type MigrationWave,
  type MigrationWaveStatus,
} from "../schema";

/**
 * The decisions behind a Veeva CRM → Vault CRM cutover: projects, waves, run
 * headers and accepted findings.
 *
 * Moved from `src/lib/db/queries/migrations.ts`. Two differences from the
 * original, both consequences of the plugin boundary:
 *
 *  - **The handle is a parameter, not a module import.** Every function takes
 *    `db` so the same code serves a server action (`orm(ctx.data)`), the
 *    deletion hook and the job handler (`db()` from the wiring slot) — the
 *    shape `plugins/data-sources/src/data/queries.ts` established.
 *  - **`getMigrationProjectDetail` lost its joins.** It used to left-join
 *    `sut_connectors` and `environments`; a plugin reaches neither, so the
 *    caller resolves those through `VeevaMigrationHost.resolveEndpoints`
 *    (recipe §3.2). What is left here is the project row plus its own waves.
 *
 * Everything the ENGINE produced is read through the engine's own `StateStore`
 * over the same tables (`src/store/`), not from here. This module only ever
 * touches rows a human created or a run header the console wrote.
 */

/** Ids only — a generated uuid, kept out of the schema so tests can seed. */
function newId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listMigrationProjects(
  db: VeevaMigrationDb,
  repositoryId: string,
): Promise<MigrationProject[]> {
  return db
    .select()
    .from(projects)
    .where(eq(projects.repositoryId, repositoryId))
    .orderBy(desc(projects.updatedAt));
}

export async function getMigrationProject(
  db: VeevaMigrationDb,
  id: string,
): Promise<MigrationProject | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row;
}

/** The project with its own waves. Connectors come from the host. */
export async function getMigrationProjectWithWaves(
  db: VeevaMigrationDb,
  id: string,
): Promise<{ project: MigrationProject; waves: MigrationWave[] } | undefined> {
  const project = await getMigrationProject(db, id);
  if (!project) return undefined;
  return { project, waves: await listMigrationWaves(db, id) };
}

export async function createMigrationProject(
  db: VeevaMigrationDb,
  data: {
    repositoryId: string;
    teamId: string;
    name: string;
    description?: string;
    sourceConnectorId?: string | null;
    targetConnectorId?: string | null;
    sourceEnvironmentId?: string | null;
    targetEnvironmentId?: string | null;
    config?: MigrationProjectConfig;
    createdBy?: string | null;
  },
): Promise<MigrationProject> {
  const now = new Date();
  const [row] = await db
    .insert(projects)
    .values({
      id: newId(),
      repositoryId: data.repositoryId,
      teamId: data.teamId,
      name: data.name,
      description: data.description ?? null,
      status: "draft",
      stage: "connect",
      sourceConnectorId: data.sourceConnectorId ?? null,
      targetConnectorId: data.targetConnectorId ?? null,
      sourceEnvironmentId: data.sourceEnvironmentId ?? null,
      targetEnvironmentId: data.targetEnvironmentId ?? null,
      config: data.config ?? {},
      createdBy: data.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

export async function updateMigrationProject(
  db: VeevaMigrationDb,
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
  }>,
): Promise<void> {
  await db
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projects.id, id));
}

export async function deleteMigrationProject(
  db: VeevaMigrationDb,
  id: string,
): Promise<void> {
  await db.delete(projects).where(eq(projects.id, id));
}

export async function projectNameTaken(
  db: VeevaMigrationDb,
  repositoryId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.repositoryId, repositoryId), eq(projects.name, name)),
    );
  return rows.some((r) => r.id !== excludeId);
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

export async function listMigrationWaves(
  db: VeevaMigrationDb,
  projectId: string,
): Promise<MigrationWave[]> {
  return db
    .select()
    .from(waves)
    .where(eq(waves.projectId, projectId))
    .orderBy(asc(waves.sortOrder), asc(waves.createdAt));
}

export async function getMigrationWave(
  db: VeevaMigrationDb,
  id: string,
): Promise<MigrationWave | undefined> {
  const [row] = await db.select().from(waves).where(eq(waves.id, id));
  return row;
}

export async function createMigrationWave(
  db: VeevaMigrationDb,
  data: {
    projectId: string;
    key: string;
    label: string;
    countries: string[];
    plannedAt?: Date | null;
    sortOrder?: number;
  },
): Promise<MigrationWave> {
  const [row] = await db
    .insert(waves)
    .values({
      id: newId(),
      projectId: data.projectId,
      key: data.key,
      label: data.label,
      countries: data.countries,
      plannedAt: data.plannedAt ?? null,
      sortOrder: data.sortOrder ?? 0,
    })
    .returning();
  return row!;
}

export async function updateMigrationWave(
  db: VeevaMigrationDb,
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
    .update(waves)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(waves.id, id));
}

export async function deleteMigrationWave(
  db: VeevaMigrationDb,
  id: string,
): Promise<void> {
  await db.delete(waves).where(eq(waves.id, id));
}

export async function waveKeyTaken(
  db: VeevaMigrationDb,
  projectId: string,
  key: string,
  excludeId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: waves.id })
    .from(waves)
    .where(and(eq(waves.projectId, projectId), eq(waves.key, key)));
  return rows.some((r) => r.id !== excludeId);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function listMigrationRuns(
  db: VeevaMigrationDb,
  projectId: string,
  limit = 50,
): Promise<MigrationRun[]> {
  return db
    .select()
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .orderBy(desc(runs.startedAt))
    .limit(limit);
}

export async function getMigrationRun(
  db: VeevaMigrationDb,
  id: string,
): Promise<MigrationRun | undefined> {
  const [row] = await db.select().from(runs).where(eq(runs.id, id));
  return row;
}

/**
 * Runs still in flight for a project.
 *
 * The launch guard reads this rather than trusting the rail it rendered from:
 * two operators on two tabs must not start the same init. It stays a database
 * read rather than a process-local lock because two app replicas must not both
 * start one — and now that the run is a `plugin_jobs` row, the queue's own
 * `dedupeKey` is a second, cheaper guard in front of it.
 */
export async function activeMigrationRuns(
  db: VeevaMigrationDb,
  projectId: string,
): Promise<MigrationRun[]> {
  return db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        inArray(runs.status, ["queued", "running"]),
      ),
    );
}

export async function createMigrationRun(
  db: VeevaMigrationDb,
  data: {
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
  },
): Promise<MigrationRun> {
  const [row] = await db
    .insert(runs)
    .values({
      id: newId(),
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
  return row!;
}

export async function updateMigrationRun(
  db: VeevaMigrationDb,
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
  await db.update(runs).set(patch).where(eq(runs.id, id));
}

/**
 * Mark runs that outlived the process that was executing them.
 *
 * Still needed, for a narrower reason than before. The run used to be a
 * detached in-process promise, so a deploy mid-init left a `running` row with
 * nobody behind it and the launch guard locked the project forever — and the
 * function that fixed that shipped with **zero callers**. Now the run is a
 * `plugin_jobs` row that core's worker can fail and account for, so this is the
 * reconciler for the gap the queue cannot see: the job row settled but the
 * plugin's own run row did not (the process died between the two writes).
 *
 * It is called from the same tick that drives the plugin job worker — see
 * `reconcileStaleRuns` in `../jobs.ts`.
 *
 * The engine itself is idempotent — re-running an interrupted init is a delta —
 * so failing the row is safe; what is NOT safe is silently starting a second
 * run beside a live one, which is why the threshold is generous.
 */
export async function failStaleMigrationRuns(
  db: VeevaMigrationDb,
  staleMs = 30 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await db
    .update(runs)
    .set({
      status: "aborted",
      error:
        "The server restarted while this run was in flight. Re-run the step — loads are idempotent and the watermark did not advance.",
      finishedAt: new Date(),
    })
    .where(
      and(
        inArray(runs.status, ["queued", "running"]),
        lt(runs.startedAt, cutoff),
      ),
    )
    .returning({ id: runs.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Finding acknowledgements
// ---------------------------------------------------------------------------

export async function listFindingAcks(
  db: VeevaMigrationDb,
  projectId: string,
): Promise<MigrationFindingAck[]> {
  return db
    .select()
    .from(findingAcks)
    .where(eq(findingAcks.projectId, projectId));
}

export async function acknowledgeFinding(
  db: VeevaMigrationDb,
  data: {
    projectId: string;
    code: string;
    objectKey?: string;
    country?: string;
    justification: string;
    acknowledgedBy?: string | null;
  },
): Promise<void> {
  await db
    .insert(findingAcks)
    .values({
      id: newId(),
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
        findingAcks.projectId,
        findingAcks.code,
        findingAcks.objectKey,
        findingAcks.country,
      ],
      set: {
        justification: data.justification,
        acknowledgedBy: data.acknowledgedBy ?? null,
        acknowledgedAt: new Date(),
      },
    });
}

export async function revokeFindingAck(
  db: VeevaMigrationDb,
  id: string,
): Promise<void> {
  await db.delete(findingAcks).where(eq(findingAcks.id, id));
}

// ---------------------------------------------------------------------------
// Deletion (the cascades the database no longer performs)
// ---------------------------------------------------------------------------

/**
 * Every project of a repository, with its team — what `onRepoDeleted` needs.
 *
 * Deleting the project rows is enough: waves, run headers, acknowledgements and
 * all thirteen engine tables hang off `veeva_migration_projects` by a
 * plugin-internal FK that still cascades (`core-scope.md` §6 forbids FKs to
 * *core* tables, not between a plugin's own).
 */
export async function listProjectsForRepo(
  db: VeevaMigrationDb,
  repositoryId: string,
): Promise<Array<{ id: string; teamId: string }>> {
  return db
    .select({ id: projects.id, teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.repositoryId, repositoryId));
}

export async function deleteProjectsForRepo(
  db: VeevaMigrationDb,
  repositoryId: string,
): Promise<void> {
  await db.delete(projects).where(eq(projects.repositoryId, repositoryId));
}

export async function deleteProjectsForTeam(
  db: VeevaMigrationDb,
  teamId: string,
): Promise<void> {
  await db.delete(projects).where(eq(projects.teamId, teamId));
}

/**
 * Forget a user without losing the record that something happened.
 *
 * The FKs these replace were `ON DELETE SET NULL`, and that was the right
 * semantics: a signed-off wave must not become unsigned because the person who
 * signed it closed their account. The engine's own `audit_log.actor` is
 * deliberately NOT nulled here — it is the regulated record of who did what,
 * and a cutover's audit trail that forgets its actors is not an audit trail.
 * Deleting the user's *projects* is not this hook's job either; they belong to
 * the team.
 */
export async function anonymiseUser(
  db: VeevaMigrationDb,
  userId: string,
): Promise<void> {
  await db
    .update(projects)
    .set({ createdBy: null })
    .where(eq(projects.createdBy, userId));
  await db
    .update(waves)
    .set({ signedOffBy: null })
    .where(eq(waves.signedOffBy, userId));
  await db
    .update(runs)
    .set({ startedBy: null })
    .where(eq(runs.startedBy, userId));
  await db
    .update(findingAcks)
    .set({ acknowledgedBy: null })
    .where(eq(findingAcks.acknowledgedBy, userId));
}
