import type {
  NetworkRequest,
  DownloadRecord,
  A11yViolation,
  DesignSystemViolation,
  DesignSystemTokenUsage,
  AssertionResult,
  DomSnapshotData,
  UrlTrajectoryStep,
  WebVitalsSample,
  StorageStateSnapshot,
} from "@/lib/db/schema";

export interface CapturedScreenshot {
  path: string;
  label?: string;
}

export interface TestRunResult {
  testId: string;
  status: "passed" | "failed" | "skipped" | "setup_failed";
  durationMs: number;
  screenshotPath?: string;
  screenshots: CapturedScreenshot[];
  errorMessage?: string;
  consoleErrors?: string[];
  networkRequests?: NetworkRequest[];
  a11yViolations?: A11yViolation[];
  a11yPassesCount?: number;
  designSystemViolations?: DesignSystemViolation[];
  designSystemRulesChecked?: number;
  designSystemTokenUsage?: DesignSystemTokenUsage;
  assertionResults?: AssertionResult[];
  setupDurationMs?: number;
  teardownDurationMs?: number;
  teardownError?: string;
  stabilityMetadata?: {
    frameCount: number;
    stableFrames: number;
    maxFrameDiff: number;
    isStable: boolean;
  };
  videoPath?: string;
  softErrors?: string[];
  networkBodiesPath?: string;
  downloads?: DownloadRecord[];
  domSnapshot?: DomSnapshotData;
  lastReachedStep?: number;
  totalSteps?: number;
  extractedVariables?: Record<string, string>;
  assignedVariables?: Record<string, string>;
  logs?: Array<{ timestamp: number; level: string; message: string }>;
  // ── Multi-layer comparison capture (v1.13) ─────────────────────────────
  urlTrajectory?: UrlTrajectoryStep[];
  webVitals?: WebVitalsSample[];
  storageStateSnapshot?: StorageStateSnapshot;
  // ── API tests (E1) — set for testType==='api' results (headless HTTP) ──
  apiResult?: import("@/lib/db/schema").ApiTestResultData;
}

export type AssertionType =
  | "pageLoad"
  | "networkIdle"
  | "urlMatch"
  | "domContentLoaded";

export type WaitType = "duration" | "selector";
export type WaitSelectorCondition = "visible" | "hidden";

export interface WaitParams {
  waitType: WaitType;
  durationMs?: number;
  selector?: string;
  selectors?: Array<{ type: string; value: string }>;
  condition?: WaitSelectorCondition;
  timeoutMs?: number;
}

export type ElementAssertionType =
  | "toBeVisible"
  | "toBeHidden"
  | "toContainText"
  | "toHaveText"
  | "toHaveValue"
  | "toBeEnabled"
  | "toBeDisabled"
  | "toBeChecked"
  | "toHaveAttribute"
  | "toHaveCount";

export interface StepResult {
  stepId: number;
  status: "passed" | "failed" | "pending";
  durationMs: number;
  error?: string;
}

export interface DebugNetworkEntry {
  id: string;
  stepIndex: number;
  method: string;
  url: string;
  status: number | null;
  resourceType: string;
  startTime: number;
  duration: number | null;
  failed: boolean;
  errorText?: string;
}

export interface DebugConsoleEntry {
  id: string;
  stepIndex: number;
  type: string;
  text: string;
  timestamp: number;
}

export type RecordingAnchorReason =
  | "cursor"
  | "last_passing"
  | "fallback_cursor";

export interface DebugState {
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
  steps: import("@/lib/playwright/debug-parser").DebugStep[];
  stepResults: StepResult[];
  code: string;
  error?: string;
  networkEntries: DebugNetworkEntry[];
  consoleEntries: DebugConsoleEntry[];
  traceUrl?: string;
  codeVersion: number;
  isRecording: boolean;
  recordedEventCount: number;
  recordingAnchorIndex?: number;
  recordingAnchorReason?: RecordingAnchorReason;
  spliceMode?: "replace" | "insert";
  targetUrl?: string;
  // Raw recorder events delivered exactly once, on the state tick right
  // after stop_recording finishes — drained server-side in
  // consumeStopRecording, never persisted onward.
  pendingRecordingEvents?: import("@/lib/playwright/event-to-code").CodeGenEvent[];
  // Live, not-yet-spliced recording buffer reported on every tick while
  // recording so the UI can render the timeline as actions happen.
  recordingEvents?: import("@/lib/playwright/event-to-code").CodeGenEvent[];
}

export type DebugCommand =
  | { type: "step_forward" }
  | { type: "step_back" }
  | { type: "run_to_end" }
  | { type: "run_to_step"; stepIndex: number }
  | { type: "update_code"; code: string }
  | { type: "start_recording"; spliceMode: "replace" | "insert" }
  | { type: "stop_recording" }
  | { type: "cancel_recording" }
  // Floating recording-control equivalents for an active "record from here"
  // debug session — mirror the repo-scoped recording actions in
  // src/server/actions/recording.ts.
  | { type: "recording_screenshot" }
  | { type: "recording_assertion"; assertionType: AssertionType }
  | { type: "recording_flag_download" }
  | { type: "recording_insert_timestamp" }
  | ({ type: "recording_insert_wait" } & WaitParams)
  | { type: "recording_toggle_pause" }
  | { type: "stop" }
  | { type: "_execution_complete" };

export { stripTypeAnnotations } from "@lastest/shared";
