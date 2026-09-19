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
 *    reaches the engine as `RunContext.signal`. Cancel flips the `plugin_jobs`
 *    row; core's worker heartbeats that row every 30 seconds while the handler
 *    runs and aborts the signal when it finds it cancelled. So a cancel reaches
 *    a run that is *already executing*, not only one still waiting — and the
 *    engine stops at its next unit or batch boundary.
 *  - **A deploy mid-run locked the project forever.** `plugin_jobs` rows carry
 *    a lease now (`heartbeat_at`, refreshed by the same worker heartbeat).
 *    Core's reaper fails a `running` job whose lease expired, honouring
 *    `maxAttempts: 1` so the run settles as failed rather than re-executing;
 *    `reconcileStaleRuns` below then follows the job's verdict onto the run row.
 *    Nothing is judged by how long it has been running — an init takes hours.
 *  - **Run state lived in two tables with no reconciliation.** It still lives
 *    in two (`plugin_jobs` and this plugin's run row), but the queue is now the
 *    owner and the plugin row follows it, rather than two peers drifting.
 *    Every terminal write to the run row is conditional on it still being in
 *    flight (`finishMigrationRun`), so an operator's `aborted` is never
 *    overwritten by a verdict that arrives later.
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

const ONE_ACTIVE_RUN_INDEX = "uq_veeva_migration_runs_one_active";

function isOneActiveRunViolation(err: unknown): boolean {
  const e = err as {
    code?: unknown;
    constraint_name?: unknown;
    cause?: unknown;
  };
  const hit = (x: typeof e | undefined) =>
    !!x &&
    x.code === "23505" &&
    (x.constraint_name === undefined ||
      x.constraint_name === ONE_ACTIVE_RUN_INDEX);
  return hit(e) || hit(e?.cause as typeof e | undefined);
}

/**
 * Enqueue a run. Returns as soon as the row and the job exist.
 *
 * The one-run-per-project guard is three layers, each catching what the one
 * before it cannot:
 *
 *  1. A read of this plugin's own rows, for the message the operator sees.
 *  2. A partial unique index on `(project_id) where status in
 *     ('queued','running')` — the database refuses the second of two operators
 *     clicking Launch at once, where the read above would let both through.
 *  3. The queue's `dedupeKey`. If it hands back an *existing* job — one this
 *     run did not create — the run row just written is deleted again and the
 *     launch refused, rather than left as a phantom pointing at a job that
 *     will never execute it. That used to be how a project locked itself after
 *     a worker died: the dead job matched the key forever. Core's lease reaper
 *     now fails such a job, so the key is released within one lease.
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

  let run;
  try {
    run = await queries.createMigrationRun(database, {
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
  } catch (err) {
    if (isOneActiveRunViolation(err)) {
      return {
        ok: false,
        error:
          "Another operator started a run for this migration a moment ago. Open it to follow along.",
      };
    }
    throw err;
  }

  let job;
  try {
    job = await ctx.jobs.enqueue(
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
  } catch (err) {
    await queries.deleteMigrationRun(database, run.id).catch(() => {});
    throw err;
  }

  const owner = await queries.getMigrationRunByJobId(database, job.id);
  if (owner && owner.id !== run.id) {
    // The queue collapsed our enqueue into a job another run already owns.
    await queries.deleteMigrationRun(database, run.id);
    return {
      ok: false,
      error:
        "The queue still holds a job for this migration. If no run shows as in flight, it will be released within a few minutes — try again then.",
    };
  }
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
    queries.finishMigrationRun(database, runId, { status: "failed", error });

  // Conditional on the row still being `queued`. A run cancelled while it
  // waited behind another job, or settled by the reconciler, shows the operator
  // "aborted" — and must then never start a live load.
  if (!(await queries.claimQueuedMigrationRun(database, runId))) {
    throw new Error(
      `migration run ${runId} is ${runRow.status}, not queued — refusing to execute it`,
    );
  }

  try {
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
    const artifactRoot = host.runArtifactRoot(project.teamId, project.id);
    const runDir = path.join(
      artifactRoot,
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
      // Relative to the project's artifact root, never the server's absolute
      // path: the summary is rendered in the browser.
      reportPath: summary.reportPath
        ? path.relative(artifactRoot, summary.reportPath)
        : summary.reportPath,
    };

    // Conditional on the row still being `running`: if the operator cancelled
    // meanwhile, their `aborted` stands and only the engine's run id and
    // summary are worth keeping for the record.
    const landed = await queries.finishMigrationRun(database, runId, {
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
    });
    if (!landed) {
      await queries.updateMigrationRun(database, runId, {
        engineRunId: summary.runId,
        summary: runSummary,
      });
    }
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
 * Follow the queue's verdict onto this plugin's run rows.
 *
 * The queue is the owner of a run's lifecycle and this table follows it, so
 * the reconciler asks the queue rather than the clock: for every run row still
 * `queued` or `running`, what does `plugin_jobs` say about its job?
 *
 *  - `pending` / `running`: the job is alive (its lease is being refreshed).
 *    Leave the row alone, however long it has been — an init takes hours and a
 *    run queued behind one waits for as long as that takes.
 *  - `done` / `failed` / missing: the job settled but the row did not (the
 *    process died between the engine finishing and the write, or core's lease
 *    reaper failed the job after its worker died). Abort the row and release
 *    the one-run-per-project guard.
 *
 * A `queued` row with no job at all (a crash inside `enqueueMigrationRun`) is
 * the one case judged by wall clock — `failOrphanedMigrationRuns`.
 *
 * Called from the scheduler's tick, independently of the worker's own
 * re-entry guard, so it keeps running while a long job is in flight.
 */
export async function reconcileStaleRuns(): Promise<number> {
  const database = db();
  const { runtime } = veevaMigrationWiring();
  // Dynamic: `./index` imports this module for the handler, so a static import
  // back would be a cycle whose evaluation order depends on which entry point
  // loads first.
  const { veevaMigrationPlugin } = await import("./index");
  let settled = await queries.failOrphanedMigrationRuns(database);

  for (const run of await queries.listInFlightMigrationRuns(database)) {
    if (!run.jobId) continue;
    const project = await queries.getMigrationProject(database, run.projectId);
    if (!project) continue;
    const ctx = await runtime.contextFor(veevaMigrationPlugin, {
      repositoryId: project.repositoryId,
      teamId: project.teamId,
    });
    const status = await ctx.jobs.status(run.jobId);
    if (status === "pending" || status === "running") continue;

    const landed = await queries.finishMigrationRun(database, run.id, {
      status: "aborted",
      error:
        status === "failed"
          ? "The worker executing this run stopped before it finished — most likely a server restart. Re-run the step — loads are idempotent and the watermark did not advance."
          : "The run's queue job finished without recording a result. Re-run the step — loads are idempotent and the watermark did not advance.",
    });
    if (landed) settled += 1;
  }
  return settled;
}
