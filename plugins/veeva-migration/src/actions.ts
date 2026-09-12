"use server";

import { revalidatePath } from "next/cache";

import { orm } from "./data/db";
import * as queries from "./data/queries";
import { enqueueMigrationRun } from "./jobs";
import { buildConfigSkeleton, MigrationConfigError } from "./config-builder";
import { canAdvance, canLaunch, deriveFlowState, STAGE_BY_KEY } from "./flow";
import { lookupCrosswalkBySfdcId, lookupCrosswalkByVaultId } from "./reads";
import { veevaMigrationPlugin } from "./index";
import { veevaMigrationWiring } from "./wiring";
import type {
  MigrationProject,
  MigrationProjectConfig,
  MigrationStage,
  MigrationWave,
} from "./schema";

/**
 * Server actions for the migration console.
 *
 * Every action goes through `guardProject` / `guardRepo`, which are now one
 * host call (`assertRepoSettingsAccess`) enforcing all three gates it used to
 * take three imports to enforce: a session exists, the member holds
 * `repos:settings` on the repository, and the team is in Early Adopter mode.
 * The console renders behind the same check, but the check on the action is the
 * one that counts — a page gate is a hint, an action gate is the control.
 *
 * Secrets never travel through an action's arguments or return value, and they
 * no longer travel through this module at all: the run is a `plugin_jobs` row
 * carrying one id, and the job handler resolves credentials at the moment it
 * starts the engine (`./jobs.ts`). That is stricter than before, where the
 * action decrypted both connectors and handed the plaintext to a launcher.
 */

/** Engine `waves[].name`, and it lands in every run's audit trail. */
const WAVE_KEY_RE = /^[a-z][a-z0-9-]*$/;
const ISO_RE = /^[A-Z]{2}$/;

function refresh(projectId?: string) {
  revalidatePath("/migrations");
  if (projectId) revalidatePath(`/migrations/${projectId}`);
}

/** Authorise for a repository and return the acting user, their team and a db. */
async function guardRepo(repositoryId: string) {
  const { host, runtime } = veevaMigrationWiring();
  const actor = await host.assertRepoSettingsAccess(repositoryId);
  const ctx = await runtime.contextFor(veevaMigrationPlugin, { repositoryId });
  return { actor, ctx, db: orm(ctx.data) };
}

/**
 * Authorise for a project.
 *
 * The project row is read with the *unscoped* plugin handle before the guard
 * runs, because the repository id to authorise against is on the row. That is
 * the same order the pre-migration `guardProject` used and it is safe for the
 * same reason: nothing is returned to the caller until the guard has passed.
 */
async function guardProject(projectId: string) {
  const { data } = veevaMigrationWiring();
  const project = await queries.getMigrationProject(orm(data), projectId);
  if (!project) throw new Error("Forbidden: Migration not found");
  const guard = await guardRepo(project.repositoryId);
  return { project, ...guard };
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
 * Resolve both connectors' environments, for denormalisation onto the project.
 *
 * The environment is stored on the project rather than joined at read time so a
 * deleted connector still says which environment it pointed at — a signed-off
 * cutover record that cannot name its target is not a record. Ownership is
 * checked inside `resolveEndpoints`, so a connector from another repository
 * comes back `null` rather than resolved.
 */
async function environmentsOf(
  repositoryId: string,
  sourceConnectorId: string | null,
  targetConnectorId: string | null,
): Promise<{
  sourceEnvironmentId: string | null;
  targetEnvironmentId: string | null;
}> {
  const { host } = veevaMigrationWiring();
  const ends = await host.resolveEndpoints(repositoryId, {
    sourceConnectorId,
    targetConnectorId,
  });
  if (sourceConnectorId && !ends.source)
    throw new Error("Forbidden: Connector does not belong to this repository");
  if (targetConnectorId && !ends.target)
    throw new Error("Forbidden: Connector does not belong to this repository");
  return {
    sourceEnvironmentId: ends.source?.environmentId ?? null,
    targetEnvironmentId: ends.target?.environmentId ?? null,
  };
}

export async function createMigration(
  repositoryId: string,
  input: MigrationProjectInput,
): Promise<MigrationProject> {
  const { actor, db } = await guardRepo(repositoryId);
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  if (await queries.projectNameTaken(db, repositoryId, name)) {
    throw new Error(`A migration called "${name}" already exists`);
  }

  const envs = await environmentsOf(
    repositoryId,
    input.sourceConnectorId ?? null,
    input.targetConnectorId ?? null,
  );
  const project = await queries.createMigrationProject(db, {
    repositoryId,
    teamId: actor.teamId,
    name,
    description: input.description?.trim() || undefined,
    sourceConnectorId: input.sourceConnectorId ?? null,
    targetConnectorId: input.targetConnectorId ?? null,
    ...envs,
    config: {},
    createdBy: actor.userId,
  });
  refresh(project.id);
  return project;
}

export async function updateMigrationEndpoints(
  projectId: string,
  input: { sourceConnectorId: string | null; targetConnectorId: string | null },
): Promise<void> {
  const { project, db } = await guardProject(projectId);
  const envs = await environmentsOf(
    project.repositoryId,
    input.sourceConnectorId,
    input.targetConnectorId,
  );
  await queries.updateMigrationProject(db, projectId, {
    sourceConnectorId: input.sourceConnectorId,
    targetConnectorId: input.targetConnectorId,
    ...envs,
    // Choosing endpoints is what completes Connect; anything further is the
    // flow model's call, so this only ever moves the stage forward off `connect`.
    stage: project.stage === "connect" ? "plan" : project.stage,
    status: project.status === "draft" ? "active" : project.status,
  });
  refresh(projectId);
}

/**
 * Rename a migration and edit its decisions.
 *
 * **`runDir` is gone from this action, on purpose.** It was free text with no
 * validation, persisted on the project, and handed straight to `fs.mkdir` by
 * the engine — so any member with `repos:settings` could direct the extract's
 * multi-gigabyte writes at any path the app user could reach. The run directory
 * is now derived by the host from its storage root and the project's ids
 * (`VeevaMigrationHost.runArtifactRoot`) and is not a setting at all.
 */
export async function updateMigrationSettings(
  projectId: string,
  input: {
    name?: string;
    description?: string | null;
    config?: MigrationProjectConfig;
  },
): Promise<void> {
  const { project, db } = await guardProject(projectId);
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Name is required");
    if (
      await queries.projectNameTaken(db, project.repositoryId, name, projectId)
    ) {
      throw new Error(`A migration called "${name}" already exists`);
    }
  }
  // The config blob is replaced wholesale rather than merged: the settings form
  // sends the complete object it rendered, and a partial merge would make
  // clearing a field (back to the engine default) impossible to express.
  await queries.updateMigrationProject(db, projectId, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.description !== undefined
      ? { description: input.description?.trim() || null }
      : {}),
    ...(input.config !== undefined ? { config: input.config } : {}),
  });
  refresh(projectId);
}

export async function deleteMigration(projectId: string): Promise<void> {
  const { db } = await guardProject(projectId);
  const active = await queries.activeMigrationRuns(db, projectId);
  if (active.length) {
    throw new Error(
      "A run is still in flight. Wait for it to finish before deleting this migration.",
    );
  }
  await queries.deleteMigrationProject(db, projectId);
  revalidatePath("/migrations");
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
  const { db } = await guardProject(projectId);
  const key = input.key.trim().toLowerCase();
  if (!WAVE_KEY_RE.test(key)) {
    throw new Error(
      "Wave key must start with a lowercase letter and contain only lowercase letters, digits and hyphens (e.g. eu1, apac-pilot)",
    );
  }
  if (await queries.waveKeyTaken(db, projectId, key)) {
    throw new Error(`A wave called "${key}" already exists`);
  }
  const countries = normaliseCountries(input.countries);
  if (!countries.length) throw new Error("A wave needs at least one country");

  const existing = await queries.listMigrationWaves(db, projectId);
  const wave = await queries.createMigrationWave(db, {
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
  const { data } = veevaMigrationWiring();
  const wave = await queries.getMigrationWave(orm(data), waveId);
  if (!wave) throw new Error("Forbidden: Wave not found");
  const { db } = await guardProject(wave.projectId);
  if (wave.status === "signed_off") {
    throw new Error("This wave is signed off and can no longer be edited.");
  }
  await queries.updateMigrationWave(db, waveId, {
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
  const { data } = veevaMigrationWiring();
  const wave = await queries.getMigrationWave(orm(data), waveId);
  if (!wave) throw new Error("Forbidden: Wave not found");
  const { db } = await guardProject(wave.projectId);
  if (wave.status === "signed_off") {
    throw new Error("A signed-off wave cannot be deleted.");
  }
  await queries.deleteMigrationWave(db, waveId);
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
async function currentFlow(
  db: ReturnType<typeof orm>,
  projectId: string,
  waveId: string | null,
) {
  const [waves, runs, project] = await Promise.all([
    queries.listMigrationWaves(db, projectId),
    queries.listMigrationRuns(db, projectId, 100),
    queries.getMigrationProject(db, projectId),
  ]);
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
  const { project, actor, ctx, db } = await guardProject(input.projectId);
  const { host, connectorDefaults } = veevaMigrationWiring();
  const { wave, waves, flow } = await currentFlow(
    db,
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
    // Built (and thrown away) here purely to surface a config error on the
    // button rather than in a failed run's history. The job handler builds it
    // again, with credentials, when it actually starts — which is why this
    // action never holds a secret.
    const endpoints = await host.resolveEndpoints(project.repositoryId, {
      sourceConnectorId: project.sourceConnectorId,
      targetConnectorId: project.targetConnectorId,
    });
    buildConfigSkeleton({
      project,
      source: endpoints.source,
      target: endpoints.target,
      waves,
      apiDefaults: connectorDefaults,
    });

    const result = await enqueueMigrationRun(ctx, {
      projectId: project.id,
      waveId: wave.id,
      mode: def.mode,
      dryRun: input.stage === "dryrun",
      countries,
      objects: input.objects,
      parentEngineRunId: input.parentEngineRunId,
      freezeAt: wave.freezeAt,
      justification: input.justification,
      startedBy: actor.userId,
    });
    if (!result.ok) return result;

    if (wave.status === "planned") {
      await queries.updateMigrationWave(db, wave.id, { status: "in_progress" });
    }
    await queries.updateMigrationProject(db, project.id, {
      stage: input.stage,
      status: project.status === "draft" ? "active" : project.status,
    });
    refresh(project.id);
    return { ok: true, runId: result.runId };
  } catch (err) {
    if (err instanceof MigrationConfigError)
      return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Stop a run.
 *
 * This used to be called `abandonMigrationRun` and it could not stop anything:
 * the run was a detached in-process promise with no cancellation token, and the
 * action's own comment said so. All it did was release the one-run-at-a-time
 * guard while the engine kept extracting from Salesforce and upserting into a
 * live Vault.
 *
 * It now cancels the `plugin_jobs` row, which aborts the handler's
 * `run.signal`, which the engine checks at every unit and batch boundary
 * (`libs/veeva-migration/src/cancel.ts`). The run stops after the batch in
 * flight, so the Vault never sees a half-sent request and the id map stays
 * consistent with what was actually written. Loads are idempotent and the
 * watermark did not advance, so re-running is safe.
 */
export async function cancelMigrationRun(runId: string): Promise<void> {
  const { data } = veevaMigrationWiring();
  const run = await queries.getMigrationRun(orm(data), runId);
  if (!run) throw new Error("Forbidden: Run not found");
  const { ctx, db } = await guardProject(run.projectId);
  if (run.jobId) await ctx.jobs.cancel(run.jobId).catch(() => {});
  await queries.updateMigrationRun(db, runId, {
    status: "aborted",
    error: "Cancelled by an operator.",
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
  const { actor, db } = await guardProject(input.projectId);
  const justification = input.justification.trim();
  if (!justification) {
    throw new Error(
      "A reason is required — an accepted finding without one is not a decision.",
    );
  }
  await queries.acknowledgeFinding(db, {
    projectId: input.projectId,
    code: input.code,
    objectKey: input.objectKey,
    country: input.country,
    justification,
    acknowledgedBy: actor.userId,
  });
  refresh(input.projectId);
}

export async function revokeFinding(
  projectId: string,
  ackId: string,
): Promise<void> {
  const { db } = await guardProject(projectId);
  await queries.revokeFindingAck(db, ackId);
  refresh(projectId);
}

export async function signOffWave(input: {
  waveId: string;
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = veevaMigrationWiring();
  const wave = await queries.getMigrationWave(orm(data), input.waveId);
  if (!wave) throw new Error("Forbidden: Wave not found");
  const { actor, db } = await guardProject(wave.projectId);

  // `canAdvance`, not `canLaunch`: signing off runs nothing, and `canLaunch`
  // refuses any stage without an engine mode.
  const { flow } = await currentFlow(db, wave.projectId, wave.id);
  const gate = canAdvance("signoff", flow);
  if (!gate.ok) return { ok: false, error: gate.reason };

  await queries.updateMigrationWave(db, input.waveId, {
    status: "signed_off",
    signedOffAt: new Date(),
    signedOffBy: actor.userId,
    signOffNote: input.note?.trim() || null,
  });

  // The project is signed off only once EVERY wave is — a five-wave programme
  // is not finished because its pilot is.
  const waves = await queries.listMigrationWaves(db, wave.projectId);
  if (waves.every((w) => w.status === "signed_off")) {
    await queries.updateMigrationProject(db, wave.projectId, {
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
 *
 * Both directions are scoped to this project. Before the migration they were
 * scoped to a `vaultDns` string read off the target connector, which is how a
 * tenant who entered another customer's Vault DNS could page through their
 * crosswalk.
 */
export async function lookupCrosswalk(
  projectId: string,
  objectKey: string,
  id: string,
): Promise<string | null> {
  const { project, db } = await guardProject(projectId);
  const { host } = veevaMigrationWiring();
  const endpoints = await host.resolveEndpoints(project.repositoryId, {
    sourceConnectorId: null,
    targetConnectorId: project.targetConnectorId,
  });
  const vaultDns = (
    endpoints.target?.config as { vaultDns?: string } | undefined
  )?.vaultDns;
  const target = { db, projectId, vaultDns };

  const forward = await lookupCrosswalkBySfdcId(target, objectKey, id);
  if (forward) {
    return `${forward.sfdcId} → ${forward.vaultId ?? "—"} · ${forward.vaultObject ?? ""} · ${forward.country ?? ""}${forward.deletedAt ? " · tombstoned" : ""}`;
  }

  // The reverse index is keyed on the VAULT object name, which the caller does
  // not know — it knows the object KEY. Both spellings are tried so a paste
  // from a VQL result works without the user translating `account` to
  // `account__v`.
  for (const vaultObject of [objectKey, `${objectKey}__v`]) {
    const back = await lookupCrosswalkByVaultId(target, vaultObject, id);
    if (back) {
      return `${back.vaultId} → ${back.sfdcId} · ${back.objectKey} · ${back.country ?? ""}${back.deletedAt ? " · tombstoned" : ""}`;
    }
  }
  return null;
}
