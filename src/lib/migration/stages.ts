/**
 * The migration flow, as a pure function.
 *
 * Every gate in the console — which stage is reachable, which button is
 * enabled, what the rail shows — is decided here and nowhere else. The screens
 * render the result; they never re-derive it. That is what keeps "you cannot
 * run a delta before an init" from being restated (and drifting) in a page, a
 * server action and a button's `disabled` prop.
 *
 * No imports from the DB client, the engine or React: the whole model is
 * data-in / data-out so `stages.test.ts` can drive every ordering case without
 * a database.
 *
 * The nine stages mirror `packages/veeva-migration/demo/` — the screencast IS
 * the specification of this flow.
 */

import type {
  MigrationRunMode,
  MigrationRunStatus,
  MigrationStage,
  MigrationWaveStatus,
} from "@/lib/db/schema";

export type { MigrationStage };

/** How a stage renders in the rail and what its primary button does. */
export interface StageDefinition {
  key: MigrationStage;
  label: string;
  /** One line under the title — what this step is FOR, not what it does. */
  blurb: string;
  /** The engine mode the primary action runs; null for stages with no run. */
  mode: MigrationRunMode | null;
  /** Shown in the console's command preview, and copyable for the CLI. */
  command: string | null;
  /** Verb on the primary button. */
  action: string;
  /** True when the stage is expected to be run repeatedly (delta, verify). */
  repeatable: boolean;
}

export const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  {
    key: "connect",
    label: "Connect",
    blurb:
      "Point the migration at a Salesforce org and a Vault — both from Environments, so hosts and logins are never retyped here.",
    mode: null,
    command: null,
    action: "Choose environments",
    repeatable: false,
  },
  {
    key: "plan",
    label: "Plan",
    blurb:
      "Units are one object x country, ordered so every foreign key loads after the record it points at. Each unit's field mapping is folded from defaults, region and country, then hashed.",
    mode: null,
    command: "veeva-migration plan --config migration.yaml --wave {wave}",
    action: "Build plan",
    repeatable: true,
  },
  {
    key: "preflight",
    label: "Preflight",
    blurb:
      "Check the plan against live metadata on both sides before a single row moves: do the target fields exist, are types and lengths compatible, are picklist values and object types real.",
    mode: "preflight",
    command: "veeva-migration preflight --config migration.yaml --wave {wave}",
    action: "Run preflight",
    repeatable: true,
  },
  {
    key: "dryrun",
    label: "Dry run",
    blurb:
      "Extract and transform for real, simulate the load. Nothing is written to Vault and no watermark moves.",
    mode: "init",
    command:
      "veeva-migration init --config migration.yaml --wave {wave} --dry-run",
    action: "Run dry run",
    repeatable: true,
  },
  {
    key: "initial",
    label: "Initial load",
    blurb:
      "Extract by SOQL scope, transform through the registry, bulk-upsert into Vault keyed on the legacy Salesforce id — so re-running is idempotent rather than duplicating.",
    mode: "init",
    command: "veeva-migration init --config migration.yaml --wave {wave}",
    action: "Run initial load",
    repeatable: true,
  },
  {
    key: "delta",
    label: "Delta sync",
    blurb:
      "The source keeps changing while the project runs. A SystemModstamp window with overlap and a safety lag, plus the deleted-row feed; unchanged rows are never re-sent.",
    mode: "delta",
    command: "veeva-migration delta --config migration.yaml --wave {wave}",
    action: "Run delta",
    repeatable: true,
  },
  {
    key: "cutover",
    label: "Cutover",
    blurb:
      "Salesforce is frozen and the freeze timestamp becomes the window's upper bound for every unit of the wave. The reconciliation gate runs at the end, at tolerance zero.",
    mode: "final-delta",
    command:
      "veeva-migration final-delta --config migration.yaml --wave {wave} --freeze-at {freezeAt}",
    action: "Run final delta",
    repeatable: false,
  },
  {
    key: "verify",
    label: "Verify",
    blurb:
      "Re-count both sides, check foreign keys for orphans, and read a stratified sample back out of Vault field by field.",
    mode: "verify",
    command:
      "veeva-migration verify --config migration.yaml --wave {wave} --fk --samples",
    action: "Run verify",
    repeatable: true,
  },
  {
    key: "signoff",
    label: "Sign-off",
    blurb:
      "Every run writes a markdown and JSON report — config and mapping hashes, per-unit timings, findings, reconciliation, and the ids of anything that failed.",
    // `mode: null` although the command below is a real one. Signing off is a
    // DECISION, not an engine run: it marks the wave's countries frozen and is
    // the one irreversible thing in the console. Giving it the generic run
    // button would put a second, differently-worded "Sign off" beside the real
    // one — and that button would have run `report`, which is not what it says.
    mode: null,
    command: "veeva-migration report --run {runId}",
    action: "Sign off wave",
    repeatable: false,
  },
];

export const STAGE_BY_KEY: Readonly<Record<MigrationStage, StageDefinition>> =
  Object.fromEntries(STAGE_DEFINITIONS.map((s) => [s.key, s])) as Record<
    MigrationStage,
    StageDefinition
  >;

export function stageIndex(stage: MigrationStage): number {
  return STAGE_DEFINITIONS.findIndex((s) => s.key === stage);
}

/**
 * Per-stage state in the rail.
 *
 *  - `locked`    a prerequisite has not been met; the button is disabled and
 *                `blockedReason` says which one.
 *  - `ready`     runnable, never yet run (or the wave moved on and it needs
 *                re-running).
 *  - `running`   a run of this stage is in flight.
 *  - `done`      last run of this stage succeeded.
 *  - `attention` last run finished but did not pass — failed units, blocking
 *                findings, or a failed gate. Runnable again.
 */
export type StageStatus = "locked" | "ready" | "running" | "done" | "attention";

export interface StageState {
  key: MigrationStage;
  status: StageStatus;
  /** Why it is locked — rendered verbatim as the disabled button's tooltip. */
  blockedReason?: string;
  /** Id of the most recent run of this stage, for the "last run" link. */
  lastRunId?: string;
  lastRunAt?: Date | null;
}

/** The subset of a run the flow model needs. Any row shape satisfying it works. */
export interface FlowRun {
  id: string;
  mode: MigrationRunMode;
  status: MigrationRunStatus;
  dryRun: boolean;
  waveId: string | null;
  startedAt: Date | null;
  /** Blocking-finding / gate outcome, when the run recorded one. */
  blockingFindings?: number;
  gate?: "pass" | "fail" | "pending";
}

export interface FlowWave {
  id: string;
  status: MigrationWaveStatus;
  countries: string[];
  freezeAt: Date | null;
}

export interface FlowInput {
  hasSource: boolean;
  hasTarget: boolean;
  /** The wave the console is focused on; null when none exists yet. */
  wave: FlowWave | null;
  /** Runs for that wave (and project-wide runs with `waveId = null`), newest first. */
  runs: FlowRun[];
  /** True once a plan has been built for the current wave and mapping. */
  planned: boolean;
}

export interface FlowState {
  stages: StageState[];
  /** The stage the console opens on: the first that is not `done`. */
  activeStage: MigrationStage;
  /** Fraction of stages complete, for the rail's progress line. */
  completed: number;
}

/** Whether a run counts as "this stage's run" — `init` splits on `dryRun`. */
function matchesStage(run: FlowRun, stage: MigrationStage): boolean {
  const def = STAGE_BY_KEY[stage];
  if (!def.mode) return false;
  if (run.mode !== def.mode) return false;
  if (def.mode === "init") return stage === "dryrun" ? run.dryRun : !run.dryRun;
  return true;
}

function latestFor(
  runs: FlowRun[],
  stage: MigrationStage,
): FlowRun | undefined {
  return runs.find((r) => matchesStage(r, stage));
}

/**
 * Did this stage complete successfully?
 *
 * Deliberately stricter than `status === "succeeded"` for two stages:
 * preflight with blocking findings is NOT done (exit 2), and a cutover whose
 * reconciliation gate failed is NOT done (exit 4). Both would otherwise show a
 * green tick on a wave nobody can sign off.
 */
function isPassed(run: FlowRun | undefined, stage: MigrationStage): boolean {
  if (!run || run.status !== "succeeded") return false;
  if (stage === "preflight") return (run.blockingFindings ?? 0) === 0;
  if (stage === "cutover") return run.gate !== "fail";
  return true;
}

/**
 * Resolve the whole rail.
 *
 * The ordering rule is a single chain — each stage unlocks when the one before
 * it has passed — with three deliberate exceptions:
 *
 *  - `dryrun` is optional. Skipping the rehearsal is a legitimate choice on a
 *    re-run, so `initial` unlocks off `preflight`, not off `dryrun`.
 *  - `delta` unlocks off `initial` but never locks again: deltas keep running
 *    for countries not yet in a wave right up to cutover (§4.5 #4).
 *  - `verify` is read-only, so it unlocks as soon as anything has been loaded
 *    rather than waiting for cutover — that is how a rehearsal is checked.
 */
export function deriveFlowState(input: FlowInput): FlowState {
  const { hasSource, hasTarget, wave, runs, planned } = input;
  const connected = hasSource && hasTarget;

  const state = new Map<MigrationStage, StageState>();
  const set = (
    key: MigrationStage,
    status: StageStatus,
    blockedReason?: string,
  ) => {
    const run = latestFor(runs, key);
    state.set(key, {
      key,
      status,
      blockedReason,
      lastRunId: run?.id,
      lastRunAt: run?.startedAt ?? null,
    });
  };

  const running = (key: MigrationStage) => {
    const run = latestFor(runs, key);
    return run?.status === "running" || run?.status === "queued";
  };

  const resolve = (
    key: MigrationStage,
    unlocked: boolean,
    reason: string,
    passed: boolean,
  ) => {
    if (running(key)) return set(key, "running");
    if (!unlocked) return set(key, "locked", reason);
    if (passed) return set(key, "done");
    const run = latestFor(runs, key);
    return set(key, run ? "attention" : "ready");
  };

  // 1. Connect — the only stage with no run behind it.
  set("connect", connected ? "done" : "ready");

  // 2. Plan — needs both ends; "done" is a plan built for the current wave.
  set(
    "plan",
    !connected ? "locked" : !wave ? "locked" : planned ? "done" : "ready",
    !connected
      ? "Connect a Salesforce org and a Vault first"
      : !wave
        ? "Add a wave with at least one country"
        : undefined,
  );

  const planDone = state.get("plan")!.status === "done";

  resolve(
    "preflight",
    planDone,
    "Build the plan first",
    isPassed(latestFor(runs, "preflight"), "preflight"),
  );
  const preflightPassed = state.get("preflight")!.status === "done";

  resolve(
    "dryrun",
    preflightPassed,
    "Preflight must pass with no blocking findings",
    isPassed(latestFor(runs, "dryrun"), "dryrun"),
  );

  // The dry run is a rehearsal, not a gate — `initial` unlocks off preflight.
  resolve(
    "initial",
    preflightPassed,
    "Preflight must pass with no blocking findings",
    isPassed(latestFor(runs, "initial"), "initial"),
  );
  const initialDone = state.get("initial")!.status === "done";

  resolve(
    "delta",
    initialDone,
    "Run the initial load first",
    (() => {
      const run = latestFor(runs, "delta");
      // Deltas are recurring: one success makes the stage green, and it stays
      // green while later deltas run. A FAILED latest delta pulls it back to
      // `attention` — that is the case an operator must see.
      return isPassed(run, "delta");
    })(),
  );

  const frozen = Boolean(wave?.freezeAt);
  resolve(
    "cutover",
    initialDone && frozen,
    !initialDone
      ? "Run the initial load first"
      : "Set the Salesforce freeze timestamp to start cutover",
    isPassed(latestFor(runs, "cutover"), "cutover"),
  );
  const cutoverDone = state.get("cutover")!.status === "done";

  // Verify is read-only — available as soon as there is data to verify.
  resolve(
    "verify",
    initialDone,
    "Nothing has been loaded yet",
    isPassed(latestFor(runs, "verify"), "verify"),
  );
  const verifyDone = state.get("verify")!.status === "done";

  const signedOff = wave?.status === "signed_off";
  set(
    "signoff",
    signedOff ? "done" : cutoverDone && verifyDone ? "ready" : "locked",
    !cutoverDone
      ? "The final delta must pass the reconciliation gate"
      : !verifyDone
        ? "Run verify before signing off"
        : undefined,
  );

  const stages = STAGE_DEFINITIONS.map((d) => state.get(d.key)!);
  const firstOpen = stages.find((s) => s.status !== "done");
  return {
    stages,
    activeStage: firstOpen?.key ?? "signoff",
    completed: stages.filter((s) => s.status === "done").length,
  };
}

/**
 * Is this stage reachable right now — regardless of whether it runs anything?
 *
 * Separate from `canLaunch` because two stages have no engine mode. Connect is
 * a form and Sign-off is a decision; both still have prerequisites, and both
 * still have to refuse a stale tab. `canLaunch` cannot serve them: it requires
 * a mode by design, so that a caller cannot accidentally "launch" a stage that
 * does not run.
 */
export function canAdvance(
  stage: MigrationStage,
  flow: FlowState,
): { ok: true } | { ok: false; reason: string } {
  const s = flow.stages.find((x) => x.key === stage);
  if (!s) return { ok: false, reason: `Unknown stage ${stage}` };
  if (s.status === "locked")
    return { ok: false, reason: s.blockedReason ?? "Not available yet" };
  if (s.status === "done" && !STAGE_BY_KEY[stage].repeatable)
    return { ok: false, reason: "This step has already completed" };
  return { ok: true };
}

/**
 * Can this mode be launched right now?
 *
 * The server action calls this before creating a run, with the same input the
 * console rendered from — so a stale tab cannot start a delta against a wave
 * that has since been signed off.
 */
export function canLaunch(
  stage: MigrationStage,
  flow: FlowState,
): { ok: true } | { ok: false; reason: string } {
  const s = flow.stages.find((x) => x.key === stage);
  if (!s) return { ok: false, reason: `Unknown stage ${stage}` };
  if (s.status === "locked")
    return { ok: false, reason: s.blockedReason ?? "Not available yet" };
  if (s.status === "running")
    return { ok: false, reason: "A run of this step is already in flight" };
  const def = STAGE_BY_KEY[stage];
  if (!def.mode) return { ok: false, reason: "This step has no run" };
  if (s.status === "done" && !def.repeatable)
    return { ok: false, reason: "This step has already completed" };
  return { ok: true };
}
