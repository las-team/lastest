"use server";

/**
 * Server actions for the migration console.
 *
 * Every action here goes through `guardProject` / `guardRepo`, which enforce
 * BOTH gates from `lib/migration/access.ts`: the team must be in Early Adopter
 * mode, and the member must hold `repos:settings`. The console renders behind
 * the same check, but the check on the action is the one that counts — a page
 * gate is a hint, an action gate is the control.
 *
 * Secrets never travel through an action's arguments or return value. The two
 * connectors are named by id; `resolveSecrets` decrypts them server-side,
 * immediately before the engine starts, and the plaintext never leaves this
 * module.
 */

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoCapability } from "@/lib/auth/capabilities";
import { getCurrentSession } from "@/lib/auth";
import {
  hasMigrationAccess,
  MIGRATION_LOCKED_MESSAGE,
} from "@/lib/migration/access";
import {
  buildConfigSkeleton,
  MigrationConfigError,
  type BuildConfigInput,
} from "@/lib/migration/config-builder";
import { launchMigrationRun } from "@/lib/migration/run-job";
import {
  deriveFlowState,
  canAdvance,
  canLaunch,
  STAGE_BY_KEY,
} from "@/lib/migration/stages";
import type {
  MigrationProject,
  MigrationProjectConfig,
  MigrationStage,
  MigrationWave,
} from "@/lib/db/schema";

/** Engine `waves[].name`, and it lands in every run's audit trail. */
const WAVE_KEY_RE = /^[a-z][a-z0-9-]*$/;
const ISO_RE = /^[A-Z]{2}$/;

function refresh(projectId?: string) {
  revalidatePath("/migrations");
  if (projectId) revalidatePath(`/migrations/${projectId}`);
}

async function guardRepo(repositoryId: string) {
  const session = await requireRepoCapability(repositoryId, "repos:settings");
  if (!hasMigrationAccess(session.team))
    throw new Error(MIGRATION_LOCKED_MESSAGE);
  return session;
}

async function guardProject(projectId: string) {
  const project = await queries.getMigrationProject(projectId);
  if (!project) throw new Error("Forbidden: Migration not found");
  const session = await guardRepo(project.repositoryId);
  return { project, session };
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface MigrationProjectInput {
  name: string;
  description?: string | null;
  sourceConnectorId?: string | null;
  targetConnectorId?: string | null;
}

/**
 * Resolve a connector's environment from the connector itself.
 *
 * The environment is denormalised onto the project rather than joined at read
 * time so a deleted connector still says which environment it pointed at — a
 * signed-off cutover record that cannot name its target is not a record.
 */
async function environmentOf(
  connectorId: string | null | undefined,
  repositoryId: string,
): Promise<string | null> {
  if (!connectorId) return null;
  const connector = await queries.getConnector(connectorId);
  if (!connector || connector.repositoryId !== repositoryId) {
    throw new Error("Forbidden: Connector does not belong to this repository");
  }
  return connector.environmentId ?? null;
}

export async function createMigration(
  repositoryId: string,
  input: MigrationProjectInput,
): Promise<MigrationProject> {
  const session = await guardRepo(repositoryId);
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  if (await queries.projectNameTaken(repositoryId, name)) {
    throw new Error(`A migration called "${name}" already exists`);
  }

  const project = await queries.createMigrationProject({
    repositoryId,
    name,
    description: input.description?.trim() || undefined,
    sourceConnectorId: input.sourceConnectorId ?? null,
    targetConnectorId: input.targetConnectorId ?? null,
    sourceEnvironmentId: await environmentOf(
      input.sourceConnectorId,
      repositoryId,
    ),
    targetEnvironmentId: await environmentOf(
      input.targetConnectorId,
      repositoryId,
    ),
    config: {},
    createdBy: session.user?.id ?? null,
  });
  refresh(project.id);
  return project;
}

export async function updateMigrationEndpoints(
  projectId: string,
  input: { sourceConnectorId: string | null; targetConnectorId: string | null },
): Promise<void> {
  const { project } = await guardProject(projectId);
  await queries.updateMigrationProject(projectId, {
    sourceConnectorId: input.sourceConnectorId,
    targetConnectorId: input.targetConnectorId,
    sourceEnvironmentId: await environmentOf(
      input.sourceConnectorId,
      project.repositoryId,
    ),
    targetEnvironmentId: await environmentOf(
      input.targetConnectorId,
      project.repositoryId,
    ),
    // Choosing endpoints is what completes Connect; anything further is the
    // flow model's call, so this only ever moves the stage forward off `connect`.
    stage: project.stage === "connect" ? "plan" : project.stage,
    status: project.status === "draft" ? "active" : project.status,
  });
  refresh(projectId);
}

export async function updateMigrationSettings(
  projectId: string,
  input: {
    name?: string;
    description?: string | null;
    config?: MigrationProjectConfig;
    runDir?: string | null;
  },
): Promise<void> {
  const { project } = await guardProject(projectId);
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Name is required");
    if (await queries.projectNameTaken(project.repositoryId, name, projectId)) {
      throw new Error(`A migration called "${name}" already exists`);
    }
  }
  // The config blob is replaced wholesale rather than merged: the settings form
  // sends the complete object it rendered, and a partial merge would make
  // clearing a field (back to the engine default) impossible to express.
  await queries.updateMigrationProject(projectId, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.description !== undefined
      ? { description: input.description?.trim() || null }
      : {}),
    ...(input.config !== undefined ? { config: input.config } : {}),
    ...(input.runDir !== undefined ? { runDir: input.runDir || null } : {}),
  });
  refresh(projectId);
}

export async function deleteMigration(projectId: string): Promise<void> {
  const { project } = await guardProject(projectId);
  const active = await queries.activeMigrationRuns(projectId);
  if (active.length) {
    throw new Error(
      "A run is still in flight. Wait for it to finish before deleting this migration.",
    );
  }
  await queries.deleteMigrationProject(projectId);
  revalidatePath("/migrations");
  void project;
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

export async function createWave(
  projectId: string,
  input: {
    key: string;
    label: string;
    countries: string[];
    plannedAt?: string | null;
  },
): Promise<MigrationWave> {
  await guardProject(projectId);
  const key = input.key.trim().toLowerCase();
  if (!WAVE_KEY_RE.test(key)) {
    throw new Error(
      "Wave key must start with a lowercase letter and contain only lowercase letters, digits and hyphens (e.g. eu1, apac-pilot)",
    );
  }
  if (await queries.waveKeyTaken(projectId, key)) {
    throw new Error(`A wave called "${key}" already exists`);
  }
  const countries = normaliseCountries(input.countries);
  if (!countries.length) throw new Error("A wave needs at least one country");

  const existing = await queries.listMigrationWaves(projectId);
  const wave = await queries.createMigrationWave({
    projectId,
    key,
    label: input.label.trim() || key,
    countries,
    plannedAt: input.plannedAt ? new Date(input.plannedAt) : null,
    sortOrder: existing.length,
  });
  refresh(projectId);
  return wave;
}

function normaliseCountries(input: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of input) {
    const iso = raw.trim().toUpperCase();
    if (!iso) continue;
    // `GLOBAL` is the engine's pseudo-country for objects that have no country
    // dimension (§0.2). It is never a wave member — global units run in every
    // wave automatically — so rejecting it here beats a confusing plan.
    if (iso === "GLOBAL") {
      throw new Error(
        "GLOBAL is not a wave member — global objects are included in every wave automatically.",
      );
    }
    if (!ISO_RE.test(iso)) {
      throw new Error(`"${raw}" is not an ISO-3166 alpha-2 country code`);
    }
    seen.add(iso);
  }
  return [...seen];
}

export async function updateWave(
  waveId: string,
  input: {
    label?: string;
    countries?: string[];
    plannedAt?: string | null;
    freezeAt?: string | null;
  },
): Promise<void> {
  const wave = await queries.getMigrationWave(waveId);
  if (!wave) throw new Error("Forbidden: Wave not found");
  await guardProject(wave.projectId);
  if (wave.status === "signed_off") {
    throw new Error("This wave is signed off and can no longer be edited.");
  }
  await queries.updateMigrationWave(waveId, {
    ...(input.label !== undefined
      ? { label: input.label.trim() || wave.key }
      : {}),
    ...(input.countries !== undefined
      ? { countries: normaliseCountries(input.countries) }
      : {}),
    ...(input.plannedAt !== undefined
      ? { plannedAt: input.plannedAt ? new Date(input.plannedAt) : null }
      : {}),
    ...(input.freezeAt !== undefined
      ? {
          freezeAt: input.freezeAt ? new Date(input.freezeAt) : null,
          // Recording the freeze IS entering cutover — there is no separate
          // "start cutover" button, because the freeze is the real-world event.
          status: input.freezeAt ? "frozen" : "in_progress",
        }
      : {}),
  });
  refresh(wave.projectId);
}

export async function deleteWave(waveId: string): Promise<void> {
  const wave = await queries.getMigrationWave(waveId);
  if (!wave) throw new Error("Forbidden: Wave not found");
  await guardProject(wave.projectId);
  if (wave.status === "signed_off") {
    throw new Error("A signed-off wave cannot be deleted.");
  }
  await queries.deleteMigrationWave(waveId);
  refresh(wave.projectId);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * Rebuild the flow state server-side from current rows.
 *
 * The console already computed this to render the rail, but the action must
 * not trust it: a tab left open across a sign-off would otherwise be able to
 * start a delta against a frozen wave.
 */
async function currentFlow(projectId: string, waveId: string | null) {
  const [waves, runs] = await Promise.all([
    queries.listMigrationWaves(projectId),
    queries.listMigrationRuns(projectId, 100),
  ]);
  const project = await queries.getMigrationProject(projectId);
  const wave = waveId
    ? (waves.find((w) => w.id === waveId) ?? null)
    : (waves[0] ?? null);
  return {
    wave,
    waves,
    flow: deriveFlowState({
      hasSource: Boolean(project?.sourceConnectorId),
      hasTarget: Boolean(project?.targetConnectorId),
      wave: wave
        ? {
            id: wave.id,
            status: wave.status,
            countries: wave.countries,
            freezeAt: wave.freezeAt,
          }
        : null,
      runs: runs
        .filter((r) => !r.waveId || r.waveId === wave?.id)
        .map((r) => ({
          id: r.id,
          mode: r.mode,
          status: r.status,
          dryRun: r.dryRun,
          waveId: r.waveId,
          startedAt: r.startedAt,
          blockingFindings: r.summary?.findings?.blocking,
          gate: r.summary?.gate,
        })),
      // A plan needs no run of its own: a wave with countries and both ends
      // connected can always be planned, and the Plan stage builds it live.
      planned: Boolean(wave && wave.countries.length > 0),
    }),
  };
}

/** Decrypt both connectors. Server-only; the result never leaves this module. */
async function resolveSecrets(project: MigrationProject) {
  const [source, target] = await Promise.all([
    readConnector(project.sourceConnectorId, "Salesforce org"),
    readConnector(project.targetConnectorId, "Vault"),
  ]);
  if (!source)
    throw new MigrationConfigError("No Salesforce org is connected.");
  if (!target) throw new MigrationConfigError("No Vault is connected.");
  return { source, target };
}

/**
 * Read one connector with its credential decrypted.
 *
 * A decrypt failure is turned into a `MigrationConfigError` rather than left to
 * propagate. It is not a bug when it happens — `ENCRYPTION_KEY` was rotated
 * without running the rotation script, or the row was restored from a backup
 * taken under a different key — and the operator needs the one sentence that
 * tells them what to do, not a 500 with a cipher stack trace.
 */
async function readConnector(
  connectorId: string | null,
  what: string,
): Promise<Awaited<ReturnType<typeof queries.getConnectorForConnection>>> {
  if (!connectorId) return undefined;
  try {
    return await queries.getConnectorForConnection(connectorId);
  } catch {
    throw new MigrationConfigError(
      `The ${what} connector's stored credential could not be read. It was encrypted with a different ENCRYPTION_KEY than this deployment holds — re-enter it under Settings → Integrations, or run the key-rotation script.`,
    );
  }
}

export interface StartRunInput {
  projectId: string;
  stage: MigrationStage;
  waveId?: string | null;
  /** Narrow the wave to a subset of its countries. */
  countries?: string[];
  objects?: string[];
  /** `retry-failed` / `blobs` — the engine run being repaired. */
  parentEngineRunId?: string;
  justification?: string;
}

export type StartRunResult =
  | { ok: true; runId: string }
  | { ok: false; error: string };

export async function startMigrationRun(
  input: StartRunInput,
): Promise<StartRunResult> {
  const { project } = await guardProject(input.projectId);
  const session = await getCurrentSession();
  const { wave, waves, flow } = await currentFlow(
    input.projectId,
    input.waveId ?? null,
  );

  const gate = canLaunch(input.stage, flow);
  if (!gate.ok) return { ok: false, error: gate.reason };

  const def = STAGE_BY_KEY[input.stage];
  if (!def.mode) return { ok: false, error: "This step has no run." };
  if (!wave) return { ok: false, error: "Add a wave before running anything." };

  // `final-delta` is the one mode with a hard precondition of its own: the
  // freeze timestamp is `wm_hi` for every unit of the wave (§4.5), and running
  // it without one would silently use "now" — a moving target during a cutover.
  if (def.mode === "final-delta" && !wave.freezeAt) {
    return {
      ok: false,
      error:
        "Record the Salesforce freeze timestamp before running the final delta.",
    };
  }

  const countries = input.countries?.length
    ? input.countries.filter((c) => wave.countries.includes(c))
    : wave.countries;
  if (!countries.length) {
    return { ok: false, error: "No countries selected for this run." };
  }

  try {
    const { source, target } = await resolveSecrets(project);
    const config: BuildConfigInput = {
      project,
      source: source.connector,
      target: target.connector,
      waves,
      stateDatabaseUrl: process.env.DATABASE_URL,
    };
    // Built (and thrown away) here purely to surface a config error on the
    // button. `launchMigrationRun` builds it again for real; the duplicate is
    // cheap and keeps the "never return a config with secrets" rule intact.
    buildConfigSkeleton(config);

    const result = await launchMigrationRun({
      projectId: project.id,
      repositoryId: project.repositoryId,
      waveId: wave.id,
      mode: def.mode,
      dryRun: input.stage === "dryrun",
      countries,
      objects: input.objects,
      parentEngineRunId: input.parentEngineRunId,
      freezeAt: wave.freezeAt,
      justification: input.justification,
      startedBy: session?.user?.id ?? null,
      config,
      secrets: {
        source: {
          authMethod: source.connector.authMethod,
          secrets: source.secrets,
        },
        target: {
          authMethod: target.connector.authMethod,
          secrets: target.secrets,
        },
      },
    });
    if (!result.ok) return result;

    if (wave.status === "planned") {
      await queries.updateMigrationWave(wave.id, { status: "in_progress" });
    }
    await queries.updateMigrationProject(project.id, {
      stage: input.stage,
      status: project.status === "draft" ? "active" : project.status,
    });
    refresh(project.id);
    return { ok: true, runId: result.run.id };
  } catch (err) {
    if (err instanceof MigrationConfigError)
      return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Abandon a run the console can no longer see progress for.
 *
 * This does NOT stop the engine: the run is an in-process promise with no
 * cancellation token, and pretending otherwise would be worse than saying so.
 * What it does is release the one-run-at-a-time guard, which is the thing an
 * operator is actually stuck on when a run has hung. The loads themselves are
 * idempotent and the watermark has not advanced, so re-running is safe — that
 * is the sentence the UI shows before this action fires.
 */
export async function abandonMigrationRun(runId: string): Promise<void> {
  const run = await queries.getMigrationRun(runId);
  if (!run) throw new Error("Forbidden: Run not found");
  await guardProject(run.projectId);
  await queries.updateMigrationRun(runId, {
    status: "aborted",
    error:
      "Abandoned by an operator. The engine may still be finishing in the background.",
    finishedAt: new Date(),
  });
  refresh(run.projectId);
}

// ---------------------------------------------------------------------------
// Findings and sign-off
// ---------------------------------------------------------------------------

export async function acceptFinding(input: {
  projectId: string;
  code: string;
  objectKey?: string;
  country?: string;
  justification: string;
}): Promise<void> {
  await guardProject(input.projectId);
  const session = await getCurrentSession();
  const justification = input.justification.trim();
  if (!justification) {
    throw new Error(
      "A reason is required — an accepted finding without one is not a decision.",
    );
  }
  await queries.acknowledgeFinding({
    projectId: input.projectId,
    code: input.code,
    objectKey: input.objectKey,
    country: input.country,
    justification,
    acknowledgedBy: session?.user?.id ?? null,
  });
  refresh(input.projectId);
}

export async function revokeFinding(
  projectId: string,
  ackId: string,
): Promise<void> {
  await guardProject(projectId);
  await queries.revokeFindingAck(ackId);
  refresh(projectId);
}

export async function signOffWave(input: {
  waveId: string;
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const wave = await queries.getMigrationWave(input.waveId);
  if (!wave) throw new Error("Forbidden: Wave not found");
  await guardProject(wave.projectId);
  const session = await getCurrentSession();

  // `canAdvance`, not `canLaunch`: signing off runs nothing, and `canLaunch`
  // refuses any stage without an engine mode.
  const { flow } = await currentFlow(wave.projectId, wave.id);
  const gate = canAdvance("signoff", flow);
  if (!gate.ok) return { ok: false, error: gate.reason };

  await queries.updateMigrationWave(input.waveId, {
    status: "signed_off",
    signedOffAt: new Date(),
    signedOffBy: session?.user?.id ?? null,
    signOffNote: input.note?.trim() || null,
  });

  // The project is signed off only once EVERY wave is — a five-wave programme
  // is not finished because its pilot is.
  const waves = await queries.listMigrationWaves(wave.projectId);
  if (waves.every((w) => w.status === "signed_off")) {
    await queries.updateMigrationProject(wave.projectId, {
      status: "signed_off",
      stage: "signoff",
    });
  }
  refresh(wave.projectId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Crosswalk
// ---------------------------------------------------------------------------

/**
 * Look one id up in the crosswalk, in whichever direction it was given.
 *
 * An 18-character id starting `00`/`a0` is a Salesforce id and a `V…` one is a
 * Vault id, but rather than parse shapes this tries the source direction first
 * and falls back to the reverse index — a wrong guess costs one indexed lookup
 * and a shape rule would be wrong the first time a customer's org uses a key
 * prefix nobody predicted.
 */
export async function lookupCrosswalk(
  projectId: string,
  objectKey: string,
  id: string,
): Promise<string | null> {
  const { project } = await guardProject(projectId);
  const target = project.targetConnectorId
    ? await queries.getConnector(project.targetConnectorId)
    : undefined;
  const vaultDns = (target?.config as { vaultDns?: string } | undefined)
    ?.vaultDns;

  const { engineTarget, lookupCrosswalkBySfdcId, lookupCrosswalkByVaultId } =
    await import("@/lib/migration/engine-store");
  const store = engineTarget(vaultDns);

  const forward = await lookupCrosswalkBySfdcId(store, objectKey, id);
  if (forward) {
    return `${forward.sfdcId} → ${forward.vaultId ?? "—"} · ${forward.vaultObject ?? ""} · ${forward.country ?? ""}${forward.deletedAt ? " · tombstoned" : ""}`;
  }

  // The reverse index is keyed on the VAULT object name, which the caller does
  // not know — it knows the object KEY. Both spellings are tried so a paste
  // from a VQL result works without the user translating `account` to
  // `account__v`.
  for (const vaultObject of [objectKey, `${objectKey}__v`]) {
    const back = await lookupCrosswalkByVaultId(store, vaultObject, id);
    if (back) {
      return `${back.vaultId} → ${back.sfdcId} · ${back.objectKey} · ${back.country ?? ""}${back.deletedAt ? " · tombstoned" : ""}`;
    }
  }
  return null;
}
