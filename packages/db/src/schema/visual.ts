/**
 * Comparison: diffs, baselines and the per-layer verdicts over them.
 *
 * The output side of a run. Screenshot diffs and their baselines, the regions
 * that mask or focus them, the v1.13+ per-(build, test, step) multi-layer
 * comparison rows, the per-layer baselines those compare against, and the human
 * feedback recorded on them.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type {
  DomSnapshotData,
  A11yViolation,
  DesignSystemViolation,
} from "@lastest/eb-protocol";

export type { A11yBaselinePayload } from "@lastest/eb-protocol";

import type { DiffMetadata, DomDiffResult } from "./shared";

import { repositories } from "./repos";

import { testResults, tests } from "./tests";

import type { EvaluationOutcome, NetworkRequest } from "./tests";

import { builds } from "./runs";

export interface AIDiffAnalysis {
  classification: "insignificant" | "meaningful" | "noise";
  recommendation: "approve" | "review" | "flag";
  summary: string;
  confidence: number; // 0-1
  categories?: string[];
  analyzedAt: string;
}

// Visual diffs with approval workflow
export const visualDiffs = pgTable("visual_diffs", {
  id: text("id").primaryKey(),
  buildId: text("build_id")
    .references(() => builds.id)
    .notNull(),
  testResultId: text("test_result_id")
    .references(() => testResults.id)
    .notNull(),
  testId: text("test_id")
    .references(() => tests.id)
    .notNull(),
  stepLabel: text("step_label"),
  baselineImagePath: text("baseline_image_path"),
  currentImagePath: text("current_image_path"),
  diffImagePath: text("diff_image_path"),
  status: text("status").notNull().default("pending"), // 'pending', 'approved', 'rejected', 'auto_approved'
  pixelDifference: integer("pixel_difference").default(0),
  percentageDifference: text("percentage_difference"), // stored as string for precision
  classification: text("classification"), // 'unchanged' | 'flaky' | 'changed'
  metadata: jsonb("metadata").$type<DiffMetadata>(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at"),
  // Planned screenshot comparison fields
  plannedImagePath: text("planned_image_path"),
  plannedDiffImagePath: text("planned_diff_image_path"),
  plannedPixelDifference: integer("planned_pixel_difference"),
  plannedPercentageDifference: text("planned_percentage_difference"),
  // Main baseline comparison fields (for vs_both mode — secondary/informational)
  mainBaselineImagePath: text("main_baseline_image_path"),
  mainDiffImagePath: text("main_diff_image_path"),
  mainPixelDifference: integer("main_pixel_difference"),
  mainPercentageDifference: text("main_percentage_difference"),
  mainClassification: text("main_classification"), // 'unchanged' | 'flaky' | 'changed'
  // AI diff analysis
  aiAnalysis: jsonb("ai_analysis").$type<AIDiffAnalysis>(),
  aiRecommendation: text("ai_recommendation"), // 'approve' | 'review' | 'flag' | null
  aiAnalysisStatus: text("ai_analysis_status"), // 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | null
  browser: text("browser").default("chromium"), // browser used for this diff
  // External issue tracker submission (e.g. GitHub issue created from this diff)
  issueUrl: text("issue_url"),
  issueProvider: text("issue_provider"), // 'github' | 'gitlab' | …
  // Text-diff fields (populated when textDiffEnabled in diffSensitivitySettings).
  // Paths to plain-text page contents captured next to the screenshot via
  // page.evaluate(() => document.body.innerText). Diffed lazily at report-view
  // time; the count summary lives in metadata.textDiffSummary.
  baselineTextPath: text("baseline_text_path"),
  currentTextPath: text("current_text_path"),
  textDiffStatus: text("text_diff_status").$type<TextDiffStatus>(), // 'unchanged' | 'changed' | 'baseline_only' | 'current_only' | 'baseline_establishing' | 'skipped' | null
});

// Baselines for carry-forward logic
export const baselines = pgTable("baselines", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id"),
  testId: text("test_id")
    .references(() => tests.id)
    .notNull(),
  stepLabel: text("step_label"),
  imagePath: text("image_path").notNull(),
  imageHash: text("image_hash").notNull(), // SHA256 for carry-forward matching
  approvedFromDiffId: text("approved_from_diff_id").references(
    () => visualDiffs.id,
  ),
  branch: text("branch").notNull(),
  isActive: boolean("is_active").default(true),
  browser: text("browser").default("chromium"), // browser this baseline applies to
  // DOM snapshot of the page state this baseline image represents, captured at
  // the same moment as the screenshot. The per-step DOM diff compares the
  // current run's per-step snapshot against this. Set when the baseline is
  // created/approved/carried-forward; null on baselines predating DOM capture.
  domSnapshot: jsonb("dom_snapshot").$type<DomSnapshotData>(),
  createdAt: timestamp("created_at"),
});

// Ignore regions for masking areas during diff. Per-(testId, stepLabel) like
// focusRegions — a region applies only to the screenshot it was drawn on.
export const ignoreRegions = pgTable(
  "ignore_regions",
  {
    id: text("id").primaryKey(),
    testId: text("test_id")
      .references(() => tests.id)
      .notNull(),
    stepLabel: text("step_label"),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("idx_ignore_regions_test_step").on(table.testId, table.stepLabel),
  ],
);

// Focus regions: per-screenshot positive mask. If any exist for a (testId, stepLabel),
// the diff engine blanks everything *outside* their union — the inverse of ignoreRegions.
export const focusRegions = pgTable(
  "focus_regions",
  {
    id: text("id").primaryKey(),
    testId: text("test_id")
      .references(() => tests.id, { onDelete: "cascade" })
      .notNull(),
    stepLabel: text("step_label"),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("idx_focus_regions_test_step").on(table.testId, table.stepLabel),
  ],
);

export type FocusRegion = typeof focusRegions.$inferSelect;

export type NewFocusRegion = typeof focusRegions.$inferInsert;

export type VisualDiff = typeof visualDiffs.$inferSelect;

export type AIDiffRecommendation = "approve" | "review" | "flag";

export type AIDiffAnalysisStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type AIDiffingProvider =
  | "openrouter"
  | "anthropic"
  | "same-as-test-gen"
  | "claude-agent-sdk"
  | "ollama";

export type TextDiffStatus =
  | "unchanged"
  | "changed"
  | "baseline_only"
  | "current_only"
  | "baseline_establishing"
  | "skipped";

export type VisualDiffWithTestStatus = VisualDiff & {
  testResultStatus: string | null;
  testName: string | null;
  functionalAreaName: string | null;
  stepLabel?: string | null;
  errorMessage?: string | null;
  a11yViolations?: A11yViolation[] | null;
  designSystemViolations?: DesignSystemViolation[] | null;
  consoleErrors?: string[] | null;
  networkRequests?: NetworkRequest[] | null;
  browser?: string | null;
  // Per-step execution progress (joined from test_results). Used by the build
  // detail page to render per-step pass/fail strips, including synthesizing
  // "skipped/not run" rows for steps past `lastReachedStep`.
  lastReachedStep?: number | null;
  totalSteps?: number | null;
  evaluationOutcome?: EvaluationOutcome | null;
  softErrors?: string[] | null;
};

export type NewVisualDiff = typeof visualDiffs.$inferInsert;

export type Baseline = typeof baselines.$inferSelect;

export type NewBaseline = typeof baselines.$inferInsert;

export type IgnoreRegion = typeof ignoreRegions.$inferSelect;

export type NewIgnoreRegion = typeof ignoreRegions.$inferInsert;

// Diff classification type
export type DiffClassification = "unchanged" | "flaky" | "changed";

export type DiffStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "auto_approved"
  | "todo";

// Review todos — branch-specific actionable items created when reviewer flags a diff
export const reviewTodos = pgTable("review_todos", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  diffId: text("diff_id").references(() => visualDiffs.id),
  buildId: text("build_id").references(() => builds.id),
  testId: text("test_id").references(() => tests.id),
  branch: text("branch").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"), // 'open' | 'resolved'
  createdBy: text("created_by"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
});

export type ReviewTodo = typeof reviewTodos.$inferSelect;

export type NewReviewTodo = typeof reviewTodos.$inferInsert;

// ── Multi-layer step comparisons (v1.13) ─────────────────────────────────────
//
// One row per (build, test, step) capturing the verdict and the per-layer
// evidence summaries used to compute it. The visualDiffs table still owns the
// pixel-diff record; this table is the unified roll-up across all layers.

export type StepVerdict = "green" | "yellow" | "red";

export type EvidenceLayer =
  | "visual"
  | "dom"
  | "a11y"
  | "design"
  | "network"
  | "console"
  | "url"
  | "perf"
  | "variable"
  | "api"
  | "storage";

export interface EvidenceItem {
  layer: EvidenceLayer;
  /** 'high' = real-regression-by-itself (new console error, new 4xx/5xx, URL
   *  divergence, new critical/serious a11y). 'medium' = needs corroboration
   *  (visual change, structural DOM with non-interactive nodes, perf drift,
   *  value-only variable change). */
  signal: "high" | "medium" | "low";
  /** Short human-readable summary, e.g. "2 new 4xx responses". */
  summary: string;
  /** Optional structured payload — layer-specific details. */
  details?: Record<string, unknown>;
}

export interface NetworkDiffSummary {
  /** Raw request-level counts (multiple requests to the same endpoint count separately). */
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** Endpoint-level counts (unique (method, normalized URL) buckets with any added/removed/changed activity).
   *  Use these for verdict scoring and summaries — they collapse cache/retry churn that inflates raw counts.
   *  Optional because historical step_comparisons predating the field will not have them on read. */
  addedEndpoints?: number;
  removedEndpoints?: number;
  changedEndpoints?: number;
  newErrorCount: number;
  newClientErrors: Array<{ url: string; method: string; status: number }>;
  newServerErrors: Array<{ url: string; method: string; status: number }>;
  statusFlips: Array<{ url: string; method: string; from: number; to: number }>;
}

/** Where a console fingerprint most likely originated. Used by the scorer to
 *  demote noise (third-party SDKs, transient network 4xx/5xx) from high to
 *  medium signal so it doesn't redden the verdict on its own. */
export type ConsoleFingerprintCategory =
  | "app"
  | "thirdParty"
  | "network"
  | "csp"
  | "unknown";

export interface ConsoleDiffSummary {
  newFingerprints: Array<{
    fingerprint: string;
    sample: string;
    count: number;
    category?: ConsoleFingerprintCategory;
  }>;
  disappeared: Array<{
    fingerprint: string;
    sample: string;
    count: number;
    category?: ConsoleFingerprintCategory;
  }>;
  countDelta: Record<string, number>;
}

export interface UrlTrajectoryDiffSummary {
  divergedSteps: Array<{
    stepIndex: number;
    stepLabel?: string;
    baselineUrl: string;
    currentUrl: string;
    /** True if redirect-chain length changed (often indicates auth/SSO regressions). */
    redirectChainChanged: boolean;
  }>;
  totalStepsCompared: number;
}

export interface A11yDiffSummary {
  newViolations: A11yViolation[];
  disappeared: A11yViolation[];
  /** New violations broken down by impact, for quick verdict scoring. */
  newBySeverity: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
}

export interface DesignSystemDiffSummary {
  newViolations: DesignSystemViolation[];
  disappeared: DesignSystemViolation[];
  newBySeverity: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
}

export interface PerfDiffSummary {
  /** Per-step deltas for each metric (current minus baseline). */
  deltas: Array<{
    stepIndex?: number;
    stepLabel?: string;
    metric: "lcp" | "cls" | "inp" | "fcp" | "tbt" | "ttfb";
    baseline: number;
    current: number;
    delta: number;
    /** True if `current` exceeds the absolute budget for the metric. */
    budgetBreached: boolean;
    /** True if `current` breaches the budget AND baseline did not — i.e. a NEW
     *  breach this run. Pre-existing breaches with delta≈0 stay `budgetBreached`
     *  but `newlyBreached=false`, so scorer can skip them as non-regressions.
     *  Optional because historical rows predating the field will not have it on read. */
    newlyBreached?: boolean;
    /** True if `delta` exceeds the relative-drift threshold (default 20%). */
    drifted: boolean;
  }>;
}

export interface VariableDiffSummary {
  /** Tier ordering: structural-break > type-change > value-change-numeric > value-change-string */
  changes: Array<{
    path: string;
    tier:
      | "structural-break"
      | "type-change"
      | "value-change-numeric"
      | "value-change-string";
    baseline?: unknown;
    current?: unknown;
  }>;
}

/** One changed entry in the end-of-run storage state diff (State tab).
 *  `key` is "domain path name" for cookies, "origin name" for localStorage.
 *  Values are never included — snapshots carry hashes, not raw values. */
export interface StorageStateDiffEntry {
  key: string;
  change: "added" | "removed" | "changed";
  detail?: string;
}

/** Current run's end-of-run cookies + localStorage diffed against the
 *  baseline run's snapshot (web analogue of a "files touched" pane). */
export interface StorageStateDiffSummary {
  cookies: StorageStateDiffEntry[];
  localStorage: StorageStateDiffEntry[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
}

export interface StepComparisonEvidence {
  visual?: {
    pixelDifference: number;
    percentageDifference: string | null;
    diffId?: string;
  };
  dom?: DomDiffResult;
  a11y?: A11yDiffSummary;
  designSystem?: DesignSystemDiffSummary;
  network?: NetworkDiffSummary;
  consoleDiff?: ConsoleDiffSummary;
  url?: UrlTrajectoryDiffSummary;
  perf?: PerfDiffSummary;
  variable?: VariableDiffSummary;
  storageState?: StorageStateDiffSummary;
}

export type StepIssueState = "open" | "auto" | "linked" | "closed";

/**
 * Verify phase (v1.14+) — typed-ticket kind. Distinguishes the three reviewer
 * verdicts that produce different GitHub issues:
 *   - bugfix:      regression — code shipped broke something tracked.
 *   - improvement: missed — code shipped didn't cover what the area's intent was.
 *   - verification: ad-hoc manual filing from createIssueForCase (no confirm).
 */
export type StepIssueKind = "bugfix" | "improvement" | "verification";

export const stepComparisons = pgTable(
  "step_comparisons",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id")
      .references(() => builds.id, { onDelete: "cascade" })
      .notNull(),
    testId: text("test_id")
      .references(() => tests.id, { onDelete: "cascade" })
      .notNull(),
    testResultId: text("test_result_id").references(() => testResults.id, {
      onDelete: "cascade",
    }),
    visualDiffId: text("visual_diff_id").references(() => visualDiffs.id, {
      onDelete: "set null",
    }),
    stepIndex: integer("step_index"),
    stepLabel: text("step_label"),
    verdict: text("verdict").$type<StepVerdict>().notNull(),
    /** Ordered list of evidence items contributing to the verdict. */
    evidence: jsonb("evidence").$type<EvidenceItem[]>().notNull().default([]),
    /** Layer-specific structured diff summaries. */
    layers: jsonb("layers")
      .$type<StepComparisonEvidence>()
      .notNull()
      .default({}),
    // Verify phase (v1.14+) — GitHub issue link per case.
    githubIssueUrl: text("github_issue_url"),
    githubIssueNumber: integer("github_issue_number"),
    githubIssueState: text("github_issue_state").$type<StepIssueState>(),
    // Typed-ticket kind. Captured at confirmation time so issue close/reopen
    // preserves intent, and so the board can filter "show me all improvements".
    githubIssueKind: text("github_issue_kind").$type<StepIssueKind>(),
    // Explicit reviewer confirmation — distinct from "card landed here because
    // it had 0 diff". Set by confirmCase() when the user drops a card into a
    // typed column. Used by the GH webhook to auto-flip cases back to done when
    // an issue closes and a rerun shows green.
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at"),
    // Free-text reviewer note (e.g. "the new banner copy should say X but
    // didn't"). Prepended to GH issue body when the reviewer files an issue
    // for this case. Surfaced as a textarea on Missed-column cards.
    reviewerNote: text("reviewer_note"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_step_comparisons_build").on(table.buildId),
    index("idx_step_comparisons_test").on(table.testId),
  ],
);

export type StepComparison = typeof stepComparisons.$inferSelect;

export type NewStepComparison = typeof stepComparisons.$inferInsert;

// ---------------------------------------------------------------------------
// Verify phase — Per-layer baselines (v1.14+)
// ---------------------------------------------------------------------------
//
// Mirror the existing `baselines` table for visual diffs but per non-visual
// layer. When the reviewer marks a layer's evidence as "Expected" on a step,
// the corresponding *baseline_<layer> row is upserted; subsequent builds
// suppress identical evidence by consulting the baseline before emitting.

export type LayerBaselineKind =
  | "network"
  | "console"
  | "a11y"
  | "perf"
  | "variable"
  | "url_trajectory"
  | "dom";

export interface NetworkBaselinePayload {
  normalizedUrl: string;
  method: string;
  /** Status range that's considered acceptable (e.g. [200, 299]). */
  statusRange: [number, number];
  p95DurationMs: number | null;
  bodyFingerprint?: string;
  thirdPartyDomains?: string[];
}

export interface ConsoleBaselinePayload {
  fingerprint: string;
  level: string;
  expectedCount: number;
  lastSeenBuildId: string;
  sample: string;
}

// `A11yBaselinePayload` moved to `@lastest/eb-protocol` (re-exported below)
// when `a11y_baselines` became `@lastest/plugin-a11y`'s own table — the
// plugin owns the table and needs the payload shape, and it cannot import
// `packages/db`. The `a11y` member of `LayerBaselineKind` above stays: it is
// core's *evidence-layer* vocabulary, not a claim to the table.

export interface PerfBaselinePayload {
  /** Rolling p50/p95 for each Web Vital. */
  metrics: Partial<
    Record<
      "lcp" | "cls" | "inp" | "fcp" | "tbt" | "ttfb",
      { p50: number; p95: number }
    >
  >;
}

export interface VariableBaselinePayload {
  key: string;
  value: string | null;
}

export interface UrlTrajectoryBaselinePayload {
  /** Expected URL sequence with optional wildcards (e.g. `/checkout/*`). */
  sequence: string[];
}

export interface DomBaselinePayload {
  selector: string;
  acceptedAttributes: Record<string, string | null>;
}

export const networkBaselines = pgTable(
  "network_baselines",
  {
    id: text("id").primaryKey(),
    testId: text("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    stepLabel: text("step_label"),
    branch: text("branch").notNull(),
    isActive: boolean("is_active").default(true),
    approvedFromComparisonId: text("approved_from_comparison_id"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at").$defaultFn(() => new Date()),
    payload: jsonb("payload").$type<NetworkBaselinePayload>().notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_network_baselines_test").on(table.testId)],
);

export const consoleBaselines = pgTable(
  "console_baselines",
  {
    id: text("id").primaryKey(),
    testId: text("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    stepLabel: text("step_label"),
    branch: text("branch").notNull(),
    isActive: boolean("is_active").default(true),
    approvedFromComparisonId: text("approved_from_comparison_id"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at").$defaultFn(() => new Date()),
    payload: jsonb("payload").$type<ConsoleBaselinePayload>().notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_console_baselines_test").on(table.testId)],
);

// `a11yBaselines` moved to `plugins/a11y/src/schema.ts` — the a11y check
// layer is a plugin now (RFC §9 phase 3). The table gained `repository_id`/
// `team_id` and dropped its FK to `tests.id` there, per
// `docs/architecture/core-scope.md` §6: a plugin table carries no FK to a
// core table, so its rows are reaped by the plugin's own deletion hook
// instead of a database cascade. Migration: `scripts/migrate.js`.

export const perfBaselines = pgTable(
  "perf_baselines",
  {
    id: text("id").primaryKey(),
    testId: text("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    stepLabel: text("step_label"),
    branch: text("branch").notNull(),
    isActive: boolean("is_active").default(true),
    approvedFromComparisonId: text("approved_from_comparison_id"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at").$defaultFn(() => new Date()),
    payload: jsonb("payload").$type<PerfBaselinePayload>().notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_perf_baselines_test").on(table.testId)],
);

export const variableBaselines = pgTable(
  "variable_baselines",
  {
    id: text("id").primaryKey(),
    testId: text("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    stepLabel: text("step_label"),
    branch: text("branch").notNull(),
    isActive: boolean("is_active").default(true),
    approvedFromComparisonId: text("approved_from_comparison_id"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at").$defaultFn(() => new Date()),
    payload: jsonb("payload").$type<VariableBaselinePayload>().notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_variable_baselines_test").on(table.testId)],
);

export const urlTrajectoryBaselines = pgTable(
  "url_trajectory_baselines",
  {
    id: text("id").primaryKey(),
    testId: text("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    branch: text("branch").notNull(),
    isActive: boolean("is_active").default(true),
    approvedFromComparisonId: text("approved_from_comparison_id"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at").$defaultFn(() => new Date()),
    payload: jsonb("payload").$type<UrlTrajectoryBaselinePayload>().notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_url_trajectory_baselines_test").on(table.testId)],
);

export const domBaselines = pgTable(
  "dom_baselines",
  {
    id: text("id").primaryKey(),
    testId: text("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    stepLabel: text("step_label"),
    branch: text("branch").notNull(),
    isActive: boolean("is_active").default(true),
    approvedFromComparisonId: text("approved_from_comparison_id"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at").$defaultFn(() => new Date()),
    payload: jsonb("payload").$type<DomBaselinePayload>().notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_dom_baselines_test").on(table.testId)],
);

export type NetworkBaseline = typeof networkBaselines.$inferSelect;

export type ConsoleBaseline = typeof consoleBaselines.$inferSelect;

// `A11yBaseline` moved with its table — see `plugins/a11y/src/schema.ts`.

export type PerfBaseline = typeof perfBaselines.$inferSelect;

export type VariableBaseline = typeof variableBaselines.$inferSelect;

export type UrlTrajectoryBaseline = typeof urlTrajectoryBaselines.$inferSelect;

export type DomBaseline = typeof domBaselines.$inferSelect;

// ---------------------------------------------------------------------------
// Verify phase — Per-layer feedback on step comparisons
// ---------------------------------------------------------------------------
//
// One row per (stepComparisonId, layer) capturing the reviewer's verdict on
// that layer for that step. Mirrors the visual-diff three-state lifecycle
// (pending | approved | rejected | auto_approved) and adds 'snoozed' for
// build-scoped suppression.

export type LayerFeedbackStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "snoozed"
  | "auto_approved";

export const stepLayerFeedback = pgTable(
  "step_layer_feedback",
  {
    id: text("id").primaryKey(),
    stepComparisonId: text("step_comparison_id")
      .notNull()
      .references(() => stepComparisons.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    layer: text("layer").$type<EvidenceLayer>().notNull(),
    status: text("status")
      .$type<LayerFeedbackStatus>()
      .notNull()
      .default("pending"),
    /** Which baseline kind, if any, was written when status='approved'. */
    baselineKind: text("baseline_kind").$type<LayerBaselineKind | null>(),
    /** Optional review-todo id created when status='rejected'. */
    reviewTodoId: text("review_todo_id"),
    note: text("note"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at"),
    /** AI's per-layer recommendation captured at evidence time. */
    aiRecommendation: text(
      "ai_recommendation",
    ).$type<AIDiffRecommendation | null>(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_layer_feedback_step").on(table.stepComparisonId),
    index("idx_layer_feedback_build").on(table.buildId),
    uniqueIndex("uniq_layer_feedback_step_layer").on(
      table.stepComparisonId,
      table.layer,
    ),
  ],
);

export type StepLayerFeedback = typeof stepLayerFeedback.$inferSelect;

export type NewStepLayerFeedback = typeof stepLayerFeedback.$inferInsert;
