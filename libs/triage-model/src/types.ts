/**
 * Value types of the triage model.
 *
 * These are the vocabulary the whole feature speaks in — persisted verbatim in
 * `packages/db/src/schema/triage.ts` (which imports and re-exports them, the
 * same arrangement `schema/coverage.ts` has with `@lastest/coverage-model`),
 * consumed by `src/lib/triage/*` and rendered by the Run Results screen.
 *
 * Nothing here touches a database, a clock or an AI client.
 */

/**
 * A reviewer's decision on a single triage case.
 *
 * The first two map onto the shipped Verify mechanisms:
 *   - `bug`         → `confirmCase('regression')`  → GH issue kind `bugfix`
 *   - `improvement` → `confirmCase('improvement')` → GH issue kind `improvement`
 * The rest are new to triage:
 *   - `false_positive` records the verdict and files nothing.
 *   - `flaky_retry`    records the verdict and queues a retry.
 *   - `new_baseline`   routes into the existing approve-baseline path.
 *   - `snoozed`        pairs with `triageCaseVerdicts.snoozedUntil`.
 */
export type TriageVerdict =
  | "bug"
  | "improvement"
  | "false_positive"
  | "flaky_retry"
  | "new_baseline"
  | "snoozed";

/** Lifecycle of one build's triage run. */
export type TriageRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

/**
 * What kind of thing a root-cause cluster is.
 *
 * Mirrors and extends `TriageClassification` in `packages/db/src/schema/tests.ts`
 * (`real_regression | flaky_test | environment_issue | test_maintenance |
 * unknown`), which the retired per-test `failure-triage` pass owned. The names
 * are shortened and `noise` is added for diffs that changed but mean nothing.
 */
export type TriageGroupKind =
  | "regression"
  | "flake"
  | "noise"
  | "maintenance"
  | "environment"
  | "unknown";

/** Why a case entered triage: it failed outright, or it needs review. */
export type TriageCaseStatus = "failed" | "review";

/** A changed-region bounding box, in screenshot pixels. */
export interface TriageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Deterministic signals the model fused into this group. Rendered as the
 * group's supporting detail and used to explain the clustering.
 */
export interface TriageGroupEvidence {
  /** Union of changed-region bounding boxes across the group's diffs. */
  sharedRegions?: TriageRegion[];
  /** Browsers the group's cases span, e.g. ["chromium","firefox","webkit"]. */
  browsers?: string[];
  /** Files from the build change map judged responsible. */
  changedFiles?: string[];
  /** Layers that carried high signal, e.g. ["visual","dom"]. */
  layers?: string[];
  /** Human-readable age, e.g. "present since run 2". */
  age?: string;
}
