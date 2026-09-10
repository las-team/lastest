/**
 * Launching an engine run from the console.
 *
 * Shape follows `src/lib/coverage/sync-job.ts`, which is this codebase's
 * established pattern for "long work started by a click": a `background_jobs`
 * row is created so the queue indicator and the jobs panel see it, the work
 * itself is an in-process promise, and a heartbeat keeps the watchdog from
 * declaring a slow run dead.
 *
 * A migration run is longer and heavier than a coverage sync, so two things
 * are stricter here:
 *
 *  - **One run per project at a time.** Not a nicety: two inits against the
 *    same Vault would interleave upserts and both advance watermarks. The
 *    guard is a DB read (`activeMigrationRuns`), not a process-local lock,
 *    because two app replicas must not both start one.
 *  - **The engine's own run id is written back as soon as it exists.** That id
 *    is the only join into the engine's state store; a run whose id was never
 *    recorded is a run nobody can inspect afterwards.
 */

import "server-only";
import * as queries from "@/lib/db/queries";
import { getLogger } from "@/lib/logger";
import type {
  MigrationRun,
  MigrationRunMode,
  MigrationRunSummary,
} from "@/lib/db/schema";
import {
  buildConfigSkeleton,
  withSecrets,
  MigrationConfigError,
  type BuildConfigInput,
} from "./config-builder";
import {
  engineTarget,
  listEngineFindings,
  listReconciliation,
  countFindingsBySeverity,
  summariseReconciliation,
} from "./engine-store";

const log = getLogger("Migration");

/** Heartbeat cadence — the stale-job watchdog fires at 5 minutes. */
const HEARTBEAT_INTERVAL_MS = 30_000;

export interface LaunchInput {
  projectId: string;
  repositoryId: string;
  waveId: string | null;
  mode: MigrationRunMode;
  dryRun?: boolean;
  countries: string[];
  objects?: string[];
  /** `retry-failed --run` / `blobs --run`. */
  parentEngineRunId?: string;
  freezeAt?: Date | null;
  justification?: string;
  startedBy?: string | null;
  /** Everything the config builder needs, resolved by the caller. */
  config: BuildConfigInput;
  /** Decrypted credentials — resolved by the caller and never stored. */
  secrets: {
    source: { authMethod: string; secrets: Record<string, string> };
    target: { authMethod: string; secrets: Record<string, string> };
  };
}

export type LaunchResult =
  | { ok: true; run: MigrationRun }
  | { ok: false; error: string };

/**
 * Start a run. Returns as soon as the row exists — the console polls it.
 *
 * The config is built and validated BEFORE the run row is written, so a
 * misconfigured migration produces a message on the button rather than a
 * failed run in the history.
 */
export async function launchMigrationRun(
  input: LaunchInput,
): Promise<LaunchResult> {
  const active = await queries.activeMigrationRuns(input.projectId);
  if (active.length > 0) {
    return {
      ok: false,
      error: `A ${active[0].mode} run is already in flight for this migration. Wait for it to finish, or open it to follow along.`,
    };
  }

  let config: Record<string, unknown>;
  try {
    const skeleton = buildConfigSkeleton(input.config);
    config = withSecrets(skeleton, input.secrets.source, input.secrets.target);
  } catch (err) {
    if (err instanceof MigrationConfigError)
      return { ok: false, error: err.message };
    throw err;
  }

  const run = await queries.createMigrationRun({
    projectId: input.projectId,
    waveId: input.waveId,
    mode: input.mode,
    dryRun: input.dryRun ?? false,
    countries: input.countries,
    objects: input.objects ?? null,
    parentRunId: input.parentEngineRunId ?? null,
    freezeAt: input.freezeAt ?? null,
    justification: input.justification ?? null,
    startedBy: input.startedBy ?? null,
  });

  const { createJob } = await import("@/server/actions/jobs");
  const jobId = await createJob(
    "migration_run",
    `Migration: ${input.mode}${input.dryRun ? " (dry run)" : ""}`,
    1,
    input.repositoryId,
    // Metadata is broadcast to every subscriber of the jobs panel. It carries
    // ids only — never a host, never a country list that identifies a customer
    // programme, and above all never anything from `config`.
    { migrationRunId: run.id, migrationProjectId: input.projectId },
  );
  await queries.updateMigrationRun(run.id, { jobId, status: "running" });

  // Fire-and-forget: the caller returns to the browser immediately. Every
  // failure path inside must write the run row, which is why the whole body is
  // wrapped rather than relying on `execute()` to throw predictably.
  void executeRun({
    runId: run.id,
    jobId,
    mode: input.mode,
    dryRun: input.dryRun ?? false,
    countries: input.countries,
    objects: input.objects,
    parentEngineRunId: input.parentEngineRunId,
    freezeAt: input.freezeAt ?? null,
    justification: input.justification,
    config,
    vaultDns: String(
      (config.target as Record<string, unknown> | undefined)?.vaultDns ?? "",
    ),
  }).catch((err) => {
    log.error(
      { err, runId: run.id },
      "migration run crashed outside its own handler",
    );
  });

  return { ok: true, run: { ...run, jobId, status: "running" } };
}

interface ExecuteInput {
  runId: string;
  jobId: string;
  mode: MigrationRunMode;
  dryRun: boolean;
  countries: string[];
  objects?: string[];
  parentEngineRunId?: string;
  freezeAt: Date | null;
  justification?: string;
  config: Record<string, unknown>;
  vaultDns: string;
}

async function executeRun(input: ExecuteInput): Promise<void> {
  const { completeJob, failJob, updateJobActivity } =
    await import("@/server/actions/jobs");

  const heartbeat = setInterval(() => {
    // Best effort throughout — a failed heartbeat must never take the run down
    // with it. Worst case the watchdog fails the JOB row while the run keeps
    // going; the run row is the source of truth and is written at the end.
    updateJobActivity(input.jobId).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const { runMigration, MigrationConfigSchema } =
      await import("@lastest/veeva-migration");

    // Parsed here rather than trusted from `buildConfigSkeleton`: this is the
    // last point before the engine, and the engine's own schema is the only
    // definition of a valid config that cannot drift from the engine.
    const parsed = MigrationConfigSchema.parse(input.config);

    const summary = await runMigration({
      mode: input.mode,
      config: parsed,
      countries: input.countries.length ? input.countries : undefined,
      objects: input.objects as never,
      dryRun: input.dryRun,
      runId: input.parentEngineRunId,
      freezeAt: input.freezeAt?.toISOString(),
      justification: input.justification,
    });

    const target = engineTarget(input.vaultDns);
    const [findings, recon] = await Promise.all([
      listEngineFindings(target, summary.runId),
      listReconciliation(target, summary.runId),
    ]);
    const rows = summariseReconciliation(recon);
    const runSummary: MigrationRunSummary = {
      exitCode: summary.exitCode,
      units: {
        total: summary.units.length,
        succeeded: summary.units.filter((u) => u.status === "succeeded").length,
        failed: summary.units.filter((u) => u.status === "failed").length,
        blocked: summary.units.filter((u) => u.status === "blocked").length,
        skipped: summary.units.filter((u) => u.status === "skipped").length,
      },
      findings: countFindingsBySeverity(findings),
      rows: {
        extracted: rows.extracted,
        created: rows.created,
        updated: rows.updated,
        unchanged: rows.unchanged,
        skipped: rows.skipped,
        failed: rows.failed,
        pendingFk: rows.pendingFk,
        deleted: rows.deleted,
      },
      gate: rows.gate,
      reportPath: summary.reportPath,
    };

    await queries.updateMigrationRun(input.runId, {
      engineRunId: summary.runId,
      // The engine's exit code is the verdict, not the absence of a thrown
      // error: 2 is blocking findings, 3 unit failures, 4 a failed gate. All
      // three "completed" without throwing and none of them is a success.
      status:
        summary.exitCode === 0
          ? "succeeded"
          : summary.exitCode === 2
            ? "blocked"
            : "failed",
      summary: runSummary,
      finishedAt: new Date(),
    });
    await completeJob(input.jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { err, runId: input.runId, mode: input.mode },
      "migration run failed",
    );
    await queries
      .updateMigrationRun(input.runId, {
        status: "failed",
        error: message,
        finishedAt: new Date(),
      })
      .catch(() => {});
    await failJob(input.jobId, message).catch(() => {});
  } finally {
    clearInterval(heartbeat);
  }
}
