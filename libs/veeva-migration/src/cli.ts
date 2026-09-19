/**
 * CLI entry (§8.10):
 *
 *   veeva-migration preflight   --config cfg.yaml --wave eu1 [--country DE] [--probe-writes]
 *   veeva-migration init        --config cfg.yaml --wave eu1 [--country DE] [--objects a,b] [--dry-run] [--limit N] [--allow-mdl] [--allow-picklist-create]
 *   veeva-migration delta       --config cfg.yaml --wave eu1 [--country DE] [--dry-run]
 *   veeva-migration final-delta --config cfg.yaml --wave eu1 --freeze-at <ISO> [--accept-gate-exceptions file]
 *   veeva-migration verify      --config cfg.yaml --wave eu1 [--fk] [--keys] [--samples] [--sample N]
 *   veeva-migration retry-failed --config cfg.yaml --run <id> [--error-type T]
 *   veeva-migration blobs       --config cfg.yaml --run <id> [--objects a,b]
 *   veeva-migration report      --run <id> [--config cfg.yaml]
 *
 * Exit codes: 0 ok · 2 blocking findings · 3 unit failures · 4 gate failed ·
 * 5 config error · 6 cancelled.
 * `buildProgram()` stays exported for tests; `hooks.run` replaces the engine.
 *
 * **This is a development and spec-conformance harness, not an operator tool.**
 * There is no `bin` entry any more, so it never lands in
 * `node_modules/.bin` of the application image: run it with
 * `pnpm --filter @lastest/veeva-migration cli`. It was demoted because it was a
 * second front door into the same engine with none of the app's guards — no
 * repo capability check, no connector credential resolution, and no knowledge
 * of the one-run-per-project lock the console holds in the database, so a CLI
 * run and a console run could interleave upserts and both advance watermarks.
 * Its state store is now the file driver (`--state-dir`), so it cannot reach
 * the application database at all.
 *
 * The `RunContext` it builds is explicit about all of this: the actor is this
 * machine's OS user because that is who is really running it, and it says so
 * rather than letting the engine guess.
 */
import os from "node:os";
import path from "node:path";
import { Command, CommanderError } from "commander";
import { ConfigError, loadConfig } from "./config/load";
import type { MigrationConfig } from "./config/schema";
import { getLogger } from "./logger";
import { DefaultRunEngine } from "./run/engine";
import { PlanError, parseObjectKeys } from "./run/plan";
import {
  EXIT_CODES,
  type ExitCode,
  type RunContext,
  type RunOptions,
  type RunSummary,
} from "./run/types";
import type { RunMode } from "./types";
import { createEngineDeps } from "./run/wiring";
import { isObjectKey } from "./types";

export interface CliHooks {
  /** Replace the engine (tests): receives the parsed options, returns the exit code. */
  run?: (opts: RunOptions) => Promise<number>;
  /** Replace config loading (tests). */
  loadConfig?: (path: string) => MigrationConfig;
  /** Where to write errors (default stderr). */
  stderr?: (text: string) => void;
  /** Called with the exit code instead of `process.exit` (tests). */
  exit?: (code: number) => void;
  /** Make commander throw `CommanderError` instead of exiting (set before subcommands are created). */
  exitOverride?: boolean;
}

interface CommonFlags {
  config?: string;
  wave?: string;
  country?: string[];
  allowCrossRegion?: boolean;
  justification?: string;
  runDir?: string;
  stateDir?: string;
}

/** Default artifact root. Relative to the CWD, which for a dev harness is right. */
export const CLI_DEFAULT_RUN_DIR = "./runs";

/**
 * The CLI's `RunContext`.
 *
 * `tenantKey` is `"cli"`: a local harness has no tenant, and naming it is
 * better than inventing one that looks like a project id. `actor` is the OS
 * user — the same value the engine used to read from `process.env.USER` behind
 * the caller's back, now stated at the call site where it is true.
 */
export function cliRunContext(flags: CommonFlags): RunContext {
  return {
    tenantKey: "cli",
    actor: os.userInfo().username || "unknown",
    runDir: path.resolve(flags.runDir ?? CLI_DEFAULT_RUN_DIR),
  };
}

/** Translate commander flags into `RunOptions` (validated; throws `PlanError`/`ConfigError`). */
export function toRunOptions(
  mode: RunMode,
  flags: Record<string, unknown>,
  config: MigrationConfig,
): RunOptions {
  const f = flags as CommonFlags & Record<string, unknown>;
  const countries = f.country
    ?.flatMap((c) => c.split(","))
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  for (const c of countries ?? [])
    if (!/^[A-Z]{2}$/.test(c))
      throw new PlanError(
        `CONFIG_COUNTRY_INVALID: "${c}" is not an ISO-2 code`,
      );
  const objects = parseObjectKeys(
    typeof f.objects === "string" ? f.objects : undefined,
  );
  if (objects)
    for (const k of objects)
      if (!isObjectKey(k))
        throw new PlanError(`CONFIG_OBJECT_KEY_UNKNOWN: ${k}`);
  const limit = f.limit === undefined ? undefined : Number(f.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
    throw new PlanError(`--limit must be a positive integer`);
  const sample = f.sample === undefined ? undefined : Number(f.sample);
  if (sample !== undefined && (!Number.isInteger(sample) || sample < 0))
    throw new PlanError(`--sample must be a non-negative integer`);
  if (
    mode === "final-delta" &&
    typeof f.freezeAt === "string" &&
    Number.isNaN(new Date(f.freezeAt).getTime())
  )
    throw new PlanError(
      `--freeze-at must be an ISO-8601 datetime (got "${f.freezeAt}")`,
    );
  if (
    f.dryRun &&
    ![
      "init",
      "delta",
      "final-delta",
      "verify",
      "retry-failed",
      "blobs",
    ].includes(mode)
  )
    throw new PlanError(`--dry-run is not applicable to ${mode}`);
  return {
    mode,
    config,
    context: cliRunContext(f),
    configPath: f.config,
    wave: f.wave,
    countries: countries?.length ? countries : undefined,
    objects,
    dryRun: Boolean(f.dryRun),
    limit,
    allowMdl: Boolean(f.allowMdl),
    allowPicklistCreate: Boolean(f.allowPicklistCreate),
    allowPicklistReactivate: Boolean(f.allowPicklistReactivate),
    probeWrites: Boolean(f.probeWrites),
    reprobe: Boolean(f.reprobe),
    freezeAt:
      typeof f.freezeAt === "string"
        ? new Date(f.freezeAt).toISOString()
        : undefined,
    acceptGateExceptions:
      typeof f.acceptGateExceptions === "string"
        ? f.acceptGateExceptions
        : undefined,
    acceptMappingChange: Boolean(f.acceptMappingChange),
    runId: typeof f.run === "string" ? f.run : undefined,
    errorType: typeof f.errorType === "string" ? f.errorType : undefined,
    verify:
      mode === "verify"
        ? {
            fk: Boolean(f.fk),
            keys: Boolean(f.keys),
            samples: Boolean(f.samples),
            sample,
          }
        : undefined,
    allowCrossRegion: Boolean(f.allowCrossRegion),
    unfreeze: Boolean(f.unfreeze),
    justification:
      typeof f.justification === "string" ? f.justification : undefined,
  };
}

/** Default engine runner: wire clients from the config, execute, tear down. */
export async function runMode(
  opts: RunOptions,
  stateDir?: string,
): Promise<ExitCode> {
  const deps = await createEngineDeps(opts.config, opts.context, {
    countries: opts.countries,
    offline: opts.mode === "report",
    store: { driver: "file", ...(stateDir ? { dir: stateDir } : {}) },
  });
  try {
    const engine = new DefaultRunEngine(deps);
    const summary: RunSummary = await engine.execute(opts);
    return summary.exitCode;
  } finally {
    await deps.close();
  }
}

export function buildProgram(hooks: CliHooks = {}): Command {
  const log = getLogger("Cli");
  const stderr =
    hooks.stderr ?? ((t: string) => process.stderr.write(t + "\n"));
  const exit = hooks.exit ?? ((code: number) => process.exit(code));
  const program = new Command();
  if (hooks.exitOverride) program.exitOverride();
  if (hooks.stderr)
    program.configureOutput({ writeErr: (s) => hooks.stderr!(s.trimEnd()) });
  program
    .name("veeva-migration")
    .description("Veeva CRM (Salesforce) → Vault CRM migration tool")
    .version("0.1.0");

  const withCommon = (c: Command) =>
    c
      .requiredOption("--config <path>", "YAML configuration (§7.3)")
      .option("--wave <name>", "wave name from config.waves")
      .option("--country <iso2...>", "restrict to countries (ISO-2)")
      .option(
        "--allow-cross-region",
        "override the data-residency guard (§7.5)",
      )
      .option(
        "--justification <text>",
        "operator justification for manual overrides (audit log)",
      )
      .option(
        "--run-dir <path>",
        `artifact directory: extract pages, payloads, reports, audit mirror (default ${CLI_DEFAULT_RUN_DIR})`,
      )
      .option(
        "--state-dir <path>",
        "file state store directory (default <run-dir>/state)",
      );

  const action = (mode: RunMode) => async (flags: Record<string, unknown>) => {
    let code: number;
    try {
      const configPath =
        typeof flags.config === "string" ? flags.config : undefined;
      let config: MigrationConfig;
      if (configPath) config = (hooks.loadConfig ?? loadConfig)(configPath);
      else if (mode === "report") config = minimalConfig();
      else throw new ConfigError("CONFIG_FILE_MISSING: --config is required");
      const opts = toRunOptions(mode, flags, config);
      const stateDir =
        typeof flags.stateDir === "string" ? flags.stateDir : undefined;
      code = await (hooks.run ?? ((o) => runMode(o, stateDir)))(opts);
    } catch (e) {
      if (e instanceof ConfigError || e instanceof PlanError) {
        stderr(`veeva-migration ${mode}: ${e.message}`);
        code = EXIT_CODES.configError;
      } else {
        log.error({ err: e }, `${mode} failed`);
        stderr(`veeva-migration ${mode}: ${(e as Error).message}`);
        code = EXIT_CODES.unitFailures;
      }
    }
    exit(code);
  };

  withCommon(
    program
      .command("preflight")
      .description("§5 configuration checks (read-only)"),
  )
    .option("--objects <keys>", "comma-separated object keys")
    .option(
      "--probe-writes",
      "run the §5.3 write probes against preflight.probeObject",
    )
    .option("--reprobe", "ignore cached probe results")
    .option(
      "--allow-mdl",
      "allow legacy-id field creation via MDL (§3.2 step 6)",
    )
    .action(action("preflight"));

  withCommon(
    program
      .command("init")
      .description("initial load (idempotent upsert by legacy id)"),
  )
    .option("--objects <keys>", "comma-separated object keys")
    .option("--dry-run", "no writes; payload files + simulated counts (§8.9)")
    .option("--limit <n>", "rows per unit in dry-run")
    .option(
      "--allow-mdl",
      "allow legacy-id field creation via MDL (§3.2 step 6)",
    )
    .option(
      "--allow-picklist-create",
      "create missing picklist values (§2.5.6)",
    )
    .option(
      "--allow-picklist-reactivate",
      "re-activate inactive target picklist values (§2.5.6)",
    )
    .option("--accept-mapping-change", "accept MAP_HASH_CHANGED")
    .option("--unfreeze", "re-run for a frozen country")
    .action(action("init"));

  withCommon(
    program
      .command("delta")
      .description("incremental run by SystemModstamp watermark (§4)"),
  )
    .option("--objects <keys>", "comma-separated object keys")
    .option("--dry-run", "no writes; payload files + simulated counts (§8.9)")
    .option("--limit <n>", "rows per unit in dry-run")
    .option("--accept-mapping-change", "accept MAP_HASH_CHANGED")
    .option("--unfreeze", "re-run for a frozen country")
    .action(action("delta"));

  withCommon(
    program
      .command("final-delta")
      .description("cutover delta with reconciliation gate (§4.5)"),
  )
    .requiredOption("--freeze-at <iso>", "frozen SFDC timestamp (wm_hi)")
    .option("--objects <keys>", "comma-separated object keys")
    .option(
      "--accept-gate-exceptions <file>",
      "documented exclusions file (§8.8)",
    )
    .option("--accept-mapping-change", "accept MAP_HASH_CHANGED")
    .option("--dry-run", "no writes; payload files + simulated counts (§8.9)")
    .option("--unfreeze", "re-run for a frozen country")
    .action(action("final-delta"));

  withCommon(
    program
      .command("verify")
      .description("read-only counts / hashes / orphan FK (§2.8)"),
  )
    .option("--objects <keys>", "comma-separated object keys")
    .option("--fk", "FK-consistency pass (§4.2)")
    .option("--keys", "key-set reconciliation (§2.1.6)")
    .option(
      "--samples",
      "sample read-back with reconcile.sampleSize rows (§8.8)",
    )
    .option("--sample <n>", "row sample size")
    .action(action("verify"));

  withCommon(
    program
      .command("retry-failed")
      .description("re-transform and re-upsert failed rows of a run"),
  )
    .requiredOption("--run <runId>", "source run id")
    .option("--error-type <type>", "only rows failed with this error type")
    .option("--objects <keys>", "comma-separated object keys")
    .action(action("retry-failed"));

  withCommon(
    program.command("blobs").description("second-pass blob load by id (§8.6)"),
  )
    .requiredOption("--run <runId>", "source run id")
    .option("--objects <keys>", "comma-separated object keys")
    .action(action("blobs"));

  program
    .command("report")
    .description("print the run report (§8.5)")
    .requiredOption("--run <runId>", "run id")
    .option(
      "--config <path>",
      "YAML configuration (for the staging store location)",
    )
    .action(action("report"));

  return program;
}

/** Report without a config: file store in ./runs/state (matches `createStateStore` defaults). */
function minimalConfig(): MigrationConfig {
  return {
    version: 1,
    source: {
      loginUrl: "https://login.salesforce.com",
      auth: { kind: "clientCredentials", clientId: "-", clientSecret: "-" },
      apiVersion: "67.0",
      timezone: "UTC",
    },
    target: {
      vaultDns: "unknown.veevavault.com",
      apiVersion: "v26.2",
      auth: { kind: "accessToken", token: "-" },
      migrationMode: true,
      unchangedFieldBehavior: "AlwaysIgnore",
    },
    legacyId: {
      preferred: ["legacy_crm_id__v", "external_id__v", "legacy_crm_id__c"],
      format: "{id18}",
      externalIdFormat: "SF:{orgId15}:{id18}",
      allowMdl: false,
    },
    delta: { overlapMinutes: 10, safetyLagMinutes: 5 },
    performance: {
      sfdcBulkConcurrency: 4,
      sfdcBulkMaxRecords: 100_000,
      sfdcRestConcurrency: 2,
      vaultConcurrency: 4,
      vaultBatch: 500,
      burstFloor: 200,
      sfdcApiFloorPct: 20,
      batchWallTimeMs: 60000,
      sortChunkRows: 500000,
      blobBatchBytes: 64 * 1024 * 1024,
    },
    extract: { closureStrategy: "soqlIn", closureMaxRounds: 20 },
    load: { strategy: "vobjects" },
    pendingFk: { maxRounds: 3 },
    preflight: { probeWrites: false, naturalKeyReview: true, reprobe: false },
    locales: { language: {}, locale: {} },
    regions: {},
    countries: {},
    waves: [],
  };
}

/** Parse argv and resolve with the exit code (never calls `process.exit`). */
export async function main(
  argv: readonly string[],
  hooks: CliHooks = {},
): Promise<number> {
  let code = 0;
  const program = buildProgram({
    ...hooks,
    exit: (c) => (code = c),
    exitOverride: true,
  });
  try {
    await program.parseAsync(argv as string[], { from: "user" });
  } catch (e) {
    if (e instanceof CommanderError)
      return e.exitCode === 0 ? 0 : EXIT_CODES.configError;
    throw e;
  }
  return code;
}

const isMain =
  process.argv[1] !== undefined && /cli\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) {
  if (process.argv.length <= 2) {
    buildProgram().outputHelp();
  } else {
    main(process.argv.slice(2)).then(
      (code) => process.exit(code),
      (e) => {
        process.stderr.write(`veeva-migration: ${(e as Error).message}\n`);
        process.exit(EXIT_CODES.configError);
      },
    );
  }
}
