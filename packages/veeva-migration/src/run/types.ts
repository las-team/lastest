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

export interface RunOptions {
  mode: RunMode;
  config: MigrationConfig;
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
