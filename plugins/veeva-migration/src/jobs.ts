import path from "node:path";

import type { JobRun, PluginContext } from "@lastest/contracts";

import {
  buildConfigSkeleton,
  withSecrets,
  MigrationConfigError,
} from "./config-builder";
import { db, orm, type VeevaMigrationDb } from "./data/db";
import * as queries from "./data/queries";
import type { VeevaMigrationHost } from "./host";
import {
  countFindingsBySeverity,
  listEngineFindings,
  listReconciliation,
  summariseReconciliation,
} from "./reads";
import { PluginDataStateStore } from "./store/plugin-data-store";
import { veevaMigrationWiring } from "./wiring";
import type { MigrationRunSummary } from "./schema";

export const MIGRATION_RUN_JOB = "veeva-migration.run";

/**
 * The one entry point that runs a migration.
 *
 * Before this, `launchMigrationRun` created a `background_jobs` row for the
 * queue indicator and then started the engine as a **detached in-process
 * promise**, heartbeating the row every 30 seconds. Four things were wrong with
 * that, and they were all symptoms of the same thing — nothing owned the run:
 *
 *  - **Nothing could stop it.** `abandonMigrationRun` said so in its own
 *    comment: it marked the row aborted and released the one-run-per-project
 *    guard while the engine kept extracting from Salesforce and upserting into
 *    a live Vault. `run.signal` below is the token that was missing, and it
 *    reaches the engine as `RunContext.signal`.
 *  - **A deploy mid-run locked the project forever.** The compensating sweeper
 *    (`failStaleMigrationRuns`) shipped with zero callers. Core's queue now
 *    accounts for a claimed job whose worker died, and
 *    `reconcileStaleRuns` below closes the remaining gap.
 *  - **Run state lived in two tables with no reconciliation.** It still lives
 *    in two (`plugin_jobs` and this plugin's run row), but the queue is now the
 *    owner and the plugin row follows it, rather than two peers drifting.
 *  - **Plaintext credentials sat in a closure** for the life of a multi-hour
 *    run. They are resolved here, at the moment of use, from ids in the
 *    payload — the job row carries **no secrets and no config**, which matters
 *    because a `plugin_jobs` payload is persisted.
 *
 * `maxAttempts: 1` is deliberate (see `enqueueMigrationRun`): a half-applied
 * migration must never be silently retried by a queue.
 */
export interface MigrationRunPayload {
  /** `veeva_migration_runs.id`. Everything else is read from it. */
  readonly runId: string;
}

function isPayload(value: unknown): value is MigrationRunPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { runId?: unknown }).runId === "string"
  );
}

/**
 * Enqueue a run. Returns as soon as the row and the job exist.
 *
 * The one-run-per-project guard stays a database read of this plugin's own
 * rows, not a process-local lock, because two app replicas must not both start
 * one. `dedupeKey` is a second, cheaper guard in front of it, collapsing a
 * double-click before it reaches the queue at all.
 */
export async function enqueueMigrationRun(
  ctx: PluginContext<"data" | "jobs">,
  input: {
    projectId: string;
    waveId: string | null;
    mode: Parameters<typeof queries.createMigrationRun>[1]["mode"];
    dryRun?: boolean;
    countries: string[];
    objects?: string[];
    parentEngineRunId?: string;
    freezeAt?: Date | null;
    justification?: string;
    startedBy: string;
  },
): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const database = orm(ctx.data);
  const active = await queries.activeMigrationRuns(database, input.projectId);
  if (active.length > 0) {
    return {
      ok: false,
      error: `A ${active[0]!.mode} run is already in flight for this migration. Wait for it to finish, or open it to follow along.`,
    };
  }

  const run = await queries.createMigrationRun(database, {
    projectId: input.projectId,
    waveId: input.waveId,
    mode: input.mode,
    dryRun: input.dryRun ?? false,
    countries: input.countries,
    objects: input.objects ?? null,
    parentRunId: input.parentEngineRunId ?? null,
    freezeAt: input.freezeAt ?? null,
    justification: input.justification ?? null,
    startedBy: input.startedBy,
  });

  const job = await ctx.jobs.enqueue(
    MIGRATION_RUN_JOB,
    { runId: run.id } satisfies MigrationRunPayload,
    {
      dedupeKey: `veeva-migration:run:${input.projectId}`,
      // Never retried. A migration is not idempotent from the *queue's* point
      // of view: the engine is safe to re-run deliberately (an interrupted
      // init is a delta), but a worker crash that a queue silently retries
      // would start a second load against a live Vault with nobody watching.
      maxAttempts: 1,
    },
  );
  await queries.updateMigrationRun(database, run.id, { jobId: job.id });
  return { ok: true, runId: run.id };
}

/** The handler core's job worker invokes. Registered in the manifest. */
export async function runMigrationJob(
  ctx: PluginContext<"data" | "jobs">,
  payload: unknown,
  run: JobRun,
): Promise<void> {
  if (!isPayload(payload))
    throw new Error(`${MIGRATION_RUN_JOB}: payload has no runId`);
  const database = orm(ctx.data);
  const { host, connectorDefaults } = veevaMigrationWiring();
  await executeRun(database, host, connectorDefaults, payload.runId, run);
}

async function executeRun(
  database: VeevaMigrationDb,
  host: VeevaMigrationHost,
  connectorDefaults: { salesforceApiVersion: string; vaultApiVersion: string },
  runId: string,
  job: JobRun,
): Promise<void> {
  const runRow = await queries.getMigrationRun(database, runId);
  if (!runRow) throw new Error(`migration run ${runId} not found`);

  const detail = await queries.getMigrationProjectWithWaves(
    database,
    runRow.projectId,
  );
  if (!detail)
    throw new Error(`migration project ${runRow.projectId} not found`);
  const { project, waves } = detail;

  const fail = (error: string) =>
    queries.updateMigrationRun(database, runId, {
      status: "failed",
      error,
      finishedAt: new Date(),
    });

  try {
    await queries.updateMigrationRun(database, runId, { status: "running" });

    const endpoints = await host.resolveEndpoints(project.repositoryId, {
      sourceConnectorId: project.sourceConnectorId,
      targetConnectorId: project.targetConnectorId,
    });

    const skeleton = buildConfigSkeleton({
      project,
      source: endpoints.source,
      target: endpoints.target,
      waves,
      apiDefaults: connectorDefaults,
    });

    // Resolved here, at the moment of use, and never persisted or logged.
    const [sourceSecrets, targetSecrets] = await Promise.all([
      host.resolveConnectorSecrets(endpoints.source!.id),
      host.resolveConnectorSecrets(endpoints.target!.id),
    ]);
    const config = withSecrets(skeleton, sourceSecrets, targetSecrets);

    const { MigrationConfigSchema } =
      await import("@lastest/veeva-migration/config/schema");
    // Parsed against the engine's own schema rather than trusted from the
    // builder: this is the last point before the engine, and its schema is the
    // only definition of a valid config that cannot drift from it.
    const parsed = MigrationConfigSchema.parse(config);

    const vaultDns = parsed.target.vaultDns;
    const runDir = path.join(
      host.runArtifactRoot(project.teamId, project.id),
      // The engine appends its own run id; this keeps one plugin run's
      // artifacts together even when it retries the engine.
      runRow.id,
    );

    const store = new PluginDataStateStore({
      db: database,
      projectId: project.id,
      vaultDns,
    });

    const { runMigration } = await import("@lastest/veeva-migration/run");
    const summary = await runMigration(
      {
        mode: runRow.mode,
        config: parsed,
        context: {
          tenantKey: project.id,
          // The acting user, not `process.env.USER`. This is the value the
          // engine stamps on every audit entry.
          actor: runRow.startedBy ?? "unknown",
          runDir,
          signal: job.signal,
        },
        countries: runRow.countries.length ? runRow.countries : undefined,
        objects: (runRow.objects ?? undefined) as never,
        dryRun: runRow.dryRun,
        runId: runRow.parentRunId ?? undefined,
        freezeAt: runRow.freezeAt?.toISOString(),
        justification: runRow.justification ?? undefined,
      },
      { wiring: { stateStore: store } },
    );

    const target = { db: database, projectId: project.id, vaultDns };
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

    await queries.updateMigrationRun(database, runId, {
      engineRunId: summary.runId,
      // The engine's exit code is the verdict, not the absence of a thrown
      // error: 2 is blocking findings, 3 unit failures, 4 a failed gate, 6 a
      // cancellation. None of them is a success and only one is a fault.
      status:
        summary.exitCode === 0
          ? "succeeded"
          : summary.exitCode === 2
            ? "blocked"
            : summary.exitCode === 6
              ? "aborted"
              : "failed",
      summary: runSummary,
      finishedAt: new Date(),
    });
  } catch (err) {
    const message =
      err instanceof MigrationConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`[Migration] run ${runId} failed`, err);
    await fail(message).catch(() => {});
    // Rethrown so core's queue records the attempt as failed too. Without it
    // the job row would read "done" beside a failed run — the two-table drift
    // this design is meant to end.
    throw err;
  }
}

/**
 * Settle run rows whose executing process died between the engine finishing and
 * the row being written.
 *
 * Core's queue handles the job row; this handles the plugin's own. Called from
 * the same tick that drives the worker, which is the wiring
 * `failStaleMigrationRuns` never had.
 */
export async function reconcileStaleRuns(staleMs?: number): Promise<number> {
  return queries.failStaleMigrationRuns(db(), staleMs);
}
