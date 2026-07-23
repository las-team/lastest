/**
 * @lastest/eb-protocol — the wire protocol between the Lastest app and its
 * browser runners (embedded browser pods + remote runners).
 *
 * Single source of truth for:
 *   - command / response / status messages exchanged over the runner channel
 *     (`/api/ws/runner` long-poll: commands dispatched in heartbeat responses,
 *     results POSTed back)
 *   - the HTTP envelope shapes of the register/connect/heartbeat endpoints
 *   - embedded-browser stream messages (screencast frames, input forwarding)
 *   - JSON payload shapes that cross the wire AND are persisted verbatim into
 *     jsonb columns (DOM snapshots, a11y/design-system violations, assertion
 *     results) — `src/lib/db/schema.ts` re-exports these so app code keeps
 *     importing them alongside the row types they are stored in.
 *
 * Consumed as TypeScript source (no build step), same as `@lastest/shared`:
 * the app transpiles it via `transpilePackages`, the embedded browser bundles
 * it via tsup `noExternal`.
 */

import type {
  CoreStabilizationSettings,
  SelectorOutcome,
  SelectorStatRow,
} from "@lastest/shared";

export type StabilizationPayload = CoreStabilizationSettings;
export type { SelectorOutcome, SelectorStatRow };

// ============================================
// Shared Wire Data Types
// ============================================
// Produced by the runner, consumed AND persisted by the app (jsonb columns).

// DOM snapshot element captured during recording or test execution
export interface DomSnapshotElement {
  tag: string;
  id?: string;
  textContent?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  selectors: Array<{ type: string; value: string }>;
  // Curated computed styles (color, padding, font, …), captured by the
  // embedded browser only when style capture is enabled. Drives RCA CSS-delta
  // drill-down; absent on snapshots predating the feature.
  styles?: Record<string, string>;
}

// Full DOM snapshot with page context
export interface DomSnapshotData {
  elements: DomSnapshotElement[];
  url: string;
  timestamp: number;
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

export type DesignTokenCategory =
  | "color" // any color computed property (color, background-color, border-color, fill, stroke)
  | "border-radius" // border-*-radius
  | "font-family" // font-family (first family in stack)
  | "font-size" // font-size (px)
  | "spacing"; // margin-*, padding-*, gap (px)

export interface DesignToken {
  /** Display name — typically the CSS custom property (`--c-red`) or a
   *  human label ("Brand Red"). Used in violation messages. */
  name: string;
  /** Resolved value — normalized: hex for colors ("#e03e36"), int+"px"
   *  for radii/sizes/spacing, lowercase family name for font. */
  value: string;
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

export interface AssertionResult {
  assertionId: string;
  status: "passed" | "failed" | "skipped";
  actualValue?: string;
  errorMessage?: string;
  durationMs?: number;
}

/** Per-category, per-value usage counter — `usage.color['#e03e36'] = 12`
 *  means twelve elements rendered with that color across the captured DOM.
 *  Used by the verify Design review panel to light up tokens that were
 *  actually used and dim tokens the page never rendered. */
export type DesignSystemTokenUsage = Partial<
  Record<DesignTokenCategory, Record<string, number>>
>;

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

/** Per-request summary shipped inline on the test result. Full headers/bodies
 *  travel separately via `response:network_bodies` (they can be megabytes). */
export interface NetworkRequestSummary {
  url: string;
  method: string;
  status: number;
  duration: number;
  resourceType: string;
  startTime?: number;
  failed?: boolean;
  errorText?: string;
  responseSize?: number;
}

/** Redacted capture of the page's cookies + localStorage taken after the test
 *  body ran. Values are hashed (never raw) unless parseable as inert JSON. */
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

// ============================================
// Base Message Types
// ============================================

export type MessageType =
  // Server → Agent (Commands)
  | "command:run_test"
  | "command:run_setup"
  | "command:cancel_test"
  | "command:start_recording"
  | "command:stop_recording"
  | "command:create_assertion"
  | "command:create_wait"
  | "command:flag_download"
  | "command:insert_timestamp"
  | "command:promote_selector"
  | "command:start_debug"
  | "command:debug_action"
  | "command:stop_debug"
  | "command:ping"
  | "command:shutdown"
  // Agent → Server (Responses)
  | "response:test_result"
  | "response:test_progress"
  | "response:step_event"
  | "response:setup_result"
  | "response:recording_event"
  | "response:recording_stopped"
  | "response:debug_state"
  | "command:capture_screenshot"
  | "response:screenshot"
  | "response:screenshot_text"
  | "response:screenshot_ack"
  | "response:network_bodies"
  | "response:error"
  | "response:pong"
  | "response:command_ack"
  // Status
  | "status:heartbeat"
  | "connection:established"
  // Embedded Browser Streaming
  | "stream:frame"
  | "stream:input"
  | "stream:session"
  | "stream:status"
  | "stream:inspect_element_request"
  | "stream:inspect_element_response"
  | "stream:dom_snapshot_request"
  | "stream:dom_snapshot_response"
  | "stream:inspect_mode"
  | "stream:action_progress";

export interface BaseMessage {
  id: string;
  type: MessageType;
  timestamp: number;
}

// ============================================
// Server → Agent Commands
// ============================================

export interface ServerConfig {
  command: string;
  cwd: string;
  healthCheckUrl: string;
  healthCheckTimeout: number;
}

export interface RunTestCommandPayload {
  testId: string;
  testRunId: string;
  code: string;
  codeHash: string; // SHA256 hash of code for integrity verification
  targetUrl: string;
  screenshotPath: string;
  timeout: number;
  repositoryId?: string; // For screenshot storage location
  viewport?: {
    width: number;
    height: number;
  };
  serverConfig?: ServerConfig;
  storageState?: string; // Serialized JSON from page.context().storageState() — carries auth session
  setupVariables?: Record<string, unknown>; // Variables from setup scripts
  cursorPlaybackSpeed?: number; // 0 = instant (skip delays), 1 = realtime
  stabilization?: StabilizationPayload;
  browser?: "chromium" | "firefox" | "webkit";
  fixtures?: Array<{ filename: string; data: string }>; // base64-encoded fixture files
  grantClipboardAccess?: boolean;
  acceptDownloads?: boolean;
  headed?: boolean;
  forceVideoRecording?: boolean;
  recordingViewport?: { width: number; height: number };
  lockViewportToRecording?: boolean;
  consoleErrorMode?: "fail" | "warn" | "ignore";
  networkErrorMode?: "fail" | "warn" | "ignore";
  ignoreExternalNetworkErrors?: boolean;
  enableNetworkInterception?: boolean;
  /** Hostname substrings whose console errors the EB drops BEFORE applying
   *  consoleErrorMode. Mirrors the post-hoc 3rd-party classifier in
   *  src/lib/comparison/console-diff.ts; moved upstream so noisy 3rd-party SDKs
   *  (Cloudflare email-decoder, Sentry CDN, Segment, etc.) don't red customer-app
   *  demos. The "any in-scope console error = fail" rule is preserved. */
  consoleErrorIgnoreHosts?: string[];
  /** When set, override Chromium's default User-Agent on every newContext().
   *  Pass a current stable Chrome string to bypass HeadlessChrome-based bot
   *  detection (Cloudflare Turnstile, Clerk, several SaaS edge routers).
   *  Null/undefined preserves stock Playwright UA. */
  userAgentOverride?: string;
  /** When true, the EB harvests `window.__urlDiffResult` after the body runs
   *  and returns `a11yViolations`/`a11yPassesCount`/`accessibilityTree` on
   *  the test result. Used by the URL Diff feature. */
  enableA11y?: boolean;
  /** Design-system token config. When `tokens` is non-empty the EB walks
   *  the live DOM after the test body and returns `designSystemViolations`
   *  + `designSystemRulesChecked` on the test result. */
  designSystem?: {
    tokens: Partial<Record<DesignTokenCategory, DesignToken[]>>;
    ignoredCategories?: DesignTokenCategory[];
    maxViolationsPerScreenshot?: number;
  };
  // Extract-mode TestVariables — runner reads these page fields after the test body runs.
  extractVariables?: Array<{
    name: string;
    targetSelector: string;
    attribute?: "value" | "textContent" | "innerText" | "innerHTML";
  }>;
  // When true, the runner re-throws TypeError / ReferenceError / SyntaxError
  // from the soft-wrap so a broken test body fails the run instead of being
  // recorded as a soft warning. Driven by the test's `all_steps_executed`
  // Criteria rule (default ON, off only when user explicitly opted out).
  failOnRuntimeError?: boolean;
  /** Parsed steps from `parseSteps(body)`. When present, the runner emits
   *  `response:step_event` messages keyed by step index so the host can
   *  render a live step timeline. Order-sensitive — index N corresponds to
   *  the N-th step in this array. */
  steps?: Array<{
    id: number;
    label: string;
    lineStart: number;
    lineEnd: number;
    type:
      | "action"
      | "navigation"
      | "assertion"
      | "screenshot"
      | "wait"
      | "variable"
      | "log"
      | "other";
  }>;
  /** Parsed assertions from `parseAssertions(code)`. Runner uses these to
   *  wrap each `expect(...)` line with a structured pass/fail recorder
   *  keyed by the host-computed `id`. Order-sensitive — must match the
   *  source order produced by the parser. */
  assertions?: Array<{
    id: string;
    codeLineStart?: number;
    codeLineEnd?: number;
  }>;
  /** All `selector_stats` rows for this test, used by the runner's
   *  `locateWithFallback` to sort fallback candidates by historical
   *  success rate before iterating. Empty / omitted on first run for
   *  a test — runner falls back to the original captured order. The
   *  hash field on each row is the FNV-1a of the original (pre-sort)
   *  selectors array (`hashSelectors` in `@lastest/shared`). */
  selectorStats?: SelectorStatRow[];
  /** Default per-candidate `waitFor` budget for `locateWithFallback`
   *  (ms). Resolved on the host as
   *  `pwOverrides.selectorTimeoutMs ?? playwrightSettings.selectorTimeoutMs ?? 3000`.
   *  Each runner additionally short-circuits known-slow selectors via
   *  `selectorTimeoutFor` from `@lastest/shared`. */
  selectorTimeoutMs?: number;
  /** Capture page innerText alongside each screenshot for downstream
   *  text-diff. Resolved from the repo's diff sensitivity settings. */
  textCaptureEnabled?: boolean;
}

export interface RunTestCommand extends BaseMessage {
  type: "command:run_test";
  payload: RunTestCommandPayload;
}

export interface RunSetupCommandPayload {
  setupId: string;
  code: string;
  codeHash: string;
  targetUrl: string;
  timeout: number;
  viewport?: {
    width: number;
    height: number;
  };
  stabilization?: StabilizationPayload;
  browser?: "chromium" | "firefox" | "webkit";
  // Debug-mode flag: when true, the EB keeps the CDP screencast attached to
  // the setup page so the user can watch setup execute live (login flow,
  // OAuth redirects). Default false preserves the CPU-saving behavior of
  // headless batch runs.
  headed?: boolean;
  /** Mirror of RunTestCommandPayload.userAgentOverride — must apply to setup too
   *  so the auth handshake runs with the same UA as the downstream tests. */
  userAgentOverride?: string;
}

export interface RunSetupCommand extends BaseMessage {
  type: "command:run_setup";
  payload: RunSetupCommandPayload;
}

export interface SetupResultPayload {
  correlationId: string;
  status: "passed" | "failed" | "error" | "timeout";
  storageState?: string;
  // Serialized JSON of the captured storageState. `storageState` may be a
  // "persistent:<setupId>" marker; debug-executor and other non-test consumers
  // need the real JSON here instead.
  storageStateJson?: string;
  variables?: Record<string, unknown>;
  durationMs: number;
  error?: string;
  logs: LogEntry[];
}

export interface SetupResultResponse extends BaseMessage {
  type: "response:setup_result";
  payload: SetupResultPayload;
}

export interface StartRecordingCommandPayload {
  sessionId: string;
  targetUrl: string;
  viewport?: { width: number; height: number };
  browser?: "chromium" | "firefox" | "webkit";
  selectorPriority?: Array<{
    type: string;
    enabled: boolean;
    priority: number;
  }>;
  ocrEnabled?: boolean;
  pointerGestures?: boolean;
  cursorFPS?: number;
  setupSteps?: Array<{ code: string; codeHash: string }>;
}

export interface StartRecordingCommand extends BaseMessage {
  type: "command:start_recording";
  payload: StartRecordingCommandPayload;
}

export interface StopRecordingCommand extends BaseMessage {
  type: "command:stop_recording";
  payload: {
    sessionId: string;
  };
}

export interface PingCommand extends BaseMessage {
  type: "command:ping";
  payload: Record<string, never>;
}

export interface CancelTestCommandPayload {
  testRunId: string;
  reason: string;
}

export interface CancelTestCommand extends BaseMessage {
  type: "command:cancel_test";
  payload: CancelTestCommandPayload;
}

export interface ShutdownCommandPayload {
  reason?: string;
}

export interface ShutdownCommand extends BaseMessage {
  type: "command:shutdown";
  payload: ShutdownCommandPayload;
}

// ============================================
// Agent → Server Responses
// ============================================

export interface LogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface TestProgressPayload {
  correlationId: string;
  step: string;
  progress: number;
}

export interface TestProgressResponse extends BaseMessage {
  type: "response:test_progress";
  payload: TestProgressPayload;
}

export interface StepEventPayload {
  correlationId: string;
  testRunId: string;
  stepIndex: number;
  totalSteps: number;
  status: "started" | "passed" | "failed";
  label?: string;
  stepType?:
    | "action"
    | "navigation"
    | "assertion"
    | "screenshot"
    | "wait"
    | "variable"
    | "log"
    | "other";
  durationMs?: number;
  error?: string;
}

export interface StepEventResponse extends BaseMessage {
  type: "response:step_event";
  payload: StepEventPayload;
}

export interface TestResultPayload {
  correlationId: string;
  testId: string;
  testRunId: string;
  /** Echo of the run command's repositoryId (screenshot storage routing). */
  repositoryId?: string;
  status: "passed" | "failed" | "error" | "timeout" | "cancelled";
  durationMs: number;
  screenshotCount?: number; // Number of screenshots to expect (for early completion detection)
  error?: {
    message: string;
    stack?: string;
    screenshot?: string; // Base64 error screenshot
  };
  logs: LogEntry[];
  /** Console errors surfaced during the run (post third-party filtering). */
  consoleErrors?: string[];
  /** Per-request summaries; full bodies arrive via `response:network_bodies`. */
  networkRequests?: NetworkRequestSummary[];
  softErrors?: string[];
  /** Per-`expect()` outcome rows produced by the runner's assertion tracker.
   *  `assertionId` matches one of the `assertions[].id` sent in the run
   *  command. The criteria evaluator keys on these to fail the test when a
   *  user-pinned assertion failed. */
  assertionResults?: AssertionResult[];
  videoData?: string; // base64-encoded video file
  videoFilename?: string;
  lastReachedStep?: number;
  totalSteps?: number;
  domSnapshot?: DomSnapshotData; // DOM state captured after test body ran
  /** axe-core violations harvested from the page (URL-Diff feature). Only
   *  populated when the run command sets `enableA11y: true`. */
  a11yViolations?: A11yViolation[];
  a11yPassesCount?: number;
  /** Playwright `page.accessibility.snapshot()` output (URL-Diff feature).
   *  May be `{ _truncated: true, byteLength }` if the EB capped the payload. */
  accessibilityTree?: unknown;
  /** Off-token computed-CSS values found by the design-system walk. Only
   *  populated when the run command carried a `designSystem` config with a
   *  non-empty token set. */
  designSystemViolations?: DesignSystemViolation[];
  designSystemRulesChecked?: number;
  designSystemTokenUsage?: DesignSystemTokenUsage;
  /** Per-step URL trajectory + Web Vitals (multi-layer capture, v1.13) —
   *  the only source of `layers.url` / `layers.perf` evidence on the host. */
  urlTrajectory?: UrlTrajectoryStep[];
  webVitals?: WebVitalsSample[];
  extractedVariables?: Record<string, string>; // Values pulled from page fields by extract-mode TestVariables
  /** Per-attempt selector outcomes from `locateWithFallback`. The host
   *  ingests these into `selector_stats` so the next run can promote the
   *  winning candidate. Best-effort — failures swallowed on the host. */
  selectorOutcomes?: SelectorOutcome[];
  /** Redacted cookies/localStorage capture taken after the test body ran. */
  storageStateSnapshot?: StorageStateSnapshot;
}

export interface TestResultResponse extends BaseMessage {
  type: "response:test_result";
  payload: TestResultPayload;
}

export interface RecordingEventData {
  type: "click" | "fill" | "navigate" | "screenshot" | "scroll" | "hover";
  timestamp: number;
  target?: {
    selector: string;
    alternatives: string[];
    text?: string;
    tagName: string;
  };
  value?: string;
  url?: string;
  position?: { x: number; y: number };
}

/** Match-count signal for a single candidate selector, evaluated against the
 *  live DOM right after an action lands. count = -1 means "not cheaply
 *  countable" (role-name / text selectors); 0 = stale/missing; 1 = unique;
 *  >1 = ambiguous (autorepair will prefer a unique sibling if one exists). */
export interface RecordingSelectorMatch {
  type: string;
  value: string;
  count: number;
}

export interface RecordingEventPayload {
  sessionId: string;
  events: Array<{
    type: string;
    timestamp: number;
    sequence: number;
    status: "preview" | "committed";
    verification?: {
      syntaxValid: boolean;
      domVerified?: boolean;
      lastChecked?: number;
      /** Per-selector match counts captured by the in-page verifier. */
      selectorMatches?: RecordingSelectorMatch[];
      /** The selector autorepair settled on (most-unique). May differ from
       *  data.selector if the recorder picked the wrong primary first. */
      chosenSelector?: string;
      /** True when the original primary differed from chosenSelector — i.e.
       *  the in-page autorepair promoted a more specific candidate. */
      autoRepaired?: boolean;
    };
    data: Record<string, unknown>;
  }>;
}

export interface RecordingEventResponse extends BaseMessage {
  type: "response:recording_event";
  payload: RecordingEventPayload;
}

export interface RecordingStoppedPayload {
  sessionId: string;
  generatedCode: string;
  domSnapshot?: DomSnapshotData; // DOM state captured on the recording page before stop
}

export interface RecordingStoppedResponse extends BaseMessage {
  type: "response:recording_stopped";
  payload: RecordingStoppedPayload;
}

export interface CreateAssertionCommandPayload {
  sessionId: string;
  assertionType: string;
}

export interface CreateAssertionCommand extends BaseMessage {
  type: "command:create_assertion";
  payload: CreateAssertionCommandPayload;
}

export type WaitType = "duration" | "selector";
export type WaitSelectorCondition = "visible" | "hidden";

export interface CreateWaitCommandPayload {
  sessionId: string;
  waitType: WaitType;
  durationMs?: number;
  selector?: string;
  selectors?: Array<{ type: string; value: string }>;
  condition?: WaitSelectorCondition;
  timeoutMs?: number;
}

export interface CreateWaitCommand extends BaseMessage {
  type: "command:create_wait";
  payload: CreateWaitCommandPayload;
}

export interface FlagDownloadCommandPayload {
  sessionId: string;
}

export interface FlagDownloadCommand extends BaseMessage {
  type: "command:flag_download";
  payload: FlagDownloadCommandPayload;
}

export interface InsertTimestampCommand extends BaseMessage {
  type: "command:insert_timestamp";
  payload: { sessionId: string };
}

export interface PromoteSelectorCommandPayload {
  sessionId: string;
  actionId: string;
  selectorValue: string;
}

export interface PromoteSelectorCommand extends BaseMessage {
  type: "command:promote_selector";
  payload: PromoteSelectorCommandPayload;
}

// ============================================
// Debug Commands & Responses
// ============================================

export interface DebugStep {
  id: number;
  code: string;
  label: string;
  lineStart: number;
  lineEnd: number;
  type:
    | "action"
    | "navigation"
    | "assertion"
    | "screenshot"
    | "wait"
    | "variable"
    | "log"
    | "other";
}

export interface DebugStepResult {
  stepId: number;
  status: "passed" | "failed" | "pending";
  durationMs: number;
  error?: string;
}

export interface StartDebugCommandPayload {
  sessionId: string;
  testId: string;
  code: string;
  cleanBody: string;
  steps: DebugStep[];
  targetUrl: string;
  viewport?: { width: number; height: number };
  storageState?: string;
  setupVariables?: Record<string, unknown>;
  stabilization?: StabilizationPayload;
  selectorPriority?: Array<{
    type: string;
    enabled: boolean;
    priority: number;
  }>;
  pointerGestures?: boolean;
  cursorFPS?: number;
}

export interface StartDebugCommand extends BaseMessage {
  type: "command:start_debug";
  payload: StartDebugCommandPayload;
}

export interface DebugActionCommandPayload {
  sessionId: string;
  action:
    | "step_forward"
    | "step_back"
    | "run_to_end"
    | "run_to_step"
    | "update_code"
    | "start_recording"
    | "stop_recording"
    // Floating recording-control equivalents for an active "record from here"
    // debug session. These mirror the repo-scoped recording actions in
    // src/server/actions/recording.ts (captureScreenshot / createAssertion /
    // flagDownload / insertTimestamp / createWait / togglePauseRecording) but
    // route through the debug command queue and act on the debug executor's
    // attached recorder rather than a standalone recording session.
    | "recording_screenshot"
    | "recording_assertion"
    | "recording_flag_download"
    | "recording_insert_timestamp"
    | "recording_insert_wait"
    | "recording_toggle_pause";
  stepIndex?: number;
  code?: string;
  cleanBody?: string;
  steps?: DebugStep[];
  spliceMode?: "replace" | "insert";
  // recording_assertion — which page-level assertion to record (matches
  // AssertionType in src/lib/playwright/types.ts).
  assertionType?: "pageLoad" | "networkIdle" | "urlMatch" | "domContentLoaded";
  // recording_insert_wait — wait params (matches WaitParams in
  // src/lib/playwright/types.ts and the existing CreateWaitCommand payload).
  waitType?: "duration" | "selector";
  durationMs?: number;
  selector?: string;
  selectors?: Array<{ type: string; value: string }>;
  condition?: "visible" | "hidden";
  timeoutMs?: number;
}

export interface DebugActionCommand extends BaseMessage {
  type: "command:debug_action";
  payload: DebugActionCommandPayload;
}

export interface StopDebugCommandPayload {
  sessionId: string;
}

export interface StopDebugCommand extends BaseMessage {
  type: "command:stop_debug";
  payload: StopDebugCommandPayload;
}

export type DebugRecordingAnchorReason =
  | "cursor"
  | "last_passing"
  | "fallback_cursor";

export interface DebugStateResponsePayload {
  sessionId: string;
  testId: string;
  status:
    | "initializing"
    | "paused"
    | "stepping"
    | "running"
    | "completed"
    | "error";
  currentStepIndex: number;
  steps: DebugStep[];
  stepResults: DebugStepResult[];
  code: string;
  error?: string;
  codeVersion: number;
  isRecording: boolean;
  recordedEventCount: number;
  recordingAnchorIndex?: number;
  recordingAnchorReason?: DebugRecordingAnchorReason;
  spliceMode?: "replace" | "insert";
  targetUrl?: string;
  pendingRecordingEvents?: RecordingEventPayload["events"];
  // Live, not-yet-spliced recording buffer reported on every tick while
  // recording so the UI can render the timeline as actions happen.
  recordingEvents?: RecordingEventPayload["events"];
}

export interface DebugStateResponse extends BaseMessage {
  type: "response:debug_state";
  payload: DebugStateResponsePayload;
}

export interface CaptureScreenshotCommand extends BaseMessage {
  type: "command:capture_screenshot";
  payload: { sessionId: string };
}

export interface ScreenshotUploadPayload {
  correlationId: string;
  testRunId: string;
  repositoryId?: string; // For screenshot storage location
  filename: string;
  data: string; // Base64 PNG
  width: number;
  height: number;
  capturedAt: number;
  // Offset of this capture into the recording (ms): capture time minus
  // video-recording start. Persisted onto the screenshot row + used by the
  // public share page's "In this video" chapter rail. Optional — absent for
  // non-recorded runs and ad-hoc/recorder captures.
  atMs?: number;
  // Cosmetic chapter title from the test's screenshot-path slug. Decorative
  // only — the diff/baseline key stays the filename/label.
  title?: string;
  // Per-step DOM snapshot captured at this screenshot's moment, so the host can
  // compute a per-step DOM diff aligned with this screenshot. Optional.
  domSnapshot?: DomSnapshotData;
}

/** Ad-hoc capture result (`command:capture_screenshot` during a recording or
 *  debug session). Unlike run screenshots there is no testRunId — the capture
 *  is keyed to the command's correlationId only. Success carries the image
 *  inline; failure carries `error` and nothing else. */
export interface AdHocScreenshotPayload {
  correlationId: string;
  filename?: string;
  data?: string; // Base64 PNG
  width?: number;
  height?: number;
  capturedAt?: number;
  error?: string;
}

export interface ScreenshotUploadResponse extends BaseMessage {
  type: "response:screenshot";
  payload: ScreenshotUploadPayload | AdHocScreenshotPayload;
}

export interface ScreenshotTextUploadPayload {
  correlationId: string;
  testRunId: string;
  repositoryId?: string;
  filename: string; // matches the screenshot filename with `.txt` extension
  data: string; // Base64 UTF-8 text
  capturedAt: number;
}

export interface ScreenshotTextUploadResponse extends BaseMessage {
  type: "response:screenshot_text";
  payload: ScreenshotTextUploadPayload;
}

export interface ScreenshotAckPayload {
  correlationId: string;
  storagePath: string;
}

export interface ScreenshotAckResponse extends BaseMessage {
  type: "response:screenshot_ack";
  payload: ScreenshotAckPayload;
}

export interface NetworkBodiesPayload {
  correlationId: string;
  testId: string;
  testRunId: string;
  repositoryId?: string;
  networkRequests: unknown;
}

export interface NetworkBodiesResponse extends BaseMessage {
  type: "response:network_bodies";
  payload: NetworkBodiesPayload;
}

export type ErrorCode =
  | "BROWSER_LAUNCH_FAILED"
  | "TEST_TIMEOUT"
  | "NAVIGATION_FAILED"
  | "SELECTOR_NOT_FOUND"
  | "SERVER_START_FAILED"
  | "SCREENSHOT_FAILED"
  | "UNKNOWN_COMMAND"
  | "INTERNAL_ERROR"
  | "AUTH_FAILED";

export interface ErrorPayload {
  correlationId?: string;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ErrorResponse extends BaseMessage {
  type: "response:error";
  payload: ErrorPayload;
}

export interface PongPayload {
  correlationId: string;
}

export interface PongResponse extends BaseMessage {
  type: "response:pong";
  payload: PongPayload;
}

// Sent by the runner as the FIRST action inside its onCommand handler, before
// any actual work. Confirms receipt of a dispatched command so the server can
// flip the runner_commands row from status='pending' (dispatched) to 'claimed'.
// Without this ack the server's stale-claim reaper would redispatch the row
// every REDISPATCH_TTL window.
export interface CommandAckPayload {
  commandId: string;
}

export interface CommandAckResponse extends BaseMessage {
  type: "response:command_ack";
  payload: CommandAckPayload;
}

// ============================================
// Status Messages
// ============================================

export interface SystemInfo {
  platform: string;
  memory: { used: number; total: number };
  uptime: number;
}

export interface HeartbeatPayload {
  status: "idle" | "busy" | "recording" | "debugging";
  currentTask?: string;
  systemInfo: SystemInfo;
  disconnect?: boolean; // Signal graceful shutdown
}

export interface HeartbeatMessage extends BaseMessage {
  type: "status:heartbeat";
  payload: HeartbeatPayload;
}

export interface ConnectionEstablishedPayload {
  runnerId: string;
  teamId: string;
  capabilities: string[];
  /** @deprecated Use runnerId instead */
  agentId?: string;
}

export interface ConnectionEstablishedMessage extends BaseMessage {
  type: "connection:established";
  payload: ConnectionEstablishedPayload;
}

// ============================================
// Union Types
// ============================================

export type ServerCommand =
  | RunTestCommand
  | RunSetupCommand
  | CancelTestCommand
  | ShutdownCommand
  | StartRecordingCommand
  | StopRecordingCommand
  | CreateAssertionCommand
  | CreateWaitCommand
  | FlagDownloadCommand
  | InsertTimestampCommand
  | PromoteSelectorCommand
  | CaptureScreenshotCommand
  | StartDebugCommand
  | DebugActionCommand
  | StopDebugCommand
  | PingCommand;

export type AgentResponse =
  | TestProgressResponse
  | StepEventResponse
  | TestResultResponse
  | SetupResultResponse
  | RecordingEventResponse
  | RecordingStoppedResponse
  | ScreenshotUploadResponse
  | ScreenshotTextUploadResponse
  | NetworkBodiesResponse
  | DebugStateResponse
  | ErrorResponse
  | PongResponse
  | CommandAckResponse
  | HeartbeatMessage;

export type Message =
  | ServerCommand
  | AgentResponse
  | SetupResultResponse
  | ScreenshotAckResponse
  | DebugStateResponse
  | ConnectionEstablishedMessage;

// ============================================
// HTTP Transport Envelope
// ============================================
// Response shapes of the app's runner endpoints. The runner channel is plain
// HTTP: GET /api/ws/runner to connect, POST /api/ws/runner for heartbeats and
// responses (commands ride back on heartbeat responses), and the two register
// endpoints for embedded browsers.

/** GET /api/ws/runner */
export interface RunnerConnectResponse {
  runnerId: string;
  teamId: string;
  sessionId: string;
  capabilities?: string[];
  commands?: ServerCommand[];
}

/** POST /api/ws/runner (status:heartbeat) */
export interface RunnerHeartbeatResponse {
  commands?: ServerCommand[];
}

/** POST /api/embedded/register — pre-issued runner token auth */
export interface EmbeddedRegisterResponse {
  sessionId: string;
  runnerId: string;
}

/** POST /api/embedded/auto-register — SYSTEM_EB_TOKEN auth; `token` is the
 *  per-runner token the EB must use for all subsequent runner-channel calls. */
export interface EmbeddedAutoRegisterResponse {
  runnerId: string;
  token: string;
  sessionId: string;
}

// ============================================
// Helper Functions
// ============================================

export function createMessage<T extends Message>(
  type: T["type"],
  payload: T["payload"],
): T {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: Date.now(),
    payload,
  } as unknown as T;
}

export function isServerCommand(msg: Message): msg is ServerCommand {
  return msg.type.startsWith("command:");
}

export function isAgentResponse(msg: Message): msg is AgentResponse {
  return msg.type.startsWith("response:") || msg.type.startsWith("status:");
}

// ============================================
// Embedded Browser Streaming Types
// ============================================

/** Server → Client: CDP screencast frame */
export interface ScreencastFrameMessage extends BaseMessage {
  type: "stream:frame";
  payload: {
    data: string; // base64 JPEG
    width: number;
    height: number;
    timestamp: number;
  };
}

/** Client → Server: Mouse/keyboard input forwarding */
export interface StreamInputMessage extends BaseMessage {
  type: "stream:input";
  payload:
    | StreamMouseEvent
    | StreamKeyboardEvent
    | StreamFileUploadEvent
    | StreamClipboardEvent
    | StreamTouchEvent;
}

export interface StreamMouseEvent {
  type: "mouse";
  action: "move" | "down" | "up" | "wheel";
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  // Authoritative modifier state sampled from the browser event itself.
  // Without it the EB infers modifiers from previously-forwarded keyboard
  // events — if a modifier keyup is lost (focus left the canvas while the key
  // was held), that state sticks and every later click dispatches as
  // Ctrl/Alt+click, which links treat as open-in-new-tab (the page visibly
  // ignores the click).
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
}

export interface StreamKeyboardEvent {
  type: "keyboard";
  action: "keydown" | "keyup" | "type";
  key: string;
  code?: string;
  text?: string;
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
}

export interface StreamFileUploadEvent {
  type: "file_upload";
  files: Array<{ name: string; data: string; mimeType: string }>; // base64 data
}

export interface StreamClipboardEvent {
  type: "clipboard_paste";
  text: string;
}

export interface StreamTouchEvent {
  type: "touch";
  action: "start" | "move" | "end" | "cancel";
  touches: Array<{ x: number; y: number; id: number }>;
}

/** Client → Server / Server → Client: Session lifecycle control */
export interface StreamSessionMessage extends BaseMessage {
  type: "stream:session";
  payload:
    | { action: "start" | "stop" }
    | { action: "resize"; viewport: { width: number; height: number } }
    | { action: "navigate"; url: string };
}

/** Server → Client: Stream connection status */
export interface StreamStatusMessage extends BaseMessage {
  type: "stream:status";
  payload: {
    status: "connected" | "disconnected" | "error";
    currentUrl?: string;
    viewport?: { width: number; height: number };
    error?: string;
    fileChooserPending?: boolean;
  };
}

/** Client → Server: Request selectors for element at coordinates */
export interface InspectElementRequestMessage extends BaseMessage {
  type: "stream:inspect_element_request";
  payload: { x: number; y: number };
}

/** Server → Client: Selectors for inspected element */
export interface InspectElementResponseMessage extends BaseMessage {
  type: "stream:inspect_element_response";
  payload: {
    element: {
      tag: string;
      id?: string;
      textContent?: string;
      boundingBox: { x: number; y: number; width: number; height: number };
      selectors: Array<{ type: string; value: string }>;
    } | null;
  };
}

/** Client → Server: Request full DOM selector snapshot */
export interface DomSnapshotRequestMessage extends BaseMessage {
  type: "stream:dom_snapshot_request";
}

/** Server → Client: Full DOM snapshot with all interactive elements */
export interface DomSnapshotResponseMessage extends BaseMessage {
  type: "stream:dom_snapshot_response";
  payload: {
    elements: Array<{
      tag: string;
      id?: string;
      textContent?: string;
      boundingBox: { x: number; y: number; width: number; height: number };
      selectors: Array<{ type: string; value: string }>;
    }>;
    url: string;
    timestamp: number;
  };
}

/** Client → Server: Toggle inspect mode (suppresses input forwarding on EB side) */
export interface InspectModeMessage extends BaseMessage {
  type: "stream:inspect_mode";
  payload: { enabled: boolean };
}

/** Server → Client: An action with a deadline is in flight (selector wait,
 *  page-load wait, fallback click). Viewers render a decreasing countdown
 *  bar locally from `timeoutMs` starting at message receipt — no per-tick
 *  updates are sent. `active: false` clears the bar (also auto-expires
 *  client-side after timeoutMs as a safety net). */
export interface StreamActionProgressPayload {
  active: boolean;
  label?: string;
  kind?: "selector" | "wait" | "navigation" | "fallback";
  timeoutMs?: number;
  /** Instrumented step the operation runs inside (-1 before the first step)
   *  — lets UIs attach the countdown to the matching timeline row. */
  stepIndex?: number;
}

export interface StreamActionProgressMessage extends BaseMessage {
  type: "stream:action_progress";
  payload: StreamActionProgressPayload;
}

export type StreamMessage =
  | ScreencastFrameMessage
  | StreamInputMessage
  | StreamSessionMessage
  | StreamStatusMessage
  | InspectElementRequestMessage
  | InspectElementResponseMessage
  | DomSnapshotRequestMessage
  | DomSnapshotResponseMessage
  | InspectModeMessage
  | StreamActionProgressMessage;

export function isStreamMessage(msg: { type: string }): boolean {
  return msg.type.startsWith("stream:");
}
