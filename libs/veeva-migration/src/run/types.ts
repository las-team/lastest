/**
 * Run engine contract (§2.7, §4.3, §6.1). Implemented in `src/run/*` and
 * driven by `src/cli.ts`.
 */
import type { MigrationConfig } from "../config/schema";
import type {
  CountryCode,
  MaterialisedMapping,
  ObjectKey,
  RunMode,
  Unit,
} from "../types";
import type { ObjectModule } from "../objects/types";

/** One §6.1 step: units that may run in parallel, then pass-2 patches. */
export interface RunStep {
  index: number;
  /** Object keys of the step (in registry order). */
  keys: ObjectKey[];
  /** Units = keys × countries of the wave (GLOBAL objects appear once). */
  units: Unit[];
  /** Self-reference patches applied after the step (`objectKey.target`). */
  pass2: Array<{
    objectKey: ObjectKey;
    target: string;
    source: string;
    refKey: ObjectKey;
  }>;
}

export interface RunPlan {
  runId: string;
  mode: RunMode;
  wave?: string;
  countries: CountryCode[];
  /** Ordered steps derived from `dependsOn` (selfRefs excluded, §6.1 cycles broken by pass 2). */
  steps: RunStep[];
  /** Materialised mapping per `unitId(unit)`. */
  mappings: Map<string, MaterialisedMapping>;
  modules: Map<ObjectKey, ObjectModule>;
  /** Explicit `cutoffDate` per country (§1.1 #2), computed at run start. */
  cutoffDates: Map<CountryCode, string>;
  /** Blob pass and post-load steps (§6.1 steps 23–24) — flags only; the engine schedules them. */
  postLoad: {
    blobs: boolean;
    recalculateRollups: "auto" | "required" | "off";
    updateCorporateCurrency: boolean;
  };
}

/**
 * Who is running this, on whose behalf, and where the artifacts go.
 *
 * Required, and required for a reason: before this existed the engine invented
 * all three. It stamped `process.env.USER` on every audit entry (so a regulated
 * cutover's audit log named the server's OS user, never the person who pressed
 * the button), it fell back to `./runs` relative to the process CWD, and it had
 * no notion of whose data it was touching at all — which is how one Postgres
 * schema came to hold every tenant's id map keyed by nothing but a Vault DNS
 * string the tenant typed in themselves.
 *
 * Making it non-optional is the whole point. There are two front doors to this
 * engine — the app's plugin job and `src/cli.ts` — and the type system now
 * refuses to let either of them start a run without saying, explicitly, who is
 * acting and where the bytes land.
 */
export interface RunContext {
  /**
   * The tenant/ownership key every state-store write is scoped by.
   *
   * The app passes the migration project id. The store implementation decides
   * what to do with it; `PluginDataStateStore` puts it in the leading column of
   * every primary key, so two projects in one team (the documented "UAT then
   * PROD" shape) cannot share a watermark row.
   */
  readonly tenantKey: string;
  /**
   * Stamped on every audit entry. The app passes the acting user's id; the CLI
   * passes the OS user, explicitly, at the call site where that is honest.
   */
  readonly actor: string;
  /**
   * Absolute directory for this run's artifacts (extract pages, payloads,
   * reports, the audit mirror). Caller-owned and never user input: the app
   * derives it from its storage root plus ids, so nothing a form can hold ever
   * reaches `fs.mkdir`.
   */
  readonly runDir: string;
  /**
   * Cooperative cancellation, checked at unit and batch boundaries.
   *
   * Without it "abandon this run" could only release the one-run-per-project
   * guard and hope; the engine kept going against a live Vault.
   */
  readonly signal?: AbortSignal;
}

export interface RunOptions {
  mode: RunMode;
  config: MigrationConfig;
  /** Who is acting, for whom, and where artifacts go. See `RunContext`. */
  context: RunContext;
  configPath?: string;
  wave?: string;
  /** `--country DE` narrows the wave. */
  countries?: CountryCode[];
  /** `--objects account,address`. */
  objects?: ObjectKey[];
  dryRun?: boolean;
  limit?: number;
  allowMdl?: boolean;
  allowPicklistCreate?: boolean;
  allowPicklistReactivate?: boolean;
  probeWrites?: boolean;
  /** `preflight --reprobe`: ignore cached `probe_results` (§5.3). */
  reprobe?: boolean;
  /** `final-delta --freeze-at`. */
  freezeAt?: string;
  acceptGateExceptions?: string;
  acceptMappingChange?: boolean;
  /** `retry-failed --run` / `blobs --run` / `report --run`. */
  runId?: string;
  errorType?: string;
  /** `verify` flags. */
  verify?: { fk?: boolean; keys?: boolean; samples?: boolean; sample?: number };
  allowCrossRegion?: boolean;
  unfreeze?: boolean;
  /** Operator justification recorded in the audit log for manual overrides (§8.5). */
  justification?: string;
  /** Clock override for tests. */
  now?: () => Date;
}

/** Exit codes (§8.10). */
export const EXIT_CODES = {
  success: 0,
  blockingFindings: 2,
  unitFailures: 3,
  gateFailed: 4,
  configError: 5,
  /**
   * The caller aborted via `RunContext.signal`. Distinct from `unitFailures`:
   * nothing is wrong with the data or the config, the operator stopped it, and
   * a resumed run must not treat the stopped units as failures to retry.
   */
  aborted: 6,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export interface RunSummary {
  runId: string;
  mode: RunMode;
  exitCode: ExitCode;
  units: Array<{
    unit: Unit;
    status: "succeeded" | "failed" | "blocked" | "skipped";
    reason?: string;
  }>;
  reportPath?: string;
}

export interface RunEngine {
  /** Build the plan (config → units → materialised mappings → ordered steps). No I/O beyond config. */
  plan(opts: RunOptions): Promise<RunPlan>;
  /** Execute a mode end-to-end (§2.7 table; §4.3 order for deltas). */
  execute(opts: RunOptions): Promise<RunSummary>;
}
