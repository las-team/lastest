import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
  real,
  uniqueIndex,
  doublePrecision,
} from "drizzle-orm/pg-core";

// Type definitions for JSON columns

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

// Selector configuration for multi-input recording
export type SelectorType =
  | "data-testid"
  | "id"
  | "role-name"
  | "label"
  | "heading-context"
  | "text"
  | "aria-label"
  | "placeholder"
  | "name"
  | "alt-text"
  | "title"
  | "css-path"
  | "ocr-text"
  | "coords";

export interface SelectorConfig {
  type: SelectorType;
  enabled: boolean;
  priority: number;
}

export interface ActionSelector {
  type: SelectorType;
  value: string;
}

export interface RecordedAction {
  action: "click" | "fill" | "selectOption" | "goto";
  selectors: ActionSelector[];
  value?: string;
  timestamp: number;
}

export interface AlignmentSegment {
  op: "match" | "insert" | "delete";
  count: number;
}

export interface PageShiftInfo {
  detected: boolean;
  deltaY: number;
  confidence: number;
  insertedRows?: number;
  deletedRows?: number;
  alignedBaselineImagePath?: string;
  alignedCurrentImagePath?: string;
  alignedDiffImagePath?: string;
  alignmentSegments?: AlignmentSegment[];
}

export interface AIDiffAnalysis {
  classification: "insignificant" | "meaningful" | "noise";
  recommendation: "approve" | "review" | "flag";
  summary: string;
  confidence: number; // 0-1
  categories?: string[];
  analyzedAt: string;
}

// DOM snapshot element captured during recording or test execution
export interface DomSnapshotElement {
  tag: string;
  id?: string;
  textContent?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  selectors: Array<{ type: string; value: string }>;
}

// Full DOM snapshot with page context
export interface DomSnapshotData {
  elements: DomSnapshotElement[];
  url: string;
  timestamp: number;
}

// DOM diff result for comparing two snapshots
export interface DomDiffResult {
  added: DomSnapshotElement[];
  removed: DomSnapshotElement[];
  changed: Array<{
    baseline: DomSnapshotElement;
    current: DomSnapshotElement;
    changes: ("text" | "position" | "size" | "selector")[];
  }>;
  unchangedCount: number;
}

// ---------------------------------------------------------------------------
// Root Cause Analysis (RCA) — "is this diff the TEST or the CODE?"
// ---------------------------------------------------------------------------
//
// A per-visual-diff verdict that fuses signals already computed elsewhere
// (pixel-diff metadata, optional DOM diff, the build's Change Map) into a
// rich-taxonomy classification. Computed by `src/lib/rca/` after the build's
// Change Map is available and persisted into `DiffMetadata.rca` below. The
// `headline` drives the badge color; `signals` explain the verdict; the
// element-level `regionCauses` are populated by the (later) correlation phase.

export type RcaCategory =
  // Application changed because the code changed (real regression or an
  // intended UI change to approve).
  | "code:structural" // DOM nodes/attributes added, removed, or re-selected
  | "code:style" // CSS/visual change (color, spacing, size) tied to a code change
  | "code:content" // copy/content changed and it is NOT a dynamic-data pattern
  // Diff is noise from the test/environment, not a code change.
  | "test:flake" // non-deterministic render with no DOM/code change
  | "test:dynamic-data" // dates, counters, ids, currency — data, not code
  | "test:animation" // transient/mid-animation frame or anti-aliasing
  | "test:environment" // page shift, cross-branch baseline, locale/viewport
  // Not enough signal to commit to test-vs-code.
  | "uncertain";

export interface RcaSignal {
  category: RcaCategory;
  /** 0..1 — strength of THIS signal, not a probability across categories. */
  confidence: number;
  /** One short plain-English sentence explaining the signal. */
  reason: string;
}

/** Element-level cause for one changed pixel region (populated by the
 *  correlation phase; empty in the Phase-1 classifier-only path). */
export interface RcaRegionCause {
  region: { x: number; y: number; width: number; height: number };
  selector: string;
  changeType: (
    | "text"
    | "position"
    | "size"
    | "selector"
    | "added"
    | "removed"
  )[];
  cssDeltas?: Array<{ property: string; baseline: string; current: string }>;
}

export interface RcaVerdict {
  /** Headline bucket that drives the badge: code change, test noise, or unsure. */
  headline: "code" | "test" | "uncertain";
  /** Ranked contributing signals (strongest first). */
  signals: RcaSignal[];
  /** Build-level files that changed (from the Change Map), surfaced for `code`. */
  changedFiles: string[];
  /** Element-level region→cause mapping (correlation phase). */
  regionCauses?: RcaRegionCause[];
  /** Schema/heuristic version, so stale verdicts can be recomputed. */
  version: number;
  computedAt: string;
}

export interface DiffMetadata {
  changedRegions: { x: number; y: number; width: number; height: number }[];
  affectedComponents?: string[];
  changeCategories?: ("layout" | "color" | "text" | "image" | "style")[];
  pageShift?: PageShiftInfo;
  isNewTest?: boolean;
  textRegions?: { x: number; y: number; width: number; height: number }[];
  textRegionDiffPixels?: number;
  nonTextRegionDiffPixels?: number;
  ocrDurationMs?: number;
  domDiff?: DomDiffResult;
  textDiffSummary?: { added: number; removed: number; sameAsBaseline: boolean };
  // Branch the baseline was sourced from when it differs from the build's
  // branch. Set by `processVisualDiff` when the current-branch baseline lookup
  // misses and we fall back to the repo's default branch. UI uses this to
  // label the diff "baseline from <branch>" so users know they're not
  // comparing apples-to-apples within-branch.
  baselineSourceBranch?: string;
  // When no baseline exists on either the current branch or the default
  // branch, surface where the user DOES have an approved baseline so they
  // know it's not lost. Empty when there's no approved baseline anywhere.
  baselineExistsOn?: { branch: string; createdAt: string };
  // Root Cause Analysis verdict — "is this diff the test or the code?".
  // Computed post-build by src/lib/rca/ and read by the diff badge + Source
  // filter. Absent on diffs predating the feature (UI treats it as unknown).
  rca?: RcaVerdict;
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
// ---------------------------------------------------------------------------

export type ApiAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "custom"; headers: Record<string, string> };

export type ApiAssertionKind =
  | "status"
  | "header"
  | "jsonPath"
  | "jsonSchema"
  | "bodyContains"
  | "latencyMs";

export interface ApiAssertion {
  kind: ApiAssertionKind;
  /** status: exact status code, or `in` for a set of acceptable codes. */
  equals?: number;
  in?: number[];
  /** header: header name to assert on (case-insensitive). */
  header?: string;
  /** jsonPath: dot-path into the JSON response body. */
  path?: string;
  /** Expected value (jsonPath / header) or substring (bodyContains). */
  value?: string | number | boolean;
  /** jsonSchema: a JSON Schema object validated with ajv. */
  schema?: unknown;
  /** latencyMs: max acceptable round-trip latency. */
  maxMs?: number;
  /** header/jsonPath: require an exact same-type match (no string coercion).
   *  Default comparison is type-aware, keyed off the expected value's type. */
  strict?: boolean;
  description?: string;
}

export interface ApiTestDefinition {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  auth?: ApiAuth;
  assertions: ApiAssertion[];
  /** Optional per-request timeout (ms). Falls back to DEFAULT_API_TEST_SETTINGS. */
  timeoutMs?: number;
}

export interface ApiAssertionResultData {
  kind: ApiAssertionKind;
  passed: boolean;
  description: string;
  expected?: unknown;
  actual?: unknown;
}

/** Persisted result of a headless API test (stored on test_results.apiResult). */
export interface ApiTestResultData {
  passed: boolean;
  statusCode: number | null;
  latencyMs: number;
  assertionResults: ApiAssertionResultData[];
  error?: string;
  responseSnippet?: string;
}

// ---------------------------------------------------------------------------
// Load / performance testing on API tests (E3). Stored on tests.loadConfig and
// test_results.loadResult; latency/error breaches surface on the `perf` layer.
// ---------------------------------------------------------------------------

export interface LoadTestThresholds {
  p95Ms?: number;
  p99Ms?: number;
  /** Fraction 0..1 of requests allowed to fail before gating. */
  maxErrorRate?: number;
  minThroughputRps?: number;
}

export interface LoadTestConfig {
  concurrency: number;
  /** Total requests to issue. Takes precedence over durationMs when both set. */
  totalRequests?: number;
  /** When set (and totalRequests is not), keep firing until this wall-clock
   *  budget elapses, capped by LOAD_TEST_MAX_DURATION_MS / total requests. */
  durationMs?: number;
  thresholds?: LoadTestThresholds;
}

export interface LoadTestResultData {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
  throughputRps: number;
  errorRate: number;
  passed: boolean;
  breaches: string[];
}

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
  // E3: when set on an api-type test, runs as a load test (N concurrent requests).
  loadConfig: jsonb("load_config").$type<LoadTestConfig>(),
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
}

// Accessibility violation from axe-core.
// `nodes` is a count (preserved for back-compat with the wcag-score severity ×
// min(nodes, 3) formula). `sampleNodes` carries up to a handful of the actual
// offending nodes from axe so the build/test drill-in UI can surface a real
// selector + failureSummary alongside each rule — the previous shape stored
// only the count and lost the per-node context.
export interface A11yViolationSampleNode {
  target: string[];
  failureSummary?: string;
  html?: string;
}
export interface A11yViolation {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  help: string;
  helpUrl: string;
  nodes: number;
  tags?: string[];
  wcagLevel?: "A" | "AA" | "AAA";
  sampleNodes?: A11yViolationSampleNode[];
}

// ── Design System tokens / violations ────────────────────────────────────
// A test/repo can declare a "design system" — a closed set of allowed
// values for color, border-radius, font-family, font-size, and spacing
// (margin/padding). During each test the EB walks the live DOM at
// screenshot time, samples computed styles per visible element, and the
// host marks any computed value not present in the allowed set as a
// violation. Same flow as a11y: per-test_result violations roll up into a
// build-level design_system_score (0-100), drill-in shows occurrence count
// and a sample selector for each off-token value.
export type DesignTokenCategory =
  | "color" // any color computed property (color, background-color, border-color, fill, stroke)
  | "border-radius" // border-*-radius
  | "font-family" // font-family (first family in stack)
  | "font-size" // font-size (px)
  | "spacing"; // margin-*, padding-*, gap (px)

export interface DesignSystemConfig {
  /** When false, the layer is opt-out for this test even if the repo
   *  toggle is on. Repo-level config has no `enabled` (the toggle on
   *  playwright_settings.enableDesignSystem governs that). */
  enabled?: boolean;
  /** Allowed CSS values per category. Values are stored normalized
   *  (lowercase hex, px ints). Token NAMES (`--c-red`) can be supplied as
   *  keys so the violation card surfaces a friendly label, but the raw
   *  resolved value is what the comparator matches against. */
  tokens: Partial<Record<DesignTokenCategory, DesignToken[]>>;
  /** Hide a class of violations entirely. Useful when a repo controls
   *  color tokens centrally but vendor 3rd-parties bring their own. */
  ignoredCategories?: DesignTokenCategory[];
  /** Per-screenshot cap on collected violations. Defaults to 200 to keep
   *  test_results.design_system_violations sane in JSONB. */
  maxViolationsPerScreenshot?: number;
  /** Display-only grouping the parser builds when ingesting a CSS file.
   *  The matcher in the EB never reads this — it exists solely to render
   *  the Claude-Design-style preview card on the Setup tab. */
  groups?: DesignSystemGroups;
  /** Bundle metadata captured at upload time. Used by the preview to
   *  show the bundle title, source files, and asset filenames. */
  meta?: DesignSystemMeta;
}

export interface DesignToken {
  /** Display name — typically the CSS custom property (`--c-red`) or a
   *  human label ("Brand Red"). Used in violation messages. */
  name: string;
  /** Resolved value — normalized: hex for colors ("#e03e36"), int+"px"
   *  for radii/sizes/spacing, lowercase family name for font. */
  value: string;
}

/** A token with a display role and the value it resolves to (after
 *  `var()` chasing). Used in the Setup preview to show "BRAND · Red ·
 *  #E03E36" tiles instead of just raw token names. */
export interface DesignRoleToken {
  /** Token name in CSS (`--c-red`). */
  name: string;
  /** Resolved literal value (hex / px / family). */
  value: string;
  /** Optional uppercase eyebrow label ("BRAND", "ACTION", "ACCENT") that
   *  the preview puts on the tile. Inferred from the token name by the
   *  parser. */
  role?: string;
  /** Optional human label ("Red", "Steel Blue") for the tile. Defaults
   *  to a Title-Cased version of the name suffix. */
  label?: string;
}

export interface DesignSystemGroups {
  brandPalette?: DesignRoleToken[];
  surfaces?: DesignRoleToken[];
  inkScale?: DesignRoleToken[];
  semantic?: DesignRoleToken[];
  radii?: DesignRoleToken[];
  spacing?: DesignRoleToken[];
  typeScale?: DesignRoleToken[];
  fonts?: DesignRoleToken[];
}

export interface DesignSystemMeta {
  /** Title pulled from the bundle README (first H1). */
  title?: string;
  /** First paragraph after the H1 in the README. */
  description?: string;
  /** All file paths the upload action ingested (CSS + README + assets). */
  files?: string[];
  /** Asset filenames (svg / png / woff / woff2) found in the archive.
   *  Used by the preview's "Missing brand fonts" detection. */
  assets?: string[];
  /** When set, the bundle carried `.woff` / `.woff2` files — no font
   *  warning needed. */
  hasFontFiles?: boolean;
}

export interface DesignSystemViolation {
  /** Stable id used for rule grouping in the violations card.
   *  Format: `${category}:${normalizedValue}` so the same rogue value
   *  on N elements collapses into one row. */
  id: string;
  category: DesignTokenCategory;
  /** CSS property the value was sampled from (e.g. "background-color",
   *  "border-radius", "padding-left"). */
  property: string;
  /** Normalized off-token value the comparator saw on the page. */
  actual: string;
  /** Nearest allowed value, when the comparator can suggest one.
   *  For colors this is the closest token in ΔE; for sizes/spacing the
   *  closest absolute value. */
  expected?: string;
  /** Display label for `expected` (the token name). */
  expectedName?: string;
  /** "critical" used by the score formula for color/font-family (brand
   *  identity); "moderate" for radii; "minor" for spacing. */
  impact: "critical" | "serious" | "moderate" | "minor";
  /** Count of DOM nodes that hit this rule on this screenshot. */
  nodes: number;
  /** Up to N sample selectors + the offending element snippets. */
  sampleNodes?: A11yViolationSampleNode[];
}

export interface DesignSystemScoreSummary {
  score: number;
  totalRules: number;
  passedRules: number;
  violatedRules: number;
  bySeverity: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
}

/** Per-category, per-value usage counter — `usage.color['#e03e36'] = 12`
 *  means twelve elements rendered with that color across the captured DOM.
 *  Used by the verify Design review panel to light up tokens that were
 *  actually used and dim tokens the page never rendered. */
export type DesignSystemTokenUsage = Partial<
  Record<DesignTokenCategory, Record<string, number>>
>;

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

export interface AssertionResult {
  assertionId: string;
  status: "passed" | "failed" | "skipped";
  actualValue?: string;
  errorMessage?: string;
  durationMs?: number;
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

export interface WcagScoreSummary {
  score: number;
  totalRules: number;
  passedRules: number;
  violatedRules: number;
  bySeverity: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
}

// ── Multi-layer comparison types (v1.13) ─────────────────────────────────────

/** Per-step URL trajectory entry. Captured by the EB executor at each
 *  __stepReached boundary so we can detect routing/auth divergence between
 *  baseline and feature runs (the classic "session expired → /login" case). */
export interface UrlTrajectoryStep {
  stepIndex: number;
  stepLabel?: string;
  finalUrl: string;
  /** Each redirect target in order. Empty for non-navigating steps. */
  redirectChain: string[];
  /** Wall-clock ms from test start when this step's URL was sampled. */
  capturedAtMs?: number;
}

/** Web Vitals captured per page-state. Sampled at screenshot points and at
 *  end-of-test. Values mirror the standard web-vitals library names. */
export interface WebVitalsSample {
  stepIndex?: number;
  stepLabel?: string;
  url: string;
  /** Largest Contentful Paint (ms) */
  lcp?: number;
  /** Cumulative Layout Shift (unitless score) */
  cls?: number;
  /** Interaction to Next Paint (ms) */
  inp?: number;
  /** First Contentful Paint (ms) */
  fcp?: number;
  /** Total Blocking Time (ms) */
  tbt?: number;
  /** Time to First Byte (ms) */
  ttfb?: number;
}

/** Storage state snapshot — minimal cookie + localStorage capture for diff.
 *  Mirrors a subset of Playwright's storageState() output. Token-shaped
 *  values are redacted at capture time; we keep presence + a hash for diff. */
export interface StorageStateSnapshot {
  cookies: Array<{
    name: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: "Strict" | "Lax" | "None";
    /** SHA-256 hash of the value (truncated to 16 hex chars). Never the raw value. */
    valueHash?: string;
    /** True if this cookie name matched a token denylist (token/sid/csrf/etc.) */
    redacted?: boolean;
  }>;
  localStorage: Array<{
    origin: string;
    name: string;
    /** Either a parsed JSON value (for diff-engine consumption) or a hash for opaque values. */
    value?: unknown;
    valueHash?: string;
    redacted?: boolean;
  }>;
}

export const testResults = pgTable("test_results", {
  id: text("id").primaryKey(),
  testRunId: text("test_run_id").references(() => testRuns.id),
  testId: text("test_id").references(() => tests.id),
  testVersionId: text("test_version_id"), // links to testVersions.id — which version was executed
  status: text("status"), // 'passed', 'failed', 'skipped'
  // E1: result of a headless API test (null for browser tests).
  apiResult: jsonb("api_result").$type<ApiTestResultData>(),
  // E3: load-test aggregate result (null unless the test ran as a load test).
  loadResult: jsonb("load_result").$type<LoadTestResultData>(),
  screenshotPath: text("screenshot_path"),
  screenshots: jsonb("screenshots").$type<CapturedScreenshot[]>(),
  diffPath: text("diff_path"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  viewport: text("viewport"), // e.g., '1920x1080'
  browser: text("browser").default("chromium"),
  consoleErrors: jsonb("console_errors").$type<string[]>(),
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
});

// Repository provider type
export type RepositoryProvider = "github" | "gitlab" | "local";

// Repositories synced from GitHub or GitLab, or created locally
export const repositories = pgTable("repositories", {
  id: text("id").primaryKey(),
  teamId: text("team_id"), // Team ownership - FK added after teams table definition
  provider: text("provider").notNull().default("github"), // 'github' | 'gitlab' | 'local'
  githubRepoId: integer("github_repo_id"), // nullable for GitLab repos
  gitlabProjectId: integer("gitlab_project_id"), // nullable for GitHub repos
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(), // owner/name or namespace/project
  defaultBranch: text("default_branch"),
  /** @deprecated Always vs_both now — kept for backward compat */
  defaultComparisonMode: text("default_comparison_mode").default("vs_both"), // ComparisonMode
  selectedBaseline: text("selected_baseline"), // branch name for baseline comparison
  selectedBranch: text("selected_branch"), // branch for remote scanning via API
  // Default setup configuration applied to all tests in this repo
  defaultSetupTestId: text("default_setup_test_id"), // Default test-as-setup for all tests
  defaultSetupScriptId: text("default_setup_script_id"), // OR default script
  testingTemplate: text("testing_template"), // Testing template ID (e.g. 'saas', 'marketing', 'canvas')
  autoApproveDefaultBranch: boolean("auto_approve_default_branch").default(
    false,
  ),
  branchBaseUrls: jsonb("branch_base_urls").$type<Record<string, string>>(),
  comparisonRunEnabled: boolean("comparison_run_enabled").default(false),
  comparisonBaselineBranch: text("comparison_baseline_branch"), // branch used as baseline in comparison runs
  createdAt: timestamp("created_at"),
});

// GitHub OAuth accounts - per-team GitHub connection
export const githubAccounts = pgTable("github_accounts", {
  id: text("id").primaryKey(),
  teamId: text("team_id"), // Team ownership - FK added after teams table definition
  githubUserId: text("github_user_id").notNull(),
  githubUsername: text("github_username").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  selectedRepositoryId: text("selected_repository_id").references(
    () => repositories.id,
  ),
  reposSyncedAt: timestamp("repos_synced_at"),
  createdAt: timestamp("created_at"),
});

// GitLab OAuth / PAT accounts - per-team GitLab connection
export const gitlabAccounts = pgTable("gitlab_accounts", {
  id: text("id").primaryKey(),
  teamId: text("team_id"), // Team ownership - FK added after teams table definition
  gitlabUserId: text("gitlab_user_id").notNull(),
  gitlabUsername: text("gitlab_username").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  instanceUrl: text("instance_url").default("https://gitlab.com"), // For self-hosted GitLab
  // 'oauth' (default — uses env or per-account oauth client) | 'pat' (personal access token)
  authMethod: text("auth_method").notNull().default("oauth"),
  // Per-account OAuth client (for self-hosted instances where the global env vars don't apply)
  oauthClientId: text("oauth_client_id"),
  oauthClientSecret: text("oauth_client_secret"),
  selectedRepositoryId: text("selected_repository_id").references(
    () => repositories.id,
  ),
  reposSyncedAt: timestamp("repos_synced_at"),
  createdAt: timestamp("created_at"),
});

// Pull requests / Merge requests linked to builds
export const pullRequests = pgTable("pull_requests", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("github"), // 'github' | 'gitlab'
  githubPrNumber: integer("github_pr_number"), // nullable for GitLab MRs
  gitlabMrIid: integer("gitlab_mr_iid"), // GitLab MR internal ID (nullable for GitHub PRs)
  gitlabProjectId: integer("gitlab_project_id"), // GitLab project ID (nullable for GitHub PRs)
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  headBranch: text("head_branch").notNull(),
  baseBranch: text("base_branch").notNull(),
  headCommit: text("head_commit").notNull(),
  title: text("title"),
  status: text("status"), // 'open', 'closed', 'merged'
  author: text("author"), // GitHub username of PR author
  mergedAt: timestamp("merged_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

/** @deprecated Always vs_both now — kept for backward compat */
export type ComparisonMode =
  | "vs_main"
  | "vs_branch"
  | "vs_both"
  | "vs_previous"
  | "vs_planned";

// Builds - aggregated test run with status
export const builds = pgTable("builds", {
  id: text("id").primaryKey(),
  testRunId: text("test_run_id").references(() => testRuns.id),
  pullRequestId: text("pull_request_id").references(() => pullRequests.id),
  triggerType: text("trigger_type").notNull(), // 'webhook', 'manual', 'push'
  overallStatus: text("overall_status").notNull(), // 'safe_to_merge', 'review_required', 'blocked'
  totalTests: integer("total_tests").default(0),
  changesDetected: integer("changes_detected").default(0),
  flakyCount: integer("flaky_count").default(0),
  failedCount: integer("failed_count").default(0),
  passedCount: integer("passed_count").default(0),
  baseUrl: text("base_url"),
  elapsedMs: integer("elapsed_ms"),
  /** @deprecated Always vs_both now — kept for backward compat */
  comparisonMode: text("comparison_mode").default("vs_main"), // ComparisonMode
  // Build-level setup configuration
  buildSetupTestId: text("build_setup_test_id"), // Use test as build-level setup
  buildSetupScriptId: text("build_setup_script_id"), // OR use dedicated script
  setupStatus: text("setup_status").default("pending"), // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  setupError: text("setup_error"),
  setupDurationMs: integer("setup_duration_ms"),
  teardownStatus: text("teardown_status").default("pending"), // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  teardownError: text("teardown_error"),
  teardownDurationMs: integer("teardown_duration_ms"),
  codeChangeTestIds: jsonb("code_change_test_ids").$type<string[]>(),
  browsers: jsonb("browsers").$type<string[]>(), // browsers used in this build
  scheduleId: text("schedule_id"),
  a11yScore: integer("a11y_score"),
  a11yViolationCount: integer("a11y_violation_count"),
  a11yCriticalCount: integer("a11y_critical_count"),
  a11yTotalRulesChecked: integer("a11y_total_rules_checked"),
  designSystemScore: integer("design_system_score"),
  designSystemViolationCount: integer("design_system_violation_count"),
  designSystemCriticalCount: integer("design_system_critical_count"),
  designSystemTotalRulesChecked: integer("design_system_total_rules_checked"),
  // Build-level merge of test_results.designSystemTokenUsage. Sums each
  // (category, value) usage across every test in the run so the review
  // panel reads a single object instead of folding it client-side.
  designSystemTokenUsage: jsonb(
    "design_system_token_usage",
  ).$type<DesignSystemTokenUsage>(),
  comparisonPairId: text("comparison_pair_id"), // shared ID linking baseline + feature builds
  comparisonRole: text("comparison_role"), // 'baseline' | 'feature' | null
  comparisonMeta: jsonb("comparison_meta").$type<{
    featureBranch: string;
    featureUrl: string;
    runnerId?: string;
    testIds?: string[];
    versionOverrides?: Record<string, string>;
  }>(),
  // Verify phase (v1.14+): areas the user explicitly flagged as in-scope
  // before kicking off the build. Promotes those areas in the change-map.
  manuallyScopedAreaIds: jsonb("manually_scoped_area_ids").$type<string[]>(),
  createdAt: timestamp("created_at"),
  completedAt: timestamp("completed_at"),
  // Captured when runBuildAsync's outer try/catch fires AND no per-test
  // results landed — surfaces executor-level failures (B6) instead of
  // silently coercing to 'blocked'.
  executorError: text("executor_error"),
  executorFailedAt: timestamp("executor_failed_at"),
});

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
  createdAt: timestamp("created_at"),
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

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
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
export type GithubAccount = typeof githubAccounts.$inferSelect;
export type NewGithubAccount = typeof githubAccounts.$inferInsert;
export type GitlabAccount = typeof gitlabAccounts.$inferSelect;
export type NewGitlabAccount = typeof gitlabAccounts.$inferInsert;
export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;
export type Build = typeof builds.$inferSelect;
export type NewBuild = typeof builds.$inferInsert;
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

// Headless mode options: 'true' (standard headless), 'false' (headed), 'shell' (new headless mode with better bot detection avoidance)
export type HeadlessMode = "true" | "false" | "shell";

// Stabilization settings for flaky test prevention
export interface StabilizationSettings {
  // Wait strategies
  waitForNetworkIdle: boolean; // Wait for no network activity (default: true)
  networkIdleTimeout: number; // Max wait time in ms (default: 5000)
  waitForDomStable: boolean; // Wait for DOM mutations to stop (default: true)
  domStableTimeout: number; // Max wait time in ms (default: 2000)

  // Content freezing
  freezeTimestamps: boolean; // Replace Date.now(), new Date() (default: true)
  frozenTimestamp: string; // ISO timestamp to use (default: "2024-01-01T12:00:00Z")
  freezeRandomValues: boolean; // Seed Math.random() (default: true)
  randomSeed: number; // Seed value (default: 12345)

  // Third-party handling
  blockThirdParty: boolean; // Block external domains (default: false)
  allowedDomains: string[]; // Whitelist (default: [])
  mockThirdPartyImages: boolean; // Replace with placeholders (default: true)

  // Spinner/loader handling
  hideLoadingIndicators: boolean; // CSS hide common spinners (default: true)
  loadingSelectors: string[]; // Custom selectors to wait for removal

  // Image loading
  waitForImages: boolean; // Wait for all images to finish loading (default: true)
  waitForImagesTimeout: number; // Max wait time in ms (default: 5000)

  // Style stabilization
  waitForFonts: boolean; // Wait for font loading (default: true)
  disableWebfonts: boolean; // Use system fonts only (default: false)
  crossOsConsistency: boolean; // Bundled font + Chromium flags for identical screenshots across OS (default: false)

  // Burst capture (multi-frame instability detection)
  burstCapture: boolean; // Take N screenshots and compare for stability (default: false)
  burstFrameCount: number; // Number of frames to capture (default: 3)
  burstStabilityThreshold: number; // % diff below which frames are considered stable (default: 0.5)

  // Dynamic content masking
  autoMaskDynamicContent: boolean; // Detect and mask dynamic text before screenshot (default: false)
  maskPatterns: string[]; // Pattern types to mask (default: ['timestamps', 'uuids', 'relative-times'])
  maskStyle: "solid-color" | "placeholder-text"; // How to mask matched content (default: 'solid-color')
  maskColor: string; // Color for solid-color mask (default: '#808080')

  // Canvas stabilization
  waitForCanvasStable: boolean; // Loop canvas.toDataURL() comparisons until stable (default: false)
  canvasStableTimeout: number; // Max wait time in ms (default: 3000)
  canvasStableThreshold: number; // Consecutive stable checks needed (default: 3)

  // Canvas rendering
  disableImageSmoothing: boolean; // Set imageSmoothingEnabled = false on 2D contexts (default: false)
  roundCanvasCoordinates: boolean; // Snap stroke coords to pixel centers for deterministic lines (default: false)
  reseedRandomOnInput: boolean; // Reseed LCG from event hash on user input (default: false)
  freezeAnimations: boolean; // Freeze CSS animations/transitions (default: false)
}

// Default stabilization settings
export const DEFAULT_STABILIZATION_SETTINGS: StabilizationSettings = {
  waitForNetworkIdle: true,
  networkIdleTimeout: 2000,
  waitForDomStable: true,
  domStableTimeout: 500,
  freezeTimestamps: true,
  frozenTimestamp: "2024-01-01T12:00:00Z",
  freezeRandomValues: true,
  randomSeed: 12345,
  blockThirdParty: false,
  allowedDomains: [],
  mockThirdPartyImages: true,
  hideLoadingIndicators: true,
  loadingSelectors: [],
  waitForImages: true,
  waitForImagesTimeout: 2000,
  waitForFonts: true,
  disableWebfonts: false,
  crossOsConsistency: false,
  burstCapture: false,
  burstFrameCount: 3,
  burstStabilityThreshold: 0.5,
  autoMaskDynamicContent: false,
  maskPatterns: ["timestamps", "uuids", "relative-times"],
  maskStyle: "solid-color",
  maskColor: "#808080",
  waitForCanvasStable: false,
  canvasStableTimeout: 3000,
  canvasStableThreshold: 3,
  disableImageSmoothing: false,
  roundCanvasCoordinates: false,
  reseedRandomOnInput: false,
  freezeAnimations: false,
};

// Stability metadata from burst capture
export interface StabilityMetadata {
  frameCount: number;
  stableFrames: number;
  maxFrameDiff: number;
  isStable: boolean;
}

// Recording engine options
export type RecordingEngine = "lastest" | "playwright-inspector";
export const DEFAULT_RECORDING_ENGINES: RecordingEngine[] = [
  "lastest",
  "playwright-inspector",
];

// Hostname substrings whose console errors the EB executor drops BEFORE applying
// `consoleErrorMode`. Mirrors the post-hoc third-party classifier in
// src/lib/comparison/console-diff.ts:28 — moved upstream so noisy 3rd-party SDKs
// don't red customer-app demo runs by default. Per-repo override via
// playwright_settings.consoleErrorIgnoreHosts.
export const DEFAULT_CONSOLE_ERROR_IGNORE_HOSTS: string[] = [
  "googletagmanager.com",
  "google-analytics.com",
  "doubleclick.net",
  "facebook.net",
  "fbcdn.net",
  "connect.facebook.net",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "hotjar.com",
  "fullstory.com",
  "logrocket.com",
  "intercom.io",
  "intercomcdn.com",
  "stripe.com",
  "stripe.network",
  "sentry-cdn.com",
  "browser.sentry-cdn.com",
  "sentry.io",
  "cdnjs.cloudflare.com",
  // Cloudflare email-decode script noise — see feedback_lastest_executor_console_error_fail
  "email-decode.min.js",
];

// Playwright settings for recording and running tests
export const playwrightSettings = pgTable("playwright_settings", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  selectorPriority: jsonb("selector_priority").$type<SelectorConfig[]>(),
  // App-specific test-id attribute (e.g. 'data-automation-id'). When set,
  // the recorder, fallback locator, and AI test-gen prompt will prefer this
  // attribute over `data-testid`. Only takes effect if the user adds the
  // 'custom-attr' entry to selectorPriority with a chosen rank.
  customAttributeName: text("custom_attribute_name"),
  browser: text("browser").default("chromium"), // chromium | firefox | webkit
  viewportWidth: integer("viewport_width").default(1280),
  viewportHeight: integer("viewport_height").default(720),
  lockViewportToRecording: boolean("lock_viewport_to_recording").default(false),
  headlessMode: text("headless_mode").default("true"), // 'true' | 'false' | 'shell'
  navigationTimeout: integer("navigation_timeout").default(30000),
  actionTimeout: integer("action_timeout").default(5000),
  // Per-candidate waitFor budget for locateWithFallback. The 4 runner sites
  // also adaptively shorten this when selector_stats indicate a known-slow
  // selector (see `selectorTimeoutFor` in @lastest/shared/selector-stats).
  selectorTimeoutMs: integer("selector_timeout_ms").default(3000),
  pointerGestures: boolean("pointer_gestures").default(false),
  cursorFPS: integer("cursor_fps").default(30),
  cursorPlaybackSpeed: integer("cursor_playback_speed").default(1), // 1 = realtime, 0 = instant (skip delays)
  enabledRecordingEngines: jsonb("enabled_recording_engines").$type<
    RecordingEngine[]
  >(),
  defaultRecordingEngine: text("default_recording_engine").default("lastest"),
  freezeAnimations: boolean("freeze_animations").default(false), // freeze CSS animations/transitions
  enableVideoRecording: boolean("enable_video_recording").default(false), // record test runs as WebM video
  screenshotDelay: integer("screenshot_delay").default(0), // ms delay before screenshot
  maxParallelTests: integer("max_parallel_tests").default(2), // max tests to run in parallel locally
  // On-demand Kubernetes EB pool (see src/lib/eb/provisioner.ts):
  //   maxParallelEBs: per-build cap on concurrent EB claims (1 test per EB).
  //   ebPoolMax:      hard cap on concurrent system EBs across the cluster.
  //   ebIdleTTLSeconds: idle timeout before a released EB Job is torn down.
  maxParallelEBs: integer("max_parallel_ebs").default(30),
  ebPoolMax: integer("eb_pool_max").default(50),
  ebIdleTTLSeconds: integer("eb_idle_ttl_seconds").default(120),
  stabilization: jsonb("stabilization").$type<StabilizationSettings>(), // snapshot stabilization settings
  acceptAnyCertificate: boolean("accept_any_certificate").default(false), // ignore HTTPS/SSL cert errors
  networkErrorMode: text("network_error_mode").default("fail"), // 'fail' | 'warn' | 'ignore'
  ignoreExternalNetworkErrors: boolean(
    "ignore_external_network_errors",
  ).default(true), // skip errors from different origins
  consoleErrorMode: text("console_error_mode").default("fail"), // 'fail' | 'warn' | 'ignore'
  // Hostname substrings whose console errors are dropped BEFORE consoleErrorMode is
  // evaluated. Seed with DEFAULT_CONSOLE_ERROR_IGNORE_HOSTS so the recurring
  // Cloudflare email-decoder noise doesn't red customer-app demos by default. The
  // "any in-scope console error = fail" rule is preserved: only these documented
  // 3rd-party hostnames are filtered.
  consoleErrorIgnoreHosts: jsonb("console_error_ignore_hosts").$type<
    string[]
  >(),
  // Override Chromium's default User-Agent on every newContext(). Set to a modern
  // stable Chrome string to bypass HeadlessChrome-based bot detection (Cloudflare
  // Turnstile, Clerk, several SaaS edge routers). Null preserves stock Playwright UA.
  userAgentOverride: text("user_agent_override"),
  grantClipboardAccess: boolean("grant_clipboard_access").default(false), // grant clipboard-read/write permissions
  acceptDownloads: boolean("accept_downloads").default(false), // accept file downloads in tests
  enableNetworkInterception: boolean("enable_network_interception").default(
    false,
  ), // enable page.route() network mocking
  enableDomDiff: boolean("enable_dom_diff").default(false), // capture DOM snapshots and overlay element changes on screenshots
  browsers: jsonb("browsers").$type<string[]>().default(["chromium"]), // browsers to use for build execution
  autoRetryCount: integer("auto_retry_count").default(0), // 0-3: how many times to retry a failing test to detect flakiness
  enableA11y: boolean("enable_a11y").default(false), // enable WCAG accessibility checks with axe-core
  enableDesignSystem: boolean("enable_design_system").default(false), // enable design-token compliance checks (colors / radii / font-family)
  // Repo-level allowed-tokens set. Tests can override per-test via
  // tests.designSystemOverrides. Empty / null disables the layer even when
  // the enableDesignSystem toggle is on.
  designSystem: jsonb("design_system").$type<DesignSystemConfig>(),
  // Per-check 3-way mode columns driving the Verify cogwheel modal. Each is
  // 'enforce' | 'log' | 'disable'. Source of truth — the legacy enable*/
  // *ErrorMode columns above are mirrored on write for back-compat with
  // executor/runner code paths that still read them. See
  // src/lib/verify/check-modes.ts for the derivation helpers.
  visualMode: text("visual_mode"), // pixel screenshot comparison
  textMode: text("text_mode"), // innerText capture + diff (legacy textDiffEnabled on diff_sensitivity_settings)
  domMode: text("dom_mode"), // DOM snapshot capture (legacy enableDomDiff)
  networkMode: text("network_mode"), // network capture + 4xx/5xx gate (legacy enableNetworkInterception + networkErrorMode)
  consoleMode: text("console_mode"), // console error gate (legacy consoleErrorMode)
  a11yMode: text("a11y_mode"), // axe-core (legacy enableA11y)
  designMode: text("design_mode"), // token compliance (legacy enableDesignSystem)
  perfMode: text("perf_mode"), // web vitals capture
  urlMode: text("url_mode"), // URL trajectory comparison
  apiMode: text("api_mode"), // API-test request/response assertions (E1)
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type PlaywrightSettings = typeof playwrightSettings.$inferSelect;
export type NewPlaywrightSettings = typeof playwrightSettings.$inferInsert;

// Default selector priority - can be used in both server and client components
export const DEFAULT_SELECTOR_PRIORITY: SelectorConfig[] = [
  { type: "data-testid", enabled: true, priority: 1 },
  { type: "id", enabled: true, priority: 2 },
  { type: "role-name", enabled: true, priority: 3 },
  { type: "label", enabled: true, priority: 4 },
  { type: "heading-context", enabled: true, priority: 5 },
  { type: "aria-label", enabled: true, priority: 6 },
  { type: "text", enabled: true, priority: 7 },
  { type: "placeholder", enabled: true, priority: 8 },
  { type: "name", enabled: true, priority: 9 },
  { type: "alt-text", enabled: true, priority: 10 },
  { type: "title", enabled: true, priority: 11 },
  { type: "css-path", enabled: true, priority: 12 },
  { type: "ocr-text", enabled: false, priority: 13 },
  { type: "coords", enabled: true, priority: 14 },
];

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

// Environment configuration for managed server startup
export type EnvironmentMode = "manual" | "managed";

export const environmentConfigs = pgTable("environment_configs", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  mode: text("mode").notNull().default("manual"), // 'manual' | 'managed'
  baseUrl: text("base_url").notNull().default("http://localhost:3000"),
  startCommand: text("start_command"), // e.g., 'pnpm dev'
  healthCheckUrl: text("health_check_url"), // defaults to baseUrl if not set
  healthCheckTimeout: integer("health_check_timeout").default(60000), // ms
  reuseExistingServer: boolean("reuse_existing_server").default(true),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type EnvironmentConfig = typeof environmentConfigs.$inferSelect;
export type NewEnvironmentConfig = typeof environmentConfigs.$inferInsert;

// Diff engine types
export type DiffEngineType = "pixelmatch" | "ssim" | "butteraugli";

// Text detection granularity for text-region-aware diffing
export type TextDetectionGranularity = "word" | "line" | "block";
export type RegionDetectionMode = "grid" | "flood-fill";

// Diff sensitivity settings for classification thresholds
export const diffSensitivitySettings = pgTable("diff_sensitivity_settings", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  unchangedThreshold: real("unchanged_threshold").default(1), // percentage
  flakyThreshold: real("flaky_threshold").default(10), // percentage
  includeAntiAliasing: boolean("include_anti_aliasing").default(false), // include AA pixels in diff
  ignorePageShift: boolean("ignore_page_shift").default(false), // exclude vertical content shifts from diff
  diffEngine: text("diff_engine").default("pixelmatch"), // 'pixelmatch' | 'ssim' | 'butteraugli'
  textRegionAwareDiffing: boolean("text_region_aware_diffing").default(false), // opt-in OCR-based text region diffing
  textRegionThreshold: integer("text_region_threshold").default(30), // percentage, stored as 30 = 0.3
  textRegionPadding: integer("text_region_padding").default(4), // pixels to expand text bounding boxes
  textDetectionGranularity: text("text_detection_granularity").default("word"), // 'word' | 'line' | 'block'
  regionDetectionMode: text("region_detection_mode").default("flood-fill"), // 'grid' | 'flood-fill'
  textDiffEnabled: boolean("text_diff_enabled").default(false), // capture page innerText alongside each screenshot and diff it
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type DiffSensitivitySettings =
  typeof diffSensitivitySettings.$inferSelect;
export type NewDiffSensitivitySettings =
  typeof diffSensitivitySettings.$inferInsert;

// Default diff sensitivity thresholds
export const DEFAULT_DIFF_THRESHOLDS = {
  unchangedThreshold: 1,
  flakyThreshold: 10,
  includeAntiAliasing: false,
  ignorePageShift: false,
  diffEngine: "pixelmatch" as DiffEngineType,
  textRegionAwareDiffing: false,
  textRegionThreshold: 30,
  textRegionPadding: 4,
  textDetectionGranularity: "word" as TextDetectionGranularity,
  regionDetectionMode: "flood-fill" as RegionDetectionMode,
  textDiffEnabled: false,
};

// Default settings for API tests (E1). Used when a field is unset on the
// ApiTestDefinition.
export const DEFAULT_API_TEST_SETTINGS = {
  timeoutMs: 15000,
};

// Default load-test thresholds (E3) + server-side safety caps.
export const DEFAULT_LOAD_TEST_THRESHOLDS = {
  p95Ms: 1000,
  maxErrorRate: 0.01,
};
export const LOAD_TEST_MAX_CONCURRENCY = 50;
export const LOAD_TEST_MAX_TOTAL_REQUESTS = 2000;
export const LOAD_TEST_MAX_DURATION_MS = 60_000;

// Diff classification type
export type DiffClassification = "unchanged" | "flaky" | "changed";

// Build status enum.
// 'executor_failed' = build orchestration crashed before per-test results could
// be written (e.g. EB pod schedule failure, runner unreachable). Distinguished
// from 'blocked' so the UI / MCP surface can differentiate "review needed" from
// "infrastructure broke". See `runBuildAsync` catch block.
export type BuildStatus =
  | "safe_to_merge"
  | "review_required"
  | "blocked"
  | "has_todos"
  | "executor_failed";
export type DiffStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "auto_approved"
  | "todo";
export type TriggerType =
  | "webhook"
  | "manual"
  | "push"
  | "scheduled"
  | "validate_diff";

// AI Provider settings for test generation
export type AIProvider =
  | "claude-cli"
  | "openrouter"
  | "claude-agent-sdk"
  | "ollama"
  | "openai"
  | "anthropic";
export type AgentSdkPermissionMode = "plan" | "default" | "acceptEdits";

export const aiSettings = pgTable("ai_settings", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  provider: text("provider").notNull().default("claude-cli"), // 'claude-cli' | 'openrouter' | 'claude-agent-sdk'
  openrouterApiKey: text("openrouter_api_key"),
  openrouterModel: text("openrouter_model").default(
    "anthropic/claude-sonnet-4",
  ),
  agentSdkPermissionMode: text("agent_sdk_permission_mode").default("plan"), // 'plan' | 'default' | 'acceptEdits'
  agentSdkModel: text("agent_sdk_model"),
  agentSdkWorkingDir: text("agent_sdk_working_dir"),
  ollamaBaseUrl: text("ollama_base_url"),
  ollamaModel: text("ollama_model"),
  anthropicApiKey: text("anthropic_api_key"),
  anthropicModel: text("anthropic_model").default("claude-sonnet-4-5-20250929"),
  openaiApiKey: text("openai_api_key"),
  openaiModel: text("openai_model").default("gpt-4o"),
  customInstructions: text("custom_instructions"),
  // AI Diffing settings (separate from test generation)
  aiDiffingEnabled: boolean("ai_diffing_enabled").default(false),
  aiDiffingProvider: text("ai_diffing_provider"), // 'openrouter' | 'anthropic'
  aiDiffingApiKey: text("ai_diffing_api_key"),
  aiDiffingModel: text("ai_diffing_model").default(
    "anthropic/claude-sonnet-4-5-20250929",
  ),
  aiDiffingOllamaBaseUrl: text("ai_diffing_ollama_base_url"),
  aiDiffingOllamaModel: text("ai_diffing_ollama_model"),
  pwAgentModel: text("pw_agent_model"),
  pwAgentTimeout: integer("pw_agent_timeout").default(300000),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type AISettings = typeof aiSettings.$inferSelect;
export type NewAISettings = typeof aiSettings.$inferInsert;

export const DEFAULT_AI_SETTINGS = {
  provider: "claude-agent-sdk" as AIProvider,
  openrouterModel: "anthropic/claude-sonnet-4",
  agentSdkPermissionMode: "acceptEdits" as AgentSdkPermissionMode,
  agentSdkModel: "",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "",
  anthropicModel: "claude-sonnet-4-5-20250929",
  openaiModel: "gpt-4o",
  aiDiffingEnabled: false,
  aiDiffingProvider: "same-as-test-gen" as AIDiffingProvider,
  aiDiffingModel: "anthropic/claude-sonnet-4-5-20250929",
  aiDiffingOllamaBaseUrl: "http://localhost:11434",
  aiDiffingOllamaModel: "",
  pwAgentModel: "",
  pwAgentTimeout: 300000,
};

// AI Prompt Logging for debugging and auditing
export type AIActionType =
  | "create_test"
  | "fix_test"
  | "enhance_test"
  | "scan_routes"
  | "test_connection"
  | "mcp_explore"
  | "analyze_diff"
  | "extract_user_stories"
  | "generate_spec_tests"
  | "classify_template"
  | "agent_discover"
  | "agent_generate"
  | "agent_heal"
  | "agent_play"
  | "triage"
  | "generate_var_value"
  | "suggest_app_fix";
export type AILogStatus = "pending" | "success" | "error";

export const aiPromptLogs = pgTable("ai_prompt_logs", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  actionType: text("action_type").notNull(), // 'create_test' | 'fix_test' | 'enhance_test' | 'scan_routes' | 'test_connection'
  provider: text("provider").notNull(), // 'claude-cli' | 'openrouter'
  model: text("model"),
  systemPrompt: text("system_prompt"),
  userPrompt: text("user_prompt").notNull(),
  response: text("response"),
  status: text("status").notNull(), // 'success' | 'error'
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at"),
});

export type AIPromptLog = typeof aiPromptLogs.$inferSelect;
export type NewAIPromptLog = typeof aiPromptLogs.$inferInsert;

// Background Jobs for queue tracking
export type BackgroundJobType =
  | "ai_scan"
  | "build_tests"
  | "test_run"
  | "build_run"
  | "ai_fix"
  | "ai_validate"
  | "ai_diff"
  | "storage_cleanup"
  | "spec_import"
  | "url_diff";
export type BackgroundJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export const backgroundJobs = pgTable("background_jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // BackgroundJobType
  status: text("status").notNull().default("pending"), // BackgroundJobStatus
  progress: integer("progress").default(0), // 0-100
  totalSteps: integer("total_steps"),
  completedSteps: integer("completed_steps").default(0),
  label: text("label").notNull(),
  error: text("error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  parentJobId: text("parent_job_id"),
  repositoryId: text("repository_id").references(() => repositories.id),
  targetRunnerId: text("target_runner_id"), // 'local' or runner UUID — tracks which runner this job targets
  actualRunnerId: text("actual_runner_id"), // Runner UUID that actually executed (resolved from 'auto')
  createdAt: timestamp("created_at"),
  startedAt: timestamp("started_at"),
  lastActivityAt: timestamp("last_activity_at"),
  completedAt: timestamp("completed_at"),
});

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert;

// Build schedules for recurring test runs
export const buildSchedules = pgTable("build_schedules", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").default(true),
  cronExpression: text("cron_expression").notNull(),
  timezone: text("timezone").default("UTC"),
  runnerId: text("runner_id"),
  testIds: jsonb("test_ids").$type<string[]>(),
  suiteId: text("suite_id"),
  gitBranch: text("git_branch"),
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  lastBuildId: text("last_build_id"),
  consecutiveFailures: integer("consecutive_failures").default(0),
  maxConsecutiveFailures: integer("max_consecutive_failures").default(5),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type BuildSchedule = typeof buildSchedules.$inferSelect;
export type NewBuildSchedule = typeof buildSchedules.$inferInsert;

// Test versions for version history
export type TestChangeReason =
  | "initial"
  | "manual_edit"
  | "ai_fix"
  | "ai_enhance"
  | "restored"
  | "branch_merge"
  | "assertion_sync"
  | "spec_regeneration";

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

// Notification settings for Slack, Discord, GitHub PR comments, GitLab MR comments, and Custom Webhook
export const notificationSettings = pgTable("notification_settings", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  slackWebhookUrl: text("slack_webhook_url"),
  slackEnabled: boolean("slack_enabled").default(false),
  discordWebhookUrl: text("discord_webhook_url"),
  discordEnabled: boolean("discord_enabled").default(false),
  githubPrCommentsEnabled: boolean("github_pr_comments_enabled").default(false),
  gitlabMrCommentsEnabled: boolean("gitlab_mr_comments_enabled").default(false),
  customWebhookEnabled: boolean("custom_webhook_enabled").default(false),
  customWebhookUrl: text("custom_webhook_url"),
  customWebhookMethod: text("custom_webhook_method").default("POST"),
  customWebhookHeaders: text("custom_webhook_headers"), // JSON: {"Authorization": "Bearer xxx"}
  // Where "Submit as Issue" on a visual diff posts the issue. Only 'github' is wired today.
  issueTrackerProvider: text("issue_tracker_provider")
    .default("github")
    .notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type NotificationSettings = typeof notificationSettings.$inferSelect;
export type NewNotificationSettings = typeof notificationSettings.$inferInsert;
export type IssueTrackerProvider = "github" | "gitlab";

export const DEFAULT_NOTIFICATION_SETTINGS = {
  slackEnabled: false,
  discordEnabled: false,
  githubPrCommentsEnabled: false,
  gitlabMrCommentsEnabled: false,
  customWebhookEnabled: false,
  customWebhookMethod: "POST" as const,
  issueTrackerProvider: "github" as IssueTrackerProvider,
};

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
// Teams & Auth Tables
// ============================================

export type UserRole = "owner" | "admin" | "member" | "viewer";

// Subscription tier the team is on. Demo teams are shared, read-only
// sandboxes; the rest are normal billable tiers. The capability layer in
// `src/lib/auth/capabilities.ts` derives the allowed action set from
// (role, plan, status) — adding a new tier means one branch there, not
// editing every server action.
//
// Quotas, prices, and Stripe price IDs for the billable tiers live in
// `src/lib/billing/plans.ts`; webhook handlers sync subscription state
// back into the team row.
export type TeamPlan = "demo" | "free" | "trial" | "starter" | "growth" | "pro";
export type TeamStatus = "active" | "suspended";

// Mirror of Stripe's subscription.status enum, narrowed to what we react to.
// `null` means the team has never had a paid subscription (free plan).
export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

// Teams - Multi-tenancy support
export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").$type<TeamPlan>().notNull().default("free"),
  status: text("status").$type<TeamStatus>().notNull().default("active"),
  selectedRepositoryId: text("selected_repository_id"),
  earlyAdopterMode: boolean("early_adopter_mode").default(false),
  /** QuickStart agent: email template for the demo user it registers.
   *  Tokens: {slug} = kebab-case product name, {stamp} = UTC YYYYMMDDHHMM.
   *  Default lands the verification mail in Viktor's inbox via plus-addressing. */
  quickstartEmailTemplate: text("quickstart_email_template").default(
    "viktor+{slug}{stamp}@lastest.cloud",
  ),
  banAiMode: boolean("ban_ai_mode").default(false),
  gamificationEnabled: boolean("gamification_enabled").default(true),
  /** Verify phase (v1.14+) — when true, /verify is the primary surface and
   *  appears as the first sidebar entry. /run and /review are demoted. */
  verifyPhaseEnabled: boolean("verify_phase_enabled").default(true),
  storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }).default(
    10737418240,
  ), // 10 GB
  storageUsedBytes: bigint("storage_used_bytes", { mode: "number" }).default(0),
  storageLastCalculatedAt: timestamp("storage_last_calculated_at"),
  // Monthly test-run usage. usageMonth is a 'YYYY-MM' UTC stamp; counters reset
  // atomically on first run of a new month (see recordTeamRunCompletion).
  // Minutes are tracked for measurement only; only runsThisMonth is gated by
  // monthlyRunQuota when ENFORCE_RUN_LIMITS=true.
  monthlyRunQuota: integer("monthly_run_quota").default(500),
  runsThisMonth: integer("runs_this_month").default(0),
  runMinutesThisMonth: doublePrecision("run_minutes_this_month").default(0),
  usageMonth: text("usage_month"), // 'YYYY-MM'
  runUsageLastCalculatedAt: timestamp("run_usage_last_calculated_at"),
  // ── Stripe billing ────────────────────────────────────────────────────
  // Per-team Stripe customer. The better-auth Stripe plugin reads/writes
  // this column directly via its `organization` model mapping
  // (src/lib/auth/auth.ts plugin schema override → modelName='teams').
  // Live subscription state lives in the plugin's `subscription` table
  // keyed by `referenceId = teams.id`; `getTeamBilling()` joins both.
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

export type OnboardingPath = "manual" | "ai" | "agent";

// Users - Core identity
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  hashedPassword: text("hashed_password"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  teamId: text("team_id").references(() => teams.id), // Single team membership
  role: text("role").notNull().default("member"), // 'owner' | 'admin' | 'member' | 'viewer'
  selectedRepositoryId: text("selected_repository_id").references(
    () => repositories.id,
    { onDelete: "set null" },
  ),
  emailVerified: boolean("email_verified").default(false),
  // Onboarding wizard state (v3 fork-at-start). Null = wizard not yet completed.
  // Existing users are backfilled to NOW() on migration so they don't see the wizard.
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  onboardingPath: text("onboarding_path").$type<OnboardingPath>(), // 'manual' | 'ai' | 'agent'
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// Sessions - Database sessions for auth
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  // 'browser' = standard interactive session (default)
  // 'api'     = long-lived programmatic API token (MCP, VSCode extension, scripts)
  // 'launch'  = short-lived scoped token minted by the /oauth/authorize handoff
  //             for the launch.lastest.cloud frontend (see DEFAULT_LAUNCH).
  kind: text("kind").notNull().default("browser"),
  // Human label for 'api' tokens (e.g. "Claude Code laptop"). Null for browser sessions.
  label: text("label"),
  // Last time the token was used (for 'api' tokens). Null for browser sessions.
  lastUsedAt: timestamp("last_used_at"),
  // Space-separated OAuth-style scopes for 'launch' tokens
  // (e.g. "launch:vote launch:submit"). Null for browser/api sessions.
  scope: text("scope"),
  // Mirrors users.teamId onto the session so the Stripe plugin's
  // organization-scoped subscription lookup resolves without running
  // better-auth's organization plugin. Declared as a session
  // additionalField in auth.ts and stamped by the session.create hook —
  // the Drizzle adapter requires this matching column or session
  // creation throws ("field does not exist in the session schema").
  activeOrganizationId: text("active_organization_id"),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// OAuth accounts - Link providers to users
export const oauthAccounts = pgTable("oauth_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  provider: text("provider").notNull(), // 'github' | 'google' | 'credential'
  providerAccountId: text("provider_account_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  tokenExpiresAt: timestamp("token_expires_at"),
  password: text("password"), // BetterAuth stores credential passwords here
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type NewOAuthAccount = typeof oauthAccounts.$inferInsert;

// BetterAuth verification table (email verification, password reset, etc.)
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// Password reset tokens
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at"),
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// Email verification tokens
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
});

export type EmailVerificationToken =
  typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken =
  typeof emailVerificationTokens.$inferInsert;

// User invitations - Team-scoped invitations
export const userInvitations = pgTable("user_invitations", {
  id: text("id").primaryKey(),
  teamId: text("team_id").references(() => teams.id), // Team to join on accept
  email: text("email").notNull(),
  invitedById: text("invited_by_id").references(() => users.id),
  token: text("token").notNull().unique(),
  role: text("role").notNull().default("member"), // Role to assign on accept
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at"),
});

export type UserInvitation = typeof userInvitations.$inferSelect;
export type NewUserInvitation = typeof userInvitations.$inferInsert;

// User consent records - GDPR audit trail
export const userConsents = pgTable("user_consents", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  consentType: text("consent_type").notNull(), // 'terms_of_service' | 'privacy_policy' | 'marketing_emails'
  granted: boolean("granted").notNull(),
  version: text("version").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  grantedAt: timestamp("granted_at").notNull(),
  revokedAt: timestamp("revoked_at"),
});

export type ConsentType =
  | "terms_of_service"
  | "privacy_policy"
  | "marketing_emails";
export type UserConsent = typeof userConsents.$inferSelect;
export type NewUserConsent = typeof userConsents.$inferInsert;

// ============================================
// Runners Table (Remote Execution)
// ============================================

export type RunnerStatus = "online" | "offline" | "busy";
export type RunnerCapability = "run" | "record";

export const runners = pgTable("runners", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  createdById: text("created_by_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  status: text("status").notNull().default("offline"), // 'online' | 'offline' | 'busy'
  lastSeen: timestamp("last_seen"),
  capabilities: jsonb("capabilities")
    .$type<RunnerCapability[]>()
    .default(["run", "record"]),
  type: text("type").notNull().default("remote"), // 'remote' | 'embedded'
  maxParallelTests: integer("max_parallel_tests").default(4), // max tests to run in parallel on this runner
  isSystem: boolean("is_system").notNull().default(false), // System EB runners (host-provided, cross-team)
  authOnly: boolean("auth_only").notNull().default(false), // Auth-only runners (for GHA auto mode — not used for execution)
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
});

export type RunnerType = "remote" | "embedded";
export type Runner = typeof runners.$inferSelect;
export type NewRunner = typeof runners.$inferInsert;

// ============================================
// Embedded Browser Sessions
// ============================================

export type EmbeddedSessionStatus =
  | "starting"
  | "ready"
  | "busy"
  | "stopping"
  | "stopped";

export const embeddedSessions = pgTable("embedded_sessions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  runnerId: text("runner_id").references(() => runners.id),
  status: text("status").notNull().default("starting"), // EmbeddedSessionStatus
  streamUrl: text("stream_url"), // ws://host:9223
  cdpUrl: text("cdp_url"), // http://host:9222 (CDP endpoint for MCP)
  containerUrl: text("container_url"), // http://host:port (for health checks)
  viewport: jsonb("viewport").$type<{ width: number; height: number }>(),
  currentUrl: text("current_url"),
  userId: text("user_id"), // Clerk user who claimed the session
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  lastActivityAt: timestamp("last_activity_at"),
  expiresAt: timestamp("expires_at"),
  busySince: timestamp("busy_since"), // Set when claimed by pool, cleared on release. Used for stale-lock detection.
});

export type EmbeddedSession = typeof embeddedSessions.$inferSelect;
export type NewEmbeddedSession = typeof embeddedSessions.$inferInsert;

// ============================================
// Spec Import - Document-based US/AC extraction
// ============================================

export type SpecImportStatus =
  | "pending"
  | "extracting"
  | "extracted"
  | "generating"
  | "completed"
  | "failed";

export interface ExtractedUserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: ExtractedAcceptanceCriterion[];
}

export interface ExtractedAcceptanceCriterion {
  id: string;
  description: string;
  testName?: string; // AI-suggested test name
  groupedWith?: string; // ID of another AC to group with for a single test
}

export const specImports = pgTable("spec_imports", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  name: text("name").notNull(), // Import session name
  sourceType: text("source_type").notNull(), // 'github' | 'upload'
  sourceFiles: jsonb("source_files").$type<string[]>(), // file paths or names
  branch: text("branch"), // Branch used for code analysis
  status: text("status").notNull().default("pending"), // SpecImportStatus
  extractedStories: jsonb("extracted_stories").$type<ExtractedUserStory[]>(),
  areasCreated: integer("areas_created").default(0),
  testsCreated: integer("tests_created").default(0),
  error: text("error"),
  createdAt: timestamp("created_at"),
  completedAt: timestamp("completed_at"),
});

export type SpecImport = typeof specImports.$inferSelect;
export type NewSpecImport = typeof specImports.$inferInsert;

// ============================================
// Setup Scripts & Configs Tables
// ============================================

export type SetupScriptType = "playwright" | "api";

// Setup Scripts - Reusable setup code blocks
export const setupScripts = pgTable("setup_scripts", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("playwright"), // 'playwright' | 'api'
  code: text("code").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type SetupScript = typeof setupScripts.$inferSelect;
export type NewSetupScript = typeof setupScripts.$inferInsert;

// Auth types for API seeding
export type SetupAuthType = "none" | "bearer" | "basic" | "custom";

export interface SetupAuthConfig {
  token?: string; // For bearer auth
  username?: string; // For basic auth
  password?: string; // For basic auth
  headers?: Record<string, string>; // For custom auth
}

// Setup Configs - API seeding configuration per repository
export const setupConfigs = pgTable("setup_configs", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  authType: text("auth_type").notNull().default("none"), // 'none' | 'bearer' | 'basic' | 'custom'
  authConfig: jsonb("auth_config").$type<SetupAuthConfig>(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type SetupConfig = typeof setupConfigs.$inferSelect;
export type NewSetupConfig = typeof setupConfigs.$inferInsert;

// Setup status for builds
export type SetupStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

// Default Setup Steps - Ordered multi-step setup for repositories
export type SetupStepType = "test" | "script" | "storage_state";

export const defaultSetupSteps = pgTable("default_setup_steps", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  stepType: text("step_type").notNull(), // 'test' | 'script' | 'storage_state'
  testId: text("test_id").references(() => tests.id, { onDelete: "cascade" }),
  scriptId: text("script_id").references(() => setupScripts.id, {
    onDelete: "cascade",
  }),
  storageStateId: text("storage_state_id").references(() => storageStates.id, {
    onDelete: "cascade",
  }),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at"),
});

export type DefaultSetupStep = typeof defaultSetupSteps.$inferSelect;
export type NewDefaultSetupStep = typeof defaultSetupSteps.$inferInsert;

// Default Teardown Steps - Ordered multi-step teardown for repositories
export const defaultTeardownSteps = pgTable("default_teardown_steps", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  stepType: text("step_type").notNull(), // 'test' | 'script' | 'storage_state'
  testId: text("test_id").references(() => tests.id, { onDelete: "cascade" }),
  scriptId: text("script_id").references(() => setupScripts.id, {
    onDelete: "cascade",
  }),
  storageStateId: text("storage_state_id").references(() => storageStates.id, {
    onDelete: "cascade",
  }),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at"),
});

export type DefaultTeardownStep = typeof defaultTeardownSteps.$inferSelect;
export type NewDefaultTeardownStep = typeof defaultTeardownSteps.$inferInsert;

// ============================================
// Google Sheets Test Data Sources
// ============================================

// Google Sheets accounts - per-team Google connection with Sheets API scope
export const googleSheetsAccounts = pgTable("google_sheets_accounts", {
  id: text("id").primaryKey(),
  teamId: text("team_id").references(() => teams.id),
  googleUserId: text("google_user_id").notNull(),
  googleEmail: text("google_email").notNull(),
  googleName: text("google_name"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  createdAt: timestamp("created_at"),
});

export type GoogleSheetsAccount = typeof googleSheetsAccounts.$inferSelect;
export type NewGoogleSheetsAccount = typeof googleSheetsAccounts.$inferInsert;

// Cached cell data from a sheet range
export interface SheetCellData {
  row: number;
  col: number;
  value: string;
}

// Column metadata for a sheet
export interface SheetColumnInfo {
  index: number; // 0-based column index
  letter: string; // Column letter (A, B, C...)
  header: string; // First row value as header
  sampleValues: string[]; // First few values for preview
}

// Google Sheets data sources - linked spreadsheets for test data
export const googleSheetsDataSources = pgTable("google_sheets_data_sources", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  teamId: text("team_id").references(() => teams.id),
  googleSheetsAccountId: text("google_sheets_account_id").references(
    () => googleSheetsAccounts.id,
  ),
  spreadsheetId: text("spreadsheet_id").notNull(), // Google Sheets document ID
  spreadsheetName: text("spreadsheet_name").notNull(), // Document title
  sheetName: text("sheet_name").notNull(), // Tab/sheet name within the spreadsheet
  sheetGid: integer("sheet_gid"), // Sheet tab GID
  alias: text("alias").notNull(), // Short name used in test references (e.g. "users", "products")
  headerRow: integer("header_row").default(1), // Which row contains column headers (1-based)
  dataRange: text("data_range"), // Optional fixed range like "A1:D100"
  cachedHeaders: jsonb("cached_headers").$type<string[]>(),
  cachedData: jsonb("cached_data").$type<string[][]>(), // Cached rows of data
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type GoogleSheetsDataSource =
  typeof googleSheetsDataSources.$inferSelect;
export type NewGoogleSheetsDataSource =
  typeof googleSheetsDataSources.$inferInsert;

// CSV data sources - uploaded CSV files cached as repo-scoped tabular data.
// Mirrors googleSheetsDataSources: alias-keyed, cachedHeaders + cachedData, referenced via {{csv:alias.col[row]}} or via TestVariable.sourceAlias.
export const csvDataSources = pgTable("csv_data_sources", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  teamId: text("team_id").references(() => teams.id),
  alias: text("alias").notNull(), // unique per repo
  filename: text("filename").notNull(),
  storagePath: text("storage_path"), // optional persisted file path
  cachedHeaders: jsonb("cached_headers").$type<string[]>().notNull(),
  cachedData: jsonb("cached_data").$type<string[][]>().notNull(),
  rowCount: integer("row_count").notNull().default(0),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type CsvDataSource = typeof csvDataSources.$inferSelect;
export type NewCsvDataSource = typeof csvDataSources.$inferInsert;

// ============================================
// Compose Configs (per-branch build configuration)
// ============================================

export const composeConfigs = pgTable("compose_configs", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  branch: text("branch").notNull(),
  selectedTestIds: jsonb("selected_test_ids").$type<string[]>(),
  excludedTestIds: jsonb("excluded_test_ids").$type<string[]>(),
  versionOverrides: jsonb("version_overrides").$type<Record<string, string>>(),
  updatedAt: timestamp("updated_at"),
});

export type ComposeConfig = typeof composeConfigs.$inferSelect;
export type NewComposeConfig = typeof composeConfigs.$inferInsert;

// ============================================
// Agent Sessions (Play Agent onboarding flow)
// ============================================

export type AgentSessionStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentSessionKind = "play" | "quickstart";

export type AgentStepId =
  | "settings_check"
  | "select_repo"
  | "env_setup"
  | "scan_and_template"
  | "plan"
  | "review"
  | "generate"
  | "run_tests"
  | "fix_tests"
  | "rerun_tests"
  | "summary"
  | "heal"
  // QuickStart agent steps
  | "qs_preflight"
  | "qs_scout_public"
  | "qs_auth_setup"
  | "qs_scout_authed"
  | "qs_generate"
  | "qs_run_and_notes"
  | "qs_approve_baselines"
  | "qs_rerun_after_approval"
  | "qs_publish_share";

export type AgentStepStatus =
  | "pending"
  | "active"
  | "waiting_user"
  | "completed"
  | "failed"
  | "skipped";

export type PwAgentType =
  | "orchestrator"
  | "planner"
  | "scout"
  | "diver"
  | "generator"
  | "healer"
  | "quickstart";

export interface AgentSubstep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
  /** Which PW sub-agent is handling this substep (shown as a badge in the UI) */
  agent?: PwAgentType;
  /** Planner source identifier for observability */
  source?: string;
  /** Links to aiPromptLogs.id for full input/output drill-down */
  promptLogId?: string;
  /** Short description of planner inputs */
  inputSummary?: string;
  /** Comma-separated area names found */
  outputSummary?: string;
  /** Number of areas discovered */
  areasFound?: number;
  /** Wall-clock duration in ms */
  durationMs?: number;
  /** Full error message (not truncated) */
  rawError?: string;
}

export interface AgentRichResultPlanArea {
  id: string;
  name: string;
  // Short hint string from the planner agent (transient — not persisted; the persistence
  // target is the area's `agentPlan` column). Kept distinct from `testPlan` so the UI
  // can show a one-line preview alongside the full plan.
  summary: string;
  routes: string[];
  testPlan: string;
  approved?: boolean;
}

export type AgentStepRichResult =
  | {
      type: "scan_and_template";
      routes: Array<{ path: string; type: string }>;
      framework?: string;
      template?: string;
      intelligence?: Record<string, unknown>;
    }
  | { type: "plan"; areas: AgentRichResultPlanArea[] }
  | {
      type: "generate";
      tests: Array<{
        testId: string;
        name: string;
        areaName: string;
        code: string;
      }>;
    }
  | { type: "env_setup"; loginScript?: string; pageContext?: string }
  | {
      type: "run_tests";
      buildId: string;
      results: Array<{ testName: string; status: string; error?: string }>;
    }
  | {
      type: "fix_tests";
      fixes: Array<{
        testName: string;
        originalError: string;
        fixed: boolean;
        newCode?: string;
      }>;
    }
  | { type: "generic"; content: string };

export interface AgentStepState {
  id: AgentStepId;
  status: AgentStepStatus;
  label: string;
  description: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: Record<string, unknown>;
  richResult?: AgentStepRichResult;
  userAction?: string;
  substeps?: AgentSubstep[];
}

export interface QuickstartAuthClassification {
  /**
   * Auth-flow classification. `unknown` is a distinct failure sentinel meaning
   * "the scout could not determine the flow" (browser MCP failure, empty page,
   * etc.) — never confuse with `no_public_register` which means "the scout
   * confirmed there is no public sign-up".
   */
  classification:
    | "email_password"
    | "magic_link_only"
    | "oauth_only"
    | "captcha_gated"
    | "otp"
    | "no_public_register"
    | "unknown";
  authAutomatable: boolean;
}

export interface QuickstartBusinessInteraction {
  /** Visible label / placeholder of the primary input the founder's hero CTA points at
   *  (e.g. "Paste a startup idea", "Search anything", "Enter a URL"). */
  primaryInputLabel?: string;
  /** Visible text of the hero / primary CTA (e.g. "Validate idea", "Generate brief"). */
  primaryCtaLabel?: string;
  /** Safe demo value to type into the primary input. Plain string, no quotes — must be
   *  additive/idempotent (no destructive actions, no real payments, no outbound mail). */
  demoInputValue?: string;
}

export interface QuickstartPublicScout extends QuickstartAuthClassification {
  tagline?: string;
  concept?: string;
  navLinks: Array<{ path: string; label: string }>;
  registerPath?: string | null;
  cookieBannerSelectorHint?: string;
  friction?: Array<{ kind: string; note: string }>;
  businessInteraction?: QuickstartBusinessInteraction;
}

export interface QuickstartAuthedScout {
  inAppNavLinks: Array<{ path: string; label: string }>;
  safeCtaCandidates: Array<{ label: string; selectorHint?: string }>;
  observedRoutes: string[];
  friction?: Array<{ kind: string; note: string }>;
}

export interface QuickstartAuthSetupMeta {
  testId?: string;
  storageStateId?: string;
  captured: boolean;
  failureReason?: string;
}

export interface AgentSessionMetadata {
  buildIds?: string[];
  fixAttempts?: Record<string, number>;
  codeHashes?: Record<string, string[]>;
  testsCreated?: number;
  initialPassedCount?: number;
  initialFailedCount?: number;
  finalPassedCount?: number;
  finalFailedCount?: number;
  approvedAreaIds?: string[];
  autoApproveReview?: boolean;
  manualMode?: boolean;
  skipGithub?: boolean;
  skipAI?: boolean;
  // QuickStart-only fields
  quickstartEmail?: string;
  quickstartPassword?: string;
  quickstartSlug?: string;
  quickstartStamp?: string;
  publicScout?: QuickstartPublicScout;
  authedScout?: QuickstartAuthedScout;
  authSetup?: QuickstartAuthSetupMeta;
  walkthroughTestId?: string;
  buildId?: string;
  /** Build id of the second walkthrough run (after baselines are approved). Replaces
   *  buildId for share publication so newly-added authed scenarios pair with their own
   *  baselines (isNewTest pairing trap fix). */
  rerunBuildId?: string;
  demoNotesId?: string;
  /** Share id returned by publishBuildShare after the rerun completes. */
  shareId?: string;
  shareSlug?: string;
  shareUrl?: string;
  disabledReason?: string;
  [key: string]: unknown;
}

export const agentSessions = pgTable("agent_sessions", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  teamId: text("team_id"),
  kind: text("kind").$type<AgentSessionKind>().notNull().default("play"),
  status: text("status")
    .$type<AgentSessionStatus>()
    .notNull()
    .default("active"),
  currentStepId: text("current_step_id").$type<AgentStepId>(),
  steps: jsonb("steps").$type<AgentStepState[]>().notNull(),
  metadata: jsonb("metadata").$type<AgentSessionMetadata>().notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  completedAt: timestamp("completed_at"),
});

export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;

// ── Bug Reports ──────────────────────────────────────────────────────────────

export type BugReportSeverity = "low" | "medium" | "high";

export interface BugReportContext {
  url: string;
  viewport: { width: number; height: number };
  userAgent: string;
  appVersion: string | null;
  gitHash: string | null;
  buildDate: string | null;
  consoleErrors: { message: string; timestamp: number }[];
  failedRequests: { url: string; status: number; method: string }[];
  breadcrumbs: { action: string; target: string; timestamp: number }[];
  selectedRepoId?: string | null;
  selectedRepoName?: string | null;
}

export const bugReports = pgTable("bug_reports", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  reportedById: text("reported_by_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  description: text("description").notNull(),
  severity: text("severity")
    .$type<BugReportSeverity>()
    .notNull()
    .default("medium"),
  context: jsonb("context").$type<BugReportContext>(),
  screenshotPath: text("screenshot_path"),
  contentHash: text("content_hash"),
  githubIssueUrl: text("github_issue_url"),
  githubIssueNumber: integer("github_issue_number"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
});

export type BugReport = typeof bugReports.$inferSelect;
export type NewBugReport = typeof bugReports.$inferInsert;

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

// ============================================
// Runner Commands (DB-backed command queue)
// ============================================

export type RunnerCommandStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

export const runnerCommands = pgTable(
  "runner_commands",
  {
    id: text("id").primaryKey(), // Same as message UUID (becomes correlationId)
    runnerId: text("runner_id")
      .notNull()
      .references(() => runners.id),
    type: text("type").notNull(), // e.g. 'command:run_test', 'command:shutdown'
    status: text("status").notNull().default("pending"), // RunnerCommandStatus
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    testId: text("test_id"), // Denormalized for dedup lookups
    testRunId: text("test_run_id"), // Denormalized for grouping
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    // Stamped when the server returns this command in a heartbeat response.
    // The row stays at status='pending' until the runner POSTs `response:command_ack`,
    // at which point status flips to 'claimed'. If no ack within REDISPATCH_TTL the
    // next heartbeat re-delivers; EB-side `activeTestIds` dedup keeps it safe.
    dispatchedAt: timestamp("dispatched_at"),
    claimedAt: timestamp("claimed_at"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_runner_commands_runner_status").on(table.runnerId, table.status),
    index("idx_runner_commands_test_run").on(table.testRunId),
  ],
);

export type RunnerCommand = typeof runnerCommands.$inferSelect;
export type NewRunnerCommand = typeof runnerCommands.$inferInsert;

export const runnerCommandResults = pgTable(
  "runner_command_results",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // `command_id` is intentionally NOT an FK: the parent runner_commands row
    // can be reaped (`reapIdleEBJobs`, `cleanupOldCommands`) before an EB
    // finishes draining late `response:*` POSTs after Job termination. With a
    // hard FK we got `runner_command_results_command_id_runner_commands_id_fk`
    // violations on those late inserts, while the on-disk artifact (screenshot,
    // network-bodies file, etc.) was already written. Keeping the column as a
    // logical reference lets the insert succeed; cleanup still happens — orphan
    // result rows are deleted by `reapIdleEBJobs` via `runnerId`, and
    // `cleanupOldCommands` deletes by `commandId` while the parent still
    // exists.
    commandId: text("command_id").notNull(),
    runnerId: text("runner_id")
      .notNull()
      .references(() => runners.id),
    type: text("type").notNull(), // 'response:test_result', 'response:screenshot', 'response:error'
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    acknowledged: boolean("acknowledged").default(false),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_runner_cmd_results_cmd_ack").on(
      table.commandId,
      table.acknowledged,
    ),
  ],
);

export type RunnerCommandResult = typeof runnerCommandResults.$inferSelect;
export type NewRunnerCommandResult = typeof runnerCommandResults.$inferInsert;

// ============================================
// Remote Recording Events (cross-pod forwarding)
// ============================================
// Recording events POSTed by the EB land on whichever pod serves LASTEST_URL
// (the envoy-less `*-internal` pod in kubernetes mode). The recording session
// state lives in-memory on the main pod (where startRecording ran). Without
// this table the internal pod has no way to hand events back to the main pod
// — logs fill with "Received events for unknown session". This table is the
// shared inbox: internal pod inserts, main pod reads since-last-sequence.
export const remoteRecordingEvents = pgTable(
  "remote_recording_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id").notNull(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    status: text("status").notNull(), // 'preview' | 'committed'
    verification: jsonb("verification").$type<Record<string, unknown> | null>(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    // MUST be unique: the recording_event ingest upserts on (sessionId,
    // sequence) — the EB re-emits an event with the same sequence when its
    // verification settles or a thumbnail arrives, and replaces trailing
    // hover-previews in place. With a plain index the insert's ON CONFLICT
    // never fired and every re-emit piled up a duplicate row; the merged
    // timeline (and the code generated from it at stop time) then picked an
    // arbitrary stale/new copy per sequence.
    uniqueIndex("idx_remote_recording_events_session_seq").on(
      table.sessionId,
      table.sequence,
    ),
  ],
);

export type RemoteRecordingEventRow = typeof remoteRecordingEvents.$inferSelect;
export type NewRemoteRecordingEventRow =
  typeof remoteRecordingEvents.$inferInsert;

// ============================================
// GitHub Actions Configs
// ============================================

export type GithubActionMode = "persistent" | "ephemeral" | "auto";
export type GithubActionTriggerEvent =
  | "push"
  | "pull_request"
  | "workflow_dispatch"
  | "schedule";

export const githubActionConfigs = pgTable("github_action_configs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  runnerId: text("runner_id").references(() => runners.id, {
    onDelete: "set null",
  }),
  repositoryOwner: text("repository_owner").notNull(),
  repositoryName: text("repository_name").notNull(),
  githubRepoId: integer("github_repo_id"),
  mode: text("mode").notNull().default("persistent"),
  triggerEvents: jsonb("trigger_events")
    .$type<GithubActionTriggerEvent[]>()
    .default(["push", "pull_request", "workflow_dispatch"]),
  branchFilter: jsonb("branch_filter").$type<string[]>().default(["main"]),
  cronSchedule: text("cron_schedule"),
  targetUrl: text("target_url"),
  timeout: integer("timeout").default(300000),
  failOnChanges: boolean("fail_on_changes").default(true),
  maxParallelTests: integer("max_parallel_tests"),
  pollInterval: integer("poll_interval"),
  workflowDeployed: boolean("workflow_deployed").default(false),
  lastDeployedAt: timestamp("last_deployed_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

export type GithubActionConfig = typeof githubActionConfigs.$inferSelect;
export type NewGithubActionConfig = typeof githubActionConfigs.$inferInsert;

// ============================================
// GitLab Pipeline Configs
// ============================================

export type GitlabPipelineMode = "persistent" | "ephemeral" | "auto";
export type GitlabPipelineTriggerEvent =
  | "push"
  | "merge_request"
  | "schedule"
  | "manual";
// 'ci_file' = generate .gitlab-ci.yml + push it via Repo Files API (full GH-Actions parity)
// 'webhook' = no CI file; webhook fires server-side createAndRunBuild (no edits to user repo)
export type GitlabPipelineDeliveryMode = "ci_file" | "webhook";

export const DEFAULT_GITLAB_PIPELINE_TRIGGER_EVENTS: GitlabPipelineTriggerEvent[] =
  ["push", "merge_request"];
export const DEFAULT_GITLAB_BRANCH_FILTER: string[] = ["main"];

export const gitlabPipelineConfigs = pgTable("gitlab_pipeline_configs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  runnerId: text("runner_id").references(() => runners.id, {
    onDelete: "set null",
  }),
  // Repository reference
  repositoryId: text("repository_id").references(() => repositories.id, {
    onDelete: "cascade",
  }),
  projectPath: text("project_path").notNull(), // "namespace/project"
  gitlabProjectId: integer("gitlab_project_id"),
  mode: text("mode").notNull().default("persistent"), // GitlabPipelineMode
  deliveryMode: text("delivery_mode").notNull().default("ci_file"), // GitlabPipelineDeliveryMode
  triggerEvents: jsonb("trigger_events")
    .$type<GitlabPipelineTriggerEvent[]>()
    .default(["push", "merge_request"]),
  branchFilter: jsonb("branch_filter").$type<string[]>().default(["main"]),
  cronSchedule: text("cron_schedule"),
  timeout: integer("timeout").default(300000),
  failOnChanges: boolean("fail_on_changes").default(true),
  maxParallelTests: integer("max_parallel_tests"),
  pollInterval: integer("poll_interval"),
  webhookSecret: text("webhook_secret"),
  pipelineDeployed: boolean("pipeline_deployed").default(false),
  lastDeployedAt: timestamp("last_deployed_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

export type GitlabPipelineConfig = typeof gitlabPipelineConfigs.$inferSelect;
export type NewGitlabPipelineConfig = typeof gitlabPipelineConfigs.$inferInsert;

// ============================================
// GitHub Issues (cached for analytics)
// ============================================

export const githubIssues = pgTable(
  "github_issues",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    githubIssueNumber: integer("github_issue_number").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(), // 'open' | 'closed'
    labels: jsonb("labels").$type<string[]>().default([]),
    author: text("author"),
    createdAt: timestamp("created_at"),
    closedAt: timestamp("closed_at"),
    syncedAt: timestamp("synced_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_github_issues_repo").on(table.repositoryId),
    index("idx_github_issues_repo_number").on(
      table.repositoryId,
      table.githubIssueNumber,
    ),
  ],
);

export type GithubIssue = typeof githubIssues.$inferSelect;
export type NewGithubIssue = typeof githubIssues.$inferInsert;

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

// ============================================
// Storage States (saved browser auth for recordings)
// ============================================

export const storageStates = pgTable(
  "storage_states",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id").references(() => repositories.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    storageStateJson: text("storage_state_json").notNull(),
    cookieCount: integer("cookie_count").default(0),
    originCount: integer("origin_count").default(0),
    // Provenance metadata — surfaces capture quality + replay strategy hints.
    // includesIndexedDB: true when the JSON was produced with `storageState({ indexedDB: true })`
    // (Playwright v1.51+). Lets the runner decide whether the capture covers Firebase Auth.
    includesIndexedDB: boolean("includes_indexed_db").default(false),
    // authFlavor: free-form hint so the agent can pick the right re-auth strategy.
    // Common values: 'firebase' | 'supabase' | 'clerk' | 'next-auth' | 'better-auth' | 'cookie' | 'unknown'.
    authFlavor: text("auth_flavor"),
    // tokenLocations: where the session lives. Array of 'cookie' | 'localStorage' |
    // 'sessionStorage' | 'indexedDB'. Lets future surfaces flag captures that are
    // missing a location they should have (e.g. firebase without indexedDB).
    tokenLocations: jsonb("token_locations").$type<string[]>(),
    // firebaseApiKey: when authFlavor === 'firebase', stores the project's Web API key
    // so the documented #35302/#35504 IndexedDB workaround can target the right key in
    // firebaseLocalStorageDb. Public web-API key, not a secret.
    firebaseApiKey: text("firebase_api_key"),
    // expiresAt: best-effort estimate based on the auth library's session TTL.
    // Surfaces stale captures so the agent recaptures instead of debugging
    // chain-auth-yielded-unauthenticated as if it were a different bug.
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_storage_states_repo").on(table.repositoryId)],
);

export type StorageState = typeof storageStates.$inferSelect;
export type NewStorageState = typeof storageStates.$inferInsert;

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

// ── Activity Events (Agent Activity Feed) ───────────────────────────────────

export type ActivityEventType =
  | "session:start"
  | "session:complete"
  | "session:error"
  | "step:start"
  | "step:complete"
  | "step:error"
  | "step:waiting_user"
  | "substep:update"
  | "mcp:tool_call"
  | "mcp:tool_result"
  | "mcp:tool_error"
  | "artifact:created"
  | "artifact:updated"
  // Gamification
  | "score:awarded"
  | "score:penalty"
  | "beat_the_bot"
  | "achievement:unlocked"
  | "season:started"
  | "season:ended"
  | "blitz:started"
  | "blitz:ended"
  // Verify phase (v1.14+)
  | "verify:opened"
  | "verify:layer_approved"
  | "verify:layer_rejected"
  | "verify:layer_snoozed"
  | "verify:build_completed"
  | "verify:case_confirmed"
  | "verify:bugfix_filed"
  | "verify:improvement_filed"
  | "verify:case_auto_resolved";

export type ActivitySourceType =
  | "play_agent"
  | "mcp_server"
  | "generate_agent"
  | "heal_agent";

export type ActivityArtifactType =
  | "test"
  | "build"
  | "area"
  | "baseline"
  | "score"
  | "spec_import";

export const activityEvents = pgTable(
  "activity_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    repositoryId: text("repository_id"),
    sessionId: text("session_id"),
    sourceType: text("source_type").$type<ActivitySourceType>().notNull(),
    eventType: text("event_type").$type<ActivityEventType>().notNull(),
    agentType: text("agent_type").$type<PwAgentType>(),
    stepId: text("step_id"),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    artifactType: text("artifact_type").$type<ActivityArtifactType>(),
    artifactId: text("artifact_id"),
    artifactLabel: text("artifact_label"),
    promptLogId: text("prompt_log_id"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_activity_events_team_created").on(table.teamId, table.createdAt),
    index("idx_activity_events_session").on(table.sessionId),
  ],
);

export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;

// ── Gamification: Beat-the-Bot ───────────────────────────────────────────────

export type ActorKind = "user" | "bot";
export type BotKind = "play_agent" | "generate_agent" | "mcp_server";

// Bots that compete on the leaderboard alongside humans. Seeded per team when gamification
// is first enabled via ensureDefaultBots().
export const bots = pgTable(
  "bots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<BotKind>().notNull(),
    avatarEmoji: text("avatar_emoji").default("🤖"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_bots_team").on(table.teamId)],
);

export type Bot = typeof bots.$inferSelect;
export type NewBot = typeof bots.$inferInsert;

export type GamificationSeasonStatus = "active" | "ended";

export const gamificationSeasons = pgTable(
  "gamification_seasons",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at"),
    status: text("status")
      .$type<GamificationSeasonStatus>()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_gamification_seasons_team_status").on(
      table.teamId,
      table.status,
    ),
  ],
);

export type GamificationSeason = typeof gamificationSeasons.$inferSelect;
export type NewGamificationSeason = typeof gamificationSeasons.$inferInsert;

export type BugBlitzStatus = "scheduled" | "active" | "ended";

export const bugBlitzEvents = pgTable(
  "bug_blitz_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    seasonId: text("season_id").notNull(),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    multiplier: integer("multiplier").notNull().default(200), // stored ×100, 200 = 2×
    status: text("status")
      .$type<BugBlitzStatus>()
      .notNull()
      .default("scheduled"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_bug_blitz_team_window").on(
      table.teamId,
      table.startsAt,
      table.endsAt,
    ),
  ],
);

export type BugBlitzEvent = typeof bugBlitzEvents.$inferSelect;
export type NewBugBlitzEvent = typeof bugBlitzEvents.$inferInsert;

export type ScoreEventKind =
  | "test_created"
  | "diff_approved_as_change"
  | "regression_caught"
  | "triage_resolved"
  | "flake_penalty"
  | "achievement_bonus";

export type ScoreEventSource =
  | "test"
  | "diff"
  | "review_todo"
  | "test_result"
  | "achievement";

// Immutable ledger of every point change.
// The (actor, kind, source) index supports idempotency checks in awardScore.
export const scoreEvents = pgTable(
  "score_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    seasonId: text("season_id").notNull(),
    bugBlitzId: text("bug_blitz_id"),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    actorId: text("actor_id").notNull(), // userId or botId
    kind: text("kind").$type<ScoreEventKind>().notNull(),
    delta: integer("delta").notNull(), // points after multiplier, can be negative
    baseDelta: integer("base_delta").notNull(), // rule base value, for auditing
    multiplier: integer("multiplier").notNull().default(100), // 100 = 1×
    sourceType: text("source_type").$type<ScoreEventSource>().notNull(),
    sourceId: text("source_id").notNull(),
    reason: text("reason"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_score_events_actor_kind_source").on(
      table.actorKind,
      table.actorId,
      table.kind,
      table.sourceType,
      table.sourceId,
    ),
    index("idx_score_events_team_season_created").on(
      table.teamId,
      table.seasonId,
      table.createdAt,
    ),
    index("idx_score_events_actor_season").on(
      table.actorKind,
      table.actorId,
      table.seasonId,
    ),
  ],
);

export type ScoreEvent = typeof scoreEvents.$inferSelect;
export type NewScoreEvent = typeof scoreEvents.$inferInsert;

// Denormalized running totals for O(1) leaderboard reads. Rebuildable from scoreEvents.
export const userScores = pgTable(
  "user_scores",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    seasonId: text("season_id").notNull(),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    actorId: text("actor_id").notNull(),
    total: integer("total").notNull().default(0),
    testsCreated: integer("tests_created").notNull().default(0),
    regressionsCaught: integer("regressions_caught").notNull().default(0),
    flakesIncurred: integer("flakes_incurred").notNull().default(0),
    lastEventAt: timestamp("last_event_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_user_scores_season_actor").on(
      table.seasonId,
      table.actorKind,
      table.actorId,
    ),
    index("idx_user_scores_season_total").on(table.seasonId, table.total),
  ],
);

export type UserScore = typeof userScores.$inferSelect;
export type NewUserScore = typeof userScores.$inferInsert;

export type AchievementCode =
  | "first_test"
  | "first_regression"
  | "beat_bot_first"
  | "beat_bot_by_100"
  | "blitz_champion"
  | "season_winner";

export const achievements = pgTable(
  "achievements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    seasonId: text("season_id").notNull(),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    actorId: text("actor_id").notNull(),
    code: text("code").$type<AchievementCode>().notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    awardedAt: timestamp("awarded_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_achievements_season_actor_code").on(
      table.seasonId,
      table.actorKind,
      table.actorId,
      table.code,
    ),
  ],
);

export type Achievement = typeof achievements.$inferSelect;
export type NewAchievement = typeof achievements.$inferInsert;

// ============================================
// Public Shares (Campaign Landing Pages)
// ============================================
// An operator on a build detail page can publish a public share, producing
// a short URL (lastest.cloud/r/:slug) that shows the build's artifacts to
// unauthenticated visitors. A "claim" signs the visitor up and copies the
// test definition into their new team. The share itself remains owned by
// the publishing team — copy-on-claim keeps the public URL stable forever.

export type PublicShareStatus = "public" | "revoked";

export const publicShares = pgTable(
  "public_shares",
  {
    id: text("id").primaryKey(),
    // 22-char URL-safe token (~128 bits of entropy) — the public handle.
    slug: text("slug").notNull().unique(),
    buildId: text("build_id").notNull(),
    testId: text("test_id"),
    repositoryId: text("repository_id"),
    ownerTeamId: text("owner_team_id"),
    publishedByUserId: text("published_by_user_id"),
    status: text("status")
      .$type<PublicShareStatus>()
      .notNull()
      .default("public"),
    targetDomain: text("target_domain"),
    claimedByTeamId: text("claimed_by_team_id"),
    claimedByUserId: text("claimed_by_user_id"),
    claimedAt: timestamp("claimed_at"),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("idx_public_shares_build").on(table.buildId),
    index("idx_public_shares_owner_team").on(table.ownerTeamId),
  ],
);

export type PublicShare = typeof publicShares.$inferSelect;
export type NewPublicShare = typeof publicShares.$inferInsert;

// Shared state for an in-flight remote debug session. Previously a per-pod
// `globalThis` Map; moved to DB because the Olares deployment runs TWO app
// pods (envoy-fronted `lastest-dev` for the UI + envoy-less
// `lastest-internal-dev` that receives EB POSTs), and they can't share
// in-process memory. The UI reads state via polling from pod A while the
// EB writes state via `response:debug_state` POSTs that land on pod B.
export const remoteDebugSessions = pgTable(
  "remote_debug_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    runnerId: text("runner_id").notNull(),
    repositoryId: text("repository_id"),
    testId: text("test_id").notNull(),
    state: jsonb("state"),
    startedAt: timestamp("started_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [index("idx_remote_debug_sessions_runner").on(table.runnerId)],
);

export type RemoteDebugSessionRow = typeof remoteDebugSessions.$inferSelect;
export type NewRemoteDebugSessionRow = typeof remoteDebugSessions.$inferInsert;

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
  | "api";

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

// ---------------------------------------------------------------------------
// Verify phase — Build-level Change Map (v1.14+)
// ---------------------------------------------------------------------------
//
// Computed once per build at completion time and cached. Aggregates four
// signals into a single ranked list of areas worth verifying:
//   - code   : git diff vs base branch → routes/areas
//   - ai     : LLM narrative + risk per area
//   - signals: step_comparisons verdicts (red/yellow) on this build
//   - manual : developer-flagged areas (builds.manuallyScopedAreaIds)

export type ChangeSource = "code" | "ai" | "signals" | "manual";
export type ChangeRisk = "low" | "medium" | "high";

export interface ChangeMapFile {
  path: string;
  pkg: string;
  status: "A" | "M" | "D";
  insertions: number;
  deletions: number;
}

export interface ChangeMapArea {
  areaId: string;
  areaName: string;
  sources: ChangeSource[];
  risk: ChangeRisk;
  /** 3-bullet narrative from the LLM. Empty when AI skipped/disabled. */
  aiNarrative: string[];
}

export interface ChangeMapTest {
  testId: string;
  reason: string;
  lastStatus: string | null;
}

export interface ChangeMapStep {
  testId: string;
  stepLabel: string;
  reason: string;
}

export interface ChangeMap {
  files: ChangeMapFile[];
  areas: ChangeMapArea[];
  tests: ChangeMapTest[];
  steps: ChangeMapStep[];
  /** One-sentence build intent summary (AI-generated when enabled). */
  intentSummary: string;
  /** One-sentence build risk summary (AI-generated when enabled). */
  riskSummary: string;
  /** Areas the developer pinned via the Focus-on multi-select. */
  manuallyScopedAreaIds: string[];
  generatedAt: string;
  /** Provider/model id used for the AI summary, when applicable. */
  modelId: string;
  /** True if the AI-summary call was skipped (cap, missing key, etc). */
  aiSkipped?: boolean;
  aiSkippedReason?: string;
}

export const buildChangeMaps = pgTable("build_change_maps", {
  buildId: text("build_id")
    .primaryKey()
    .references(() => builds.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<ChangeMap>().notNull(),
  computedAt: timestamp("computed_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export type BuildChangeMapRow = typeof buildChangeMaps.$inferSelect;
export type NewBuildChangeMapRow = typeof buildChangeMaps.$inferInsert;

// ---------------------------------------------------------------------------
// Build-level demo notes — AI-generated UI/UX summary captured at the end of
// a /gtm-lastest-saas-demo run. Surfaced on the public /r/<slug> share page
// above the screenshot grid so the recipient (the founder we're DM'ing) sees
// "here's what we noticed" before scrolling into the baselines.
//
// Bucketed deliberately:
//   highlights        → safe to quote in outreach DMs
//   frictionPoints    → stays in the share, never quoted to the founder
//   testingStruggles  → automation gotchas (captcha, hangs); feeds the next
//                       demo run's qualification step
//   skippedRoutes     → explicit "couldn't get here" provenance — beats a
//                       silent omission in the screenshot list
// ---------------------------------------------------------------------------

export interface DemoNoteItem {
  label: string;
  note: string;
}

export interface DemoNoteSkippedRoute {
  path: string;
  reason: string;
}

export interface DemoNotes {
  /** 2–3 sentence overall UI/UX impression. */
  uxSummary: string;
  /** Things that worked well; safe for outreach. */
  highlights: DemoNoteItem[];
  /** UX issues observed; founder-facing on the share, never in outreach. */
  frictionPoints: DemoNoteItem[];
  /** Automation pain points (captcha, hangs, OAuth-only flows). */
  testingStruggles: DemoNoteItem[];
  /** Routes the agent tried but couldn't capture. */
  skippedRoutes?: DemoNoteSkippedRoute[];
  generatedAt: string;
  /** Provider/model id used for the AI summary, when applicable. */
  modelId?: string;
}

export const buildDemoNotes = pgTable("build_demo_notes", {
  buildId: text("build_id")
    .primaryKey()
    .references(() => builds.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<DemoNotes>().notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export type BuildDemoNotesRow = typeof buildDemoNotes.$inferSelect;
export type NewBuildDemoNotesRow = typeof buildDemoNotes.$inferInsert;

// ---------------------------------------------------------------------------
// App-fix suggestions — "Fix the app" loop (E5)
// ---------------------------------------------------------------------------
//
// When a failure is classified `real_regression`, the advisor produces a
// structured *application-code* fix recommendation that is returned to the
// calling coding agent (never auto-applied). Distinct from the test healer,
// which patches test code.

export interface AppFixSuggestionFile {
  path: string;
  startLine?: number;
  endLine?: number;
  currentSnippet?: string;
  suggestedSnippet?: string;
  rationale: string;
}

export interface AppFixSuggestion {
  summary: string;
  classification: "real_regression";
  confidence: number;
  files: AppFixSuggestionFile[];
  /** Files from the build's change map that likely introduced the regression. */
  relatedChangeMapFiles?: string[];
  generatedAt: string;
  modelId: string;
}

export const appFixSuggestions = pgTable("app_fix_suggestions", {
  id: text("id").primaryKey(),
  buildId: text("build_id").references(() => builds.id, {
    onDelete: "cascade",
  }),
  testId: text("test_id").references(() => tests.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<AppFixSuggestion>().notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export type AppFixSuggestionRow = typeof appFixSuggestions.$inferSelect;
export type NewAppFixSuggestionRow = typeof appFixSuggestions.$inferInsert;

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

export interface A11yBaselinePayload {
  ruleId: string;
  selector: string;
  impact: string;
  acknowledgedAt: string;
}

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

export const a11yBaselines = pgTable(
  "a11y_baselines",
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
    payload: jsonb("payload").$type<A11yBaselinePayload>().notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_a11y_baselines_test").on(table.testId)],
);

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
export type A11yBaseline = typeof a11yBaselines.$inferSelect;
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

// ---------------------------------------------------------------------------
// Awards — "Prove your app is not AI slop" campaign
// ---------------------------------------------------------------------------
//
// Per-repository tier + category badges. Tier ratchets upward and only
// downgrades on a confirmed regression (user-rejected visual diff, or
// non-flaky test failure across two consecutive builds). Flaky failures,
// in-flight builds, and unresolved/open diffs do not downgrade.
//
// The badge SVG endpoint resolves a publicShares.slug -> repository -> award
// row, so the embed URL stays stable while the underlying state stays live.

export type AwardTier = "none" | "starter" | "bronze" | "silver" | "gold";

export interface AwardCategories {
  a11y: boolean;
  allPassing: boolean;
  zeroDrift: boolean;
}

export const repoAwards = pgTable(
  "repo_awards",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" })
      .unique(),
    currentTier: text("current_tier")
      .$type<AwardTier>()
      .notNull()
      .default("none"),
    highestTier: text("highest_tier")
      .$type<AwardTier>()
      .notNull()
      .default("none"),
    categories: jsonb("categories").$type<AwardCategories>().notNull(),
    proofShareSlug: text("proof_share_slug"),
    lastBuildId: text("last_build_id"),
    earnedAt: timestamp("earned_at")
      .$defaultFn(() => new Date())
      .notNull(),
    lastRecomputedAt: timestamp("last_recomputed_at")
      .$defaultFn(() => new Date())
      .notNull(),
    lastDowngradeAt: timestamp("last_downgrade_at"),
    lastDowngradeReason: text("last_downgrade_reason"),
  },
  (table) => [index("idx_repo_awards_tier").on(table.currentTier)],
);

export type RepoAward = typeof repoAwards.$inferSelect;
export type NewRepoAward = typeof repoAwards.$inferInsert;

// ============================================
// Launch directory (launch.lastest.cloud)
// ============================================
//
// Backs the "Tested & Featured" launch board. The board's frontend lives in a
// separate static-export repo and persists nothing — submissions, votes, the
// weekly cohort cadence, and the per-user auth handoff all live here. Reads are
// public; mutations require a short-lived launch-scoped token (sessions.kind =
// 'launch'). See src/lib/launch/* + src/app/api/v1/launch/[...path]/route.ts.

// Tunables for the launch board. Surfaced as DEFAULT_LAUNCH so the route +
// state engine + gating layer share one source of truth.
export const DEFAULT_LAUNCH = {
  // Curated quality bar: max featured slots that go live per weekly cohort.
  featuredSlotsPerWeek: 12,
  // Anti-gaming velocity caps (rolling 1h window).
  votesPerAccountPerHour: 30,
  votesPerIpPerHour: 60,
  submissionsPerAccountPerHour: 5,
  // Launch token TTL (seconds) minted by /oauth/authorize.
  tokenTtlSeconds: 3600,
  // Scope string the implicit OAuth flow grants.
  scope: "launch:vote launch:submit",
  // Vote-clearing: votes sharing an IP beyond this count in a cohort are flagged
  // as a suspicious cluster and excluded from the winner decision.
  suspiciousIpClusterThreshold: 5,
} as const;

// Weekly cohort: open (accepting/queued) → voting (live Mon–Sun) →
// locked (winner decided Sun) → closed (archived).
export type LaunchCohortState = "open" | "voting" | "locked" | "closed";

export const launchCohorts = pgTable(
  "launch_cohorts",
  {
    id: text("id").primaryKey(),
    // Monday 00:00 PT — start of the voting week. Unique = one cohort per week.
    weekStartAt: timestamp("week_start_at").notNull().unique(),
    // Sunday 23:59 PT — voting closes.
    weekEndAt: timestamp("week_end_at").notNull(),
    state: text("state").$type<LaunchCohortState>().notNull().default("open"),
    // Slug of the Founder-of-the-Week winner, set when the cohort locks.
    winnerSlug: text("winner_slug"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [index("idx_launch_cohorts_state").on(table.state)],
);

export type LaunchCohort = typeof launchCohorts.$inferSelect;
export type NewLaunchCohort = typeof launchCohorts.$inferInsert;

export type LaunchProfileStatus =
  | "pending_review"
  | "featured"
  | "rejected"
  | "archived";

export interface LaunchWalkthrough {
  src: string;
  poster?: string;
  description?: string;
}

export const launchProfiles = pgTable(
  "launch_profiles",
  {
    id: text("id").primaryKey(),
    // Human-readable URL handle (kebab of name + uniqueness counter).
    slug: text("slug").notNull().unique(),
    cohortId: text("cohort_id").references(() => launchCohorts.id, {
      onDelete: "set null",
    }),
    submittedByUserId: text("submitted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    tagline: text("tagline"),
    description: text("description"),
    category: text("category"),
    websiteUrl: text("website_url").notNull(),
    // Normalized host (lowercase, no www/port) for dup-domain detection.
    domain: text("domain"),
    founderName: text("founder_name"),
    founderHandle: text("founder_handle"),
    contactEmail: text("contact_email"),
    logoUrl: text("logo_url"),
    status: text("status")
      .$type<LaunchProfileStatus>()
      .notNull()
      .default("pending_review"),
    // Admin-attached test report (points at an existing /r/<slug> public share)
    // + AI walkthrough video. Set via the admin PATCH endpoint.
    testReportShareUrl: text("test_report_share_url"),
    walkthrough: jsonb("walkthrough").$type<LaunchWalkthrough>(),
    // Denormalized cache of non-cleared votes; source of truth is launch_votes.
    upvoteCount: integer("upvote_count").notNull().default(0),
    // Anti-gaming editorial signals.
    flagged: boolean("flagged").notNull().default(false),
    suspiciousVoteRatio: doublePrecision("suspicious_vote_ratio"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("idx_launch_profiles_cohort").on(table.cohortId),
    index("idx_launch_profiles_domain").on(table.domain),
    index("idx_launch_profiles_status").on(table.status),
  ],
);

export type LaunchProfile = typeof launchProfiles.$inferSelect;
export type NewLaunchProfile = typeof launchProfiles.$inferInsert;

export const launchVotes = pgTable(
  "launch_votes",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => launchProfiles.id, { onDelete: "cascade" }),
    voterUserId: text("voter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ipAddress: text("ip_address"),
    // Vote-clearing soft-flag: a cleared vote is excluded from upvoteCount/winner.
    cleared: boolean("cleared").notNull().default(false),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    // One vote per account per profile — drives the 409 already-voted response.
    uniqueIndex("uq_launch_votes_profile_voter").on(
      table.profileId,
      table.voterUserId,
    ),
    index("idx_launch_votes_voter").on(table.voterUserId),
    index("idx_launch_votes_ip").on(table.ipAddress),
  ],
);

export type LaunchVote = typeof launchVotes.$inferSelect;
export type NewLaunchVote = typeof launchVotes.$inferInsert;

// "Tested Startup of the Month" — admin-set from the month's weekly winners.
export const launchMonthlyWinners = pgTable(
  "launch_monthly_winners",
  {
    id: text("id").primaryKey(),
    month: text("month").notNull().unique(), // 'YYYY-MM' (PT)
    profileSlug: text("profile_slug").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [index("idx_launch_monthly_winners_month").on(table.month)],
);

export type LaunchMonthlyWinner = typeof launchMonthlyWinners.$inferSelect;
export type NewLaunchMonthlyWinner = typeof launchMonthlyWinners.$inferInsert;

// ============================================
// Billing — Stripe integration
// ============================================
//
// Subscription state is managed by the better-auth Stripe plugin
// (@better-auth/stripe). The plugin auto-creates the `subscription`
// table (defined below for type-safe reads); the team's Stripe
// customer ID sits on `teams.stripeCustomerId` via the plugin's
// organization-model schema override.
//
// What lives here, not in the plugin:
//
//  * `stripe_webhook_events` — durable idempotency for webhook
//    deliveries. Stripe retries on 5xx, so we record every delivery by
//    its event ID and process only on first insert. Survives restarts
//    and gives admins a forensic record. Pure internal — never gates a
//    user-visible flow.
//
// v1 is monthly + yearly subscriptions only. No metered overage, no
// audit log, no admin gates: subscribe → pay → plan flips on the
// `customer.subscription.created` webhook, no human in the loop.

// ─────────────────────────────────────────────────────────────────────
// `subscription` — managed by @better-auth/stripe; we mirror the
// definition here so reads stay type-safe via drizzle. The plugin
// performs all writes via the better-auth adapter; we treat this
// table as read-only from app code.
// ─────────────────────────────────────────────────────────────────────

export const subscriptions = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    /** Plan name from src/lib/billing/plans.ts (e.g. 'starter', 'pro'). */
    plan: text("plan").notNull(),
    /** Our internal teamId — set via plugin's `customerType: 'organization'`. */
    referenceId: text("referenceId").notNull(),
    stripeCustomerId: text("stripeCustomerId"),
    stripeSubscriptionId: text("stripeSubscriptionId"),
    status: text("status").$type<SubscriptionStatus>().default("incomplete"),
    periodStart: timestamp("periodStart"),
    periodEnd: timestamp("periodEnd"),
    trialStart: timestamp("trialStart"),
    trialEnd: timestamp("trialEnd"),
    cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false),
    cancelAt: timestamp("cancelAt"),
    canceledAt: timestamp("canceledAt"),
    endedAt: timestamp("endedAt"),
    // Written by @better-auth/stripe on every subscription create/update
    // (member count for org subs / quantity = 1 otherwise). We don't bill
    // per seat and never read this, but the column must exist or the
    // plugin's adapter writes fail — so it stays as part of the plugin's
    // managed table, not something we added.
    seats: integer("seats"),
    billingInterval: text("billingInterval"),
    stripeScheduleId: text("stripeScheduleId"),
  },
  (table) => [
    index("idx_subscription_reference").on(table.referenceId),
    index("idx_subscription_stripe_sub").on(table.stripeSubscriptionId),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type StripeWebhookEventStatus = "received" | "processed" | "failed";

export const stripeWebhookEvents = pgTable(
  "stripe_webhook_events",
  {
    // Stripe's `evt_*` event ID — globally unique per delivery, guarantees
    // idempotency across retries (Stripe Standard Webhooks spec).
    eventId: text("event_id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at")
      .$defaultFn(() => new Date())
      .notNull(),
    processedAt: timestamp("processed_at"),
    error: text("error"),
  },
  (table) => [
    index("idx_stripe_webhook_events_type").on(table.type),
    index("idx_stripe_webhook_events_received").on(table.receivedAt),
  ],
);

export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type NewStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;
