/**
 * What we test: tests, their versions, results, routes and fixtures.
 *
 * `tests` is a hub table (24 inbound FKs). This module owns the test
 * definition (steps, variables, assertions, API tests), the per-run row types it
 * produces (`test_runs`, `test_results`), the route inventory the tests are
 * planned from, and the per-test caches keyed off it (`selector_stats`,
 * `inspector_cache`).
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
  ApiTestDefinition,
  ApiTestResultData,
  DesignSystemViolation,
  DesignSystemTokenUsage,
  AssertionResult,
  StorageStateSnapshot,
  UrlTrajectoryStep,
  WebVitalsSample,
  StepTiming,
  ConsoleEntry,
} from "@lastest/eb-protocol";

export type {
  DesignSystemScoreSummary,
  WcagScoreSummary,
} from "@lastest/eb-protocol";

// API-test payload shapes (E1). Owned by `@lastest/plugin-api-test`, stored in
// core columns on `tests` / `test_results`, so they are defined in
// `@lastest/eb-protocol` and re-exported here — app code has always imported
// them from `@/lib/db/schema` next to the rows they live in.
export type {
  ApiAuth,
  ApiAssertion,
  ApiAssertionKind,
  ApiAssertionResultData,
  ApiTestDefinition,
  ApiTestResultData,
} from "@lastest/eb-protocol";

import type {
  DesignSystemConfig,
  DiffMetadata,
  DomDiffResult,
  StabilizationSettings,
} from "./shared";

import { users } from "./identity";

import { repositories } from "./repos";

export type TriageClassification =
  | "real_regression"
  | "flaky_test"
  | "environment_issue"
  | "test_maintenance"
  | "unknown";

export interface TriageResult {
  classification: TriageClassification;
  confidence: number; // 0-1
  reasoning: string;
  actionTaken?: string;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  duration: number;
  resourceType: string;
  failed?: boolean;
  errorText?: string;
  startTime?: number;
  /** ms since recording start (video clock). Set by EB runs; lets timeline
   *  consumers place the request without epoch math. */
  atMs?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
  responseBody?: string;
  responseSize?: number;
}

export interface DownloadRecord {
  suggestedFilename: string;
  savedPath: string;
  url?: string;
  sizeBytes?: number;
  durationMs?: number;
  startTime?: number;
}

/** Capabilities that a test requires from Playwright settings (detected during recording). */
export interface TestRequiredCapabilities {
  fileUpload?: boolean;
  clipboard?: boolean;
  networkInterception?: boolean;
  downloads?: boolean;
}

export interface TestSetupOverrides {
  skippedDefaultStepIds: string[]; // IDs from default_setup_steps to skip
  extraSteps: Array<{
    stepType: "test" | "script" | "storage_state";
    testId?: string | null;
    scriptId?: string | null;
    storageStateId?: string | null;
  }>;
}

export interface TestTeardownOverrides {
  skippedDefaultStepIds: string[]; // IDs from default_teardown_steps to skip
  extraSteps: Array<{
    stepType: "test" | "script" | "storage_state";
    testId?: string | null;
    scriptId?: string | null;
    storageStateId?: string | null;
  }>;
}

export interface TestDiffOverrides {
  unchangedThreshold?: number;
  flakyThreshold?: number;
  includeAntiAliasing?: boolean;
  ignorePageShift?: boolean;
  diffEngine?: "pixelmatch" | "ssim" | "butteraugli";
  textRegionAwareDiffing?: boolean;
  textRegionThreshold?: number;
  textRegionPadding?: number;
  textDetectionGranularity?: "word" | "line" | "block";
  regionDetectionMode?: "grid" | "flood-fill";
}

export interface TestPlaywrightOverrides {
  browser?: "chromium" | "firefox" | "webkit";
  navigationTimeout?: number;
  actionTimeout?: number;
  screenshotDelay?: number;
  // Legacy network/console error mode (fail/warn/ignore). Kept for back-
  // compat with the per-test override JSON shape; new code should write
  // `networkMode`/`consoleMode` below and the persisting layer will mirror
  // them onto these for back-compat with code that still reads the legacy
  // names.
  networkErrorMode?: "fail" | "warn" | "ignore";
  consoleErrorMode?: "fail" | "warn" | "ignore";
  // Per-test 3-way modes overriding the repo's playwright_settings.*Mode
  // values. Sparse: only present keys override; absent keys fall through
  // to the repo defaults. The Verify cogwheel modal writes these when
  // opened in per-test mode.
  visualMode?: "enforce" | "log" | "disable";
  textMode?: "enforce" | "log" | "disable";
  domMode?: "enforce" | "log" | "disable";
  networkMode?: "enforce" | "log" | "disable";
  consoleMode?: "enforce" | "log" | "disable";
  a11yMode?: "enforce" | "log" | "disable";
  designMode?: "enforce" | "log" | "disable";
  perfMode?: "enforce" | "log" | "disable";
  urlMode?: "enforce" | "log" | "disable";
  apiMode?: "enforce" | "log" | "disable";
  storageMode?: "enforce" | "log" | "disable";
  acceptAnyCertificate?: boolean;
  maxParallelTests?: number;
  baseUrl?: string;
  cursorPlaybackSpeed?: number;
  // Per-candidate waitFor budget inside locateWithFallback. Falls back to
  // playwrightSettings.selectorTimeoutMs, then a 3000ms default.
  selectorTimeoutMs?: number;
}

// Per-step pass/fail rules. Extensible: add new `kind`s and handle them in
// src/lib/execution/evaluation.ts. MVP: screenshot_changed.
//
// `all_steps_executed` is a special test-level rule (stepLabel ignored) that
// trips when the runner reports `lastReachedStep + 1 < totalSteps`. It is
// **default ON** for every test — synthesized at evaluation time when the
// stored criteria don't already include it. To opt out, persist the rule
// with `severity: 'warn'` (the UI toggle writes this when unchecked).
export type StepRuleKind =
  | "screenshot_changed"
  | "focus_region_changed"
  | "console_error"
  | "assertion_failed"
  | "variable_equals"
  | "all_steps_executed";

export type StepRuleSeverity = "fail" | "warn";

export interface StepRule {
  kind: StepRuleKind;
  severity: StepRuleSeverity;
  params?: Record<string, unknown>;
}

export interface StepCriterion {
  stepLabel: string;
  rules: StepRule[];
}

export interface TriggeredStepRule {
  stepLabel: string;
  rule: StepRule;
  reason: string;
}

export interface EvaluationOutcome {
  triggeredRules: TriggeredStepRule[];
  evaluatedAt: string;
  // Status the evaluator promoted the result to (only set when it actually flipped).
  overriddenStatus?: "failed";
}

export const functionalAreas = pgTable("functional_areas", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id"),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  isRouteFolder: boolean("is_route_folder").default(false),
  orderIndex: integer("order_index").default(0),
  agentPlan: text("agent_plan"), // markdown test plan from Planner agent — canonical "what's in this area" field
  planGeneratedAt: timestamp("plan_generated_at"),
  planSnapshot: text("plan_snapshot"), // JSON: FunctionalAreaPlanSnapshot for rollback
  deletedAt: timestamp("deleted_at"),
});

// ---------------------------------------------------------------------------
// API tests (E1) — headless HTTP test definition + assertions.
// A standalone request executed without a browser; results flow through the
// same test_results / step_comparisons / evidence pipeline as browser tests
// under the `api` check layer.
//
// The shapes themselves live in `@lastest/eb-protocol` (re-exported at the top
// of this module and from `./eb-protocol`), because `@lastest/plugin-api-test`
// owns them and may not import `@lastest/db`. The *columns* stay here: they are
// on `tests` and `test_results`, which are core tables.
// ---------------------------------------------------------------------------

export const tests = pgTable("tests", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id"),
  functionalAreaId: text("functional_area_id").references(
    () => functionalAreas.id,
    { onDelete: "set null" },
  ),
  name: text("name").notNull(),
  code: text("code").notNull(), // Playwright test code
  // NB: per-test description/spec lives in `test_specs` (1:1 via specId). Fetch via getTestSpec().
  isPlaceholder: boolean("is_placeholder").default(false),
  targetUrl: text("target_url"),
  // Setup configuration - setupTestId takes precedence over setupScriptId
  setupTestId: text("setup_test_id"), // Use another test as setup (most common)
  setupScriptId: text("setup_script_id"), // OR use dedicated setup script
  setupOverrides: jsonb("setup_overrides").$type<TestSetupOverrides>(),
  teardownOverrides: jsonb("teardown_overrides").$type<TestTeardownOverrides>(),
  stabilizationOverrides: jsonb("stabilization_overrides").$type<
    Partial<StabilizationSettings>
  >(),
  requiredCapabilities: jsonb(
    "required_capabilities",
  ).$type<TestRequiredCapabilities>(),
  viewportOverride: jsonb("viewport_override").$type<{
    width: number;
    height: number;
  }>(),
  diffOverrides: jsonb("diff_overrides").$type<TestDiffOverrides>(),
  playwrightOverrides: jsonb(
    "playwright_overrides",
  ).$type<TestPlaywrightOverrides>(),
  // Per-test design-system overrides. When null, falls back to the repo-level
  // playwright_settings.designSystem config. Same merge semantics as the
  // other overrides — the EB receives the effective merged token set.
  designSystemOverrides: jsonb("design_system_overrides").$type<
    Partial<DesignSystemConfig>
  >(),
  assertions: jsonb("assertions").$type<TestAssertion[]>(),
  // Per-step pass/fail rules. Evaluated post-execution by evaluateStepCriteria.
  stepCriteria: jsonb("step_criteria").$type<StepCriterion[]>(),
  // Named variables: bind values to page fields (extract from / assign to).
  // {{var:name}} references in code are resolved at execution time.
  variables: jsonb("variables").$type<TestVariable[]>(),
  // Per-run row cursor map for assign-mode vars with sourceRowMode='increment'.
  // Keyed by TestVariable.id → next-row-to-use. Updated post-resolve by the
  // executor; wraps back to 2 (not 0) when it overflows the source's rowCount.
  variableRowCursors: jsonb("variable_row_cursors").$type<
    Record<string, number>
  >(),
  // Last-known-good value cache for assign-mode AI-generated vars. Keyed by
  // TestVariable.id. The executor writes the most recent successful AI output
  // here so 'fixed' refresh-mode reuses it across runs and 'random' mode can
  // fall back to it when AI is misconfigured / rate-limited.
  aiVarLastValues: jsonb("ai_var_last_values").$type<Record<string, string>>(),
  // E1: test type discriminator. 'browser' (Playwright, default) | 'api' (headless HTTP).
  testType: text("test_type").default("browser"),
  apiDefinition: jsonb("api_definition").$type<ApiTestDefinition>(),
  executionMode: text("execution_mode").default("procedural"), // 'procedural' | 'agent'
  quarantined: boolean("quarantined").default(false), // quarantined tests run but don't block builds
  domSnapshot: jsonb("dom_snapshot").$type<DomSnapshotData>(), // DOM state captured during recording
  specId: text("spec_id"), // FK to testSpecs (back-reference for 1:1 link)
  // Gamification attribution: who authored this test. Mutually exclusive. Nullable for legacy rows.
  createdByUserId: text("created_by_user_id"),
  createdByBotId: text("created_by_bot_id"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const testRuns = pgTable("test_runs", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id"),
  runnerId: text("runner_id"), // nullable - set when run via remote runner, null for local runs
  gitBranch: text("git_branch").notNull(),
  gitCommit: text("git_commit").notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  status: text("status"), // 'passed', 'failed', 'running'
});

export interface CapturedScreenshot {
  path: string;
  label?: string;
  // Offset of this capture into the test recording, in milliseconds (capture
  // wall-clock minus the video-recording start). Powers the public share page's
  // "In this video" chapter rail, which seeks the recording to each step.
  // Optional/back-compat: legacy rows lack it, and the share page falls back to
  // distributing steps evenly across the recording duration. jsonb column, so
  // adding this field needs no migration.
  atMs?: number;
  // Purely-cosmetic display name for the "In this video" chapter rail, derived
  // from the test's screenshot-path slug (e.g. shot(2,'new-project') → "New
  // project"). MUST stay decorative: the structural step key is `label`
  // ("Step N") / the filename, which the diff pipeline uses to match baselines
  // (baselines.stepLabel) and order steps. `title` is never read by diff/verify
  // — overriding it can't desync pixel comparison. Absent → rail uses `label`.
  title?: string;
  // Per-step DOM snapshot captured at THIS screenshot's moment (same page
  // state + scroll), so DOM-diff overlays align with this screenshot instead of
  // a single end-of-test snapshot reused across every step. Bounding boxes are
  // document-relative (see selector-utils). Optional/back-compat: jsonb column,
  // so adding this needs no migration; absent on legacy rows.
  domSnapshot?: DomSnapshotData;
}

// Success criteria / assertion tracking
export interface TestAssertion {
  id: string;
  orderIndex: number;
  category: "element" | "page" | "generic" | "visual" | "download";
  assertionType: string;
  negated: boolean;
  targetSelector?: string;
  targetSelectors?: Array<{ type: string; value: string }>;
  expectedValue?: string;
  attributeName?: string;
  label?: string;
  codeLineStart?: number;
  codeLineEnd?: number;
  /** Always true — kept for back-compat with persisted rows. Whether an
   *  assertion failure actually fails the test is decided by the per-assertion
   *  rule on the Criteria tab (see `StepCriterion` / `assertion_failed`). */
  isSoft?: boolean;
}

// Test variables — named values bound to page fields.
// `assign` mode: value is sourced from gsheet/csv/static and replaces {{var:name}} in code at runtime.
// `extract` mode: value is read from a page field after the test, optionally compared to expectedValue (eotest assertion).
export type TestVariableMode = "extract" | "assign";

export type TestVariableSourceType =
  | "gsheet"
  | "csv"
  | "static"
  | "ai-generated";

export type TestVariableAttribute =
  | "value"
  | "textContent"
  | "innerText"
  | "innerHTML";

export type TestVariableSourceRowMode = "fixed" | "increment" | "random";

// Built-in AI-generated attribute presets. 'custom' means use aiCustomPrompt.
export type AIVarPreset =
  | "firstName"
  | "lastName"
  | "middleName"
  | "fullName"
  | "email"
  | "company"
  | "jobTitle"
  | "ukAddress"
  | "ukAddressMultiline"
  | "usAddress"
  | "ukPhone"
  | "usPhone"
  | "custom";

export interface TestVariable {
  id: string;
  name: string;
  mode: TestVariableMode;
  // Extract mode
  targetSelector?: string;
  attribute?: TestVariableAttribute;
  // Assign mode source
  sourceType?: TestVariableSourceType;
  sourceAlias?: string;
  sourceColumn?: string;
  sourceRow?: number;
  // How the row gets picked at run time. Default 'fixed' — uses sourceRow.
  // 'increment' walks forward across runs and wraps from rowCount-1 back to 2
  // (rows 0/1 reserved as defaults). 'random' picks any row each run.
  // For 'ai-generated' source: 'fixed' = pinned to cached value, 'random' =
  // regenerate per run with cache fallback. 'increment' is rejected for AI vars.
  sourceRowMode?: TestVariableSourceRowMode;
  staticValue?: string;
  // AI-generated source
  aiPreset?: AIVarPreset;
  aiCustomPrompt?: string;
  // Eotest assertion
  expectedValue?: string;
  assertEnabled?: boolean;
  assertSeverity?: StepRuleSeverity;
  description?: string;
}

// ── Multi-layer comparison types (v1.13) ─────────────────────────────────────

/** Per-step URL trajectory entry. Captured by the EB executor at each
 *  __stepReached boundary so we can detect routing/auth divergence between
 *  baseline and feature runs (the classic "session expired → /login" case). */
/** Storage state snapshot — minimal cookie + localStorage capture for diff.
 *  Mirrors a subset of Playwright's storageState() output. Token-shaped
 *  values are redacted at capture time; we keep presence + a hash for diff. */
export const testResults = pgTable("test_results", {
  id: text("id").primaryKey(),
  testRunId: text("test_run_id").references(() => testRuns.id),
  testId: text("test_id").references(() => tests.id),
  testVersionId: text("test_version_id"), // links to testVersions.id — which version was executed
  status: text("status"), // 'passed', 'failed', 'skipped'
  // E1: result of a headless API test (null for browser tests).
  apiResult: jsonb("api_result").$type<ApiTestResultData>(),
  screenshotPath: text("screenshot_path"),
  screenshots: jsonb("screenshots").$type<CapturedScreenshot[]>(),
  diffPath: text("diff_path"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  viewport: text("viewport"), // e.g., '1920x1080'
  browser: text("browser").default("chromium"),
  consoleErrors: jsonb("console_errors").$type<string[]>(),
  // Timestamped console capture (video clock). Additive alongside
  // consoleErrors — see ConsoleEntry.
  consoleEntries: jsonb("console_entries").$type<ConsoleEntry[]>(),
  networkRequests: jsonb("network_requests").$type<NetworkRequest[]>(),
  downloads: jsonb("downloads").$type<DownloadRecord[]>(),
  a11yViolations: jsonb("a11y_violations").$type<A11yViolation[]>(),
  // Off-token CSS values captured by the design-system harvester. Same
  // surface model as a11y: collected per-screenshot, aggregated to a
  // build-level score (designSystemScore) and drill-in row set.
  designSystemViolations: jsonb("design_system_violations").$type<
    DesignSystemViolation[]
  >(),
  designSystemRulesChecked: integer("design_system_rules_checked"),
  // Per-category, per-value usage counter for ON-token values captured
  // during the harvester walk. Used by the verify Design review panel to
  // light up "tokens in use" tiles. Shape:
  //   { color: { '#e03e36': 12, ... }, spacing: { '8px': 30, ... }, ... }
  designSystemTokenUsage: jsonb(
    "design_system_token_usage",
  ).$type<DesignSystemTokenUsage>(),
  // EB-side test executor log lines (info/warn/error from runner-client + test-executor).
  // Populated for embedded-browser runs; null for legacy/local. Lets us inspect
  // [Nav]/[Shot] probe lines post-hoc when an EB pod is already GC'd.
  logs: jsonb("logs").$type<
    Array<{ timestamp: number; level: string; message: string }>
  >(),
  assertionResults: jsonb("assertion_results").$type<AssertionResult[]>(),
  a11yPassesCount: integer("a11y_passes_count"),
  videoPath: text("video_path"),
  networkBodiesPath: text("network_bodies_path"),
  softErrors: jsonb("soft_errors").$type<string[]>(),
  retryOf: text("retry_of"), // links to original test result ID if this is a retry
  isFlaky: boolean("is_flaky").default(false), // true if test failed then passed on retry
  triage: jsonb("triage").$type<TriageResult>(), // AI failure triage classification
  domSnapshot: jsonb("dom_snapshot").$type<DomSnapshotData>(), // DOM state captured at screenshot time
  lastReachedStep: integer("last_reached_step"), // 0-based index of last step reached during execution
  totalSteps: integer("total_steps"), // total parsed step count for watermark ratio computation
  evaluationOutcome: jsonb("evaluation_outcome").$type<EvaluationOutcome>(), // step-criteria rule firings
  // Values pulled from page fields by extract-mode TestVariables, post-run.
  extractedVariables: jsonb("extracted_variables").$type<
    Record<string, string>
  >(),
  // Values resolved & injected by assign-mode TestVariables for this run.
  // Keyed by variable name — same shape as extractedVariables. Surfaces in
  // the Vars tab "Last run" column for assign-mode rows (especially helpful
  // with sourceRowMode='random'/'increment' where the user otherwise can't
  // tell which row was actually used).
  assignedVariables:
    jsonb("assigned_variables").$type<Record<string, string>>(),
  // ── Multi-layer comparison capture (v1.13) ─────────────────────────────
  // URL trajectory: ordered list of {stepIndex, finalUrl, redirectChain}
  urlTrajectory: jsonb("url_trajectory").$type<UrlTrajectoryStep[]>(),
  // Web Vitals samples: per-screenshot LCP/CLS/INP/FCP/TBT
  webVitals: jsonb("web_vitals").$type<WebVitalsSample[]>(),
  // End-of-test cookie + localStorage snapshot (values are hashed, not stored raw)
  storageStateSnapshot: jsonb(
    "storage_state_snapshot",
  ).$type<StorageStateSnapshot>(),
  // Per-step start/end on the video clock — powers the annotated scrubber and
  // step-synced evidence panes. Null for legacy/local runs.
  stepTimings: jsonb("step_timings").$type<StepTiming[]>(),
});

// Planned/expected screenshots for design comparison
export const plannedScreenshots = pgTable("planned_screenshots", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  testId: text("test_id").references(() => tests.id, { onDelete: "cascade" }),
  stepLabel: text("step_label"),
  routeId: text("route_id").references(() => routes.id, {
    onDelete: "cascade",
  }),
  imagePath: text("image_path").notNull(),
  imageHash: text("image_hash").notNull(),
  name: text("name"),
  description: text("description"),
  uploadedBy: text("uploaded_by").references(() => users.id),
  sourceUrl: text("source_url"), // Original design file URL (Figma, etc.)
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type PlannedScreenshot = typeof plannedScreenshots.$inferSelect;

export type NewPlannedScreenshot = typeof plannedScreenshots.$inferInsert;

export type FunctionalArea = typeof functionalAreas.$inferSelect;

export type NewFunctionalArea = typeof functionalAreas.$inferInsert;

export interface FunctionalAreaPlanSnapshot {
  previousPlan: string | null;
  generatedTestIds: string[];
}

export type Test = typeof tests.$inferSelect;

export type NewTest = typeof tests.$inferInsert;

export type TestRun = typeof testRuns.$inferSelect;

export type NewTestRun = typeof testRuns.$inferInsert;

export type TestResult = typeof testResults.$inferSelect;

export type NewTestResult = typeof testResults.$inferInsert;

// Discovered routes for coverage tracking
export const routes = pgTable("routes", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  path: text("path").notNull(),
  type: text("type").notNull(), // 'static' | 'dynamic'
  description: text("description"),
  filePath: text("file_path"),
  framework: text("framework"), // 'nextjs-app' | 'nextjs-pages' | 'react-router' | 'vue'
  routerType: text("router_type"), // 'hash' | 'browser'
  functionalAreaId: text("functional_area_id").references(
    () => functionalAreas.id,
    { onDelete: "set null" },
  ),
  hasTest: boolean("has_test").default(false),
  scannedAt: timestamp("scanned_at"),
});

// Test suggestions for routes from AI discovery
export const routeTestSuggestions = pgTable("route_test_suggestions", {
  id: text("id").primaryKey(),
  routeId: text("route_id").references(() => routes.id, {
    onDelete: "cascade",
  }),
  suggestion: text("suggestion").notNull(),
  matchedTestId: text("matched_test_id").references(() => tests.id),
  createdAt: timestamp("created_at"),
});

// Scan status for progress tracking
export const scanStatus = pgTable("scan_status", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  status: text("status").notNull(), // 'idle' | 'scanning' | 'completed' | 'error'
  progress: integer("progress").default(0),
  routesFound: integer("routes_found").default(0),
  framework: text("framework"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export type Route = typeof routes.$inferSelect;

export type NewRoute = typeof routes.$inferInsert;

export type RouteTestSuggestion = typeof routeTestSuggestions.$inferSelect;

export type NewRouteTestSuggestion = typeof routeTestSuggestions.$inferInsert;

export type ScanStatus = typeof scanStatus.$inferSelect;

export type NewScanStatus = typeof scanStatus.$inferInsert;

// Diff engine types
export type DiffEngineType = "pixelmatch" | "ssim" | "butteraugli";

// Test versions for version history
export type TestChangeReason =
  | "initial"
  | "manual_edit"
  | "ai_fix"
  | "ai_enhance"
  | "restored"
  | "branch_merge"
  | "assertion_sync"
  | "spec_regeneration"
  | "debug_rerecord";

export const testVersions = pgTable("test_versions", {
  id: text("id").primaryKey(),
  testId: text("test_id")
    .references(() => tests.id, { onDelete: "cascade" })
    .notNull(),
  version: integer("version").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  targetUrl: text("target_url"),
  changeReason: text("change_reason"), // 'manual_edit' | 'ai_fix' | 'ai_enhance' | 'restored_from_vN' | 'branch_merge'
  branch: text("branch"), // nullable — tracks which branch this version was created on
  firstBuildId: text("first_build_id"), // nullable — first build that executed this version
  firstBuildBranch: text("first_build_branch"), // denormalized branch name from first build
  firstBuildCommit: text("first_build_commit"), // denormalized commit SHA from first build
  viewportWidth: integer("viewport_width"),
  viewportHeight: integer("viewport_height"),
  stepCriteria: jsonb("step_criteria").$type<StepCriterion[]>(),
  createdAt: timestamp("created_at"),
});

export type TestVersion = typeof testVersions.$inferSelect;

export type NewTestVersion = typeof testVersions.$inferInsert;

// Selector statistics for optimizing fallback strategy
export const selectorStats = pgTable(
  "selector_stats",
  {
    id: text("id").primaryKey(),
    testId: text("test_id").references(() => tests.id, { onDelete: "cascade" }),
    selectorArrayHash: text("selector_array_hash").notNull(),
    selectorType: text("selector_type").notNull(),
    selectorValue: text("selector_value").notNull(),
    successCount: integer("success_count").default(0),
    failureCount: integer("failure_count").default(0),
    totalAttempts: integer("total_attempts").default(0),
    avgResponseTimeMs: integer("avg_response_time_ms"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    // Conflict target for the atomic batched upsert in
    // `recordSelectorOutcomes`; leading column also covers the per-test
    // fetch in `getSelectorStatsForTest`. If `pnpm db:push` rejects this
    // index because legacy duplicate rows exist, run
    // `node scripts/dedupe-selector-stats.mjs` first.
    uniqueIndex("uniq_selector_stats_test_hash_type_value").on(
      table.testId,
      table.selectorArrayHash,
      table.selectorType,
      table.selectorValue,
    ),
  ],
);

export type SelectorStat = typeof selectorStats.$inferSelect;

export type NewSelectorStat = typeof selectorStats.$inferInsert;

// ============================================
// Test Fixtures (files used during test execution)
// ============================================

export const testFixtures = pgTable(
  "test_fixtures",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    testId: text("test_id")
      .references(() => tests.id, { onDelete: "cascade" })
      .notNull(),
    filename: text("filename").notNull(),
    storagePath: text("storage_path").notNull(), // relative path under storage/fixtures/
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_test_fixtures_test").on(table.testId),
    index("idx_test_fixtures_repo").on(table.repositoryId),
  ],
);

export type TestFixture = typeof testFixtures.$inferSelect;

export type NewTestFixture = typeof testFixtures.$inferInsert;

// Test specifications — NL intent linked 1:1 with tests
export const testSpecs = pgTable(
  "test_specs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id").references(() => repositories.id, {
      onDelete: "cascade",
    }),
    testId: text("test_id")
      .references(() => tests.id, { onDelete: "set null" })
      .unique(), // 1:1 with test when linked
    functionalAreaId: text("functional_area_id").references(
      () => functionalAreas.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    spec: text("spec").notNull(), // NL specification (markdown)
    source: text("source").notNull().default("manual"), // 'manual' | 'planner' | 'route_suggestion' | 'agent_prompt'
    sourceRef: text("source_ref"), // origin ID (e.g. routeTestSuggestion.id)
    status: text("status").notNull().default("draft"), // 'draft' | 'approved' | 'has_test' | 'outdated'
    codeHash: text("code_hash"), // SHA256 of linked test code when last synced
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_test_specs_repo").on(table.repositoryId),
    index("idx_test_specs_area").on(table.functionalAreaId),
    index("idx_test_specs_test").on(table.testId),
  ],
);

export type TestSpec = typeof testSpecs.$inferSelect;

export type NewTestSpec = typeof testSpecs.$inferInsert;

// ---------------------------------------------------------------------------
// Test-Level Multi-Target Inspector (spec 24)
// ---------------------------------------------------------------------------

export type InspectorDimension =
  | "visual"
  | "dom"
  | "text"
  | "network"
  | "variables";

export type InspectorSeverity =
  | "unchanged"
  | "minor"
  | "changed"
  | "unavailable";

export interface VisualInspectionPayload {
  classification: "unchanged" | "flaky" | "changed";
  pixelDifference: number;
  percentageDifference: number;
  baselineImagePath: string | null;
  currentImagePath: string | null;
  diffImagePath: string | null;
  engine: DiffEngineType;
  metadata?: DiffMetadata;
  error?: string;
}

export interface DomInspectionPayload {
  diff: DomDiffResult;
  baselineUrl?: string;
  currentUrl?: string;
  error?: string;
}

export interface TextDiffLine {
  op: "add" | "del" | "eq";
  line: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface TextInspectionPayload {
  lines: TextDiffLine[];
  added: number;
  removed: number;
  baselineLength: number;
  currentLength: number;
  error?: string;
}

export interface NetworkInspectionEntry {
  url: string;
  method: string;
  resourceType: string;
  baseline?: { status: number; bytes: number; durationMs: number };
  current?: { status: number; bytes: number; durationMs: number };
}

export interface NetworkInspectionSummary {
  countA: number;
  countB: number;
  bytesA: number;
  bytesB: number;
  byTypeA: Record<string, number>;
  byTypeB: Record<string, number>;
  thirdPartyDomainsA: string[];
  thirdPartyDomainsB: string[];
  failedCountA: number;
  failedCountB: number;
}

export interface NetworkInspectionPayload {
  added: NetworkInspectionEntry[];
  removed: NetworkInspectionEntry[];
  changedStatus: NetworkInspectionEntry[];
  changedSize: NetworkInspectionEntry[];
  slowdowns: NetworkInspectionEntry[];
  failedA: NetworkInspectionEntry[];
  failedB: NetworkInspectionEntry[];
  summary: NetworkInspectionSummary;
  error?: string;
}

export interface VariableMapDiffEntry {
  key: string;
  baseline: string | null;
  current: string | null;
  kind: "added" | "removed" | "changed" | "unchanged";
}

export interface VariableInspectionPayload {
  extracted: VariableMapDiffEntry[];
  assigned: VariableMapDiffEntry[];
  consoleErrors: { added: string[]; removed: string[]; common: number };
  logs: { addedCount: number; removedCount: number; sample: string[] };
  error?: string;
}

export interface InspectorClassification {
  visual: InspectorSeverity;
  dom: InspectorSeverity;
  text: InspectorSeverity;
  network: InspectorSeverity;
  variables: InspectorSeverity;
}

export interface InspectorOptions {
  ignoreUrlParams?: string[];
  ignoreHosts?: string[];
  ignoreVariableKeys?: string[];
  textIgnorePatterns?: string[];
}

export interface InspectionResult {
  cacheKey: string;
  computedAtMs: number;
  testId: string;
  currentResultId: string;
  baselineResultId: string;
  engine: DiffEngineType;
  visual?: VisualInspectionPayload;
  dom?: DomInspectionPayload;
  text?: TextInspectionPayload;
  network?: NetworkInspectionPayload;
  variables?: VariableInspectionPayload;
  classification: InspectorClassification;
}

// Cache table for the test-level inspector. Keyed by sha256 of the inputs so
// repeat opens of the same target pair are instant. Cleared on baseline
// approval and via TTL sweep.
export const inspectorCache = pgTable(
  "inspector_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    testId: text("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    currentResultId: text("current_result_id").notNull(),
    baselineResultId: text("baseline_result_id").notNull(),
    engine: text("engine").notNull(),
    payload: jsonb("payload").$type<InspectionResult>().notNull(),
    computedAt: timestamp("computed_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_inspector_cache_test").on(table.testId),
    index("idx_inspector_cache_current").on(table.currentResultId),
  ],
);

export type InspectorCacheRow = typeof inspectorCache.$inferSelect;

export type NewInspectorCacheRow = typeof inspectorCache.$inferInsert;
