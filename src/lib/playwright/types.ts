import type { NetworkRequest, DownloadRecord, A11yViolation, AssertionResult, DomSnapshotData, UrlTrajectoryStep, WebVitalsSample, StorageStateSnapshot } from '@/lib/db/schema';

export interface CapturedScreenshot {
  path: string;
  label?: string;
}

export interface TestRunResult {
  testId: string;
  status: 'passed' | 'failed' | 'skipped' | 'setup_failed';
  durationMs: number;
  screenshotPath?: string;
  screenshots: CapturedScreenshot[];
  errorMessage?: string;
  consoleErrors?: string[];
  networkRequests?: NetworkRequest[];
  a11yViolations?: A11yViolation[];
  a11yPassesCount?: number;
  assertionResults?: AssertionResult[];
  setupDurationMs?: number;
  teardownDurationMs?: number;
  teardownError?: string;
  stabilityMetadata?: { frameCount: number; stableFrames: number; maxFrameDiff: number; isStable: boolean };
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
}

export type AssertionType = 'pageLoad' | 'networkIdle' | 'urlMatch' | 'domContentLoaded';

export type WaitType = 'duration' | 'selector';
export type WaitSelectorCondition = 'visible' | 'hidden';

export interface WaitParams {
  waitType: WaitType;
  durationMs?: number;
  selector?: string;
  selectors?: Array<{ type: string; value: string }>;
  condition?: WaitSelectorCondition;
  timeoutMs?: number;
}

export type ElementAssertionType =
  | 'toBeVisible'
  | 'toBeHidden'
  | 'toContainText'
  | 'toHaveText'
  | 'toHaveValue'
  | 'toBeEnabled'
  | 'toBeDisabled'
  | 'toBeChecked'
  | 'toHaveAttribute'
  | 'toHaveCount';

export interface StepResult {
  stepId: number;
  status: 'passed' | 'failed' | 'pending';
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

export interface DebugState {
  sessionId: string;
  testId: string;
  status: 'initializing' | 'paused' | 'stepping' | 'running' | 'completed' | 'error';
  currentStepIndex: number;
  steps: import('@/lib/playwright/debug-parser').DebugStep[];
  stepResults: StepResult[];
  code: string;
  error?: string;
  networkEntries: DebugNetworkEntry[];
  consoleEntries: DebugConsoleEntry[];
  traceUrl?: string;
  codeVersion: number;
  isRecording: boolean;
  recordedEventCount: number;
}

export type DebugCommand =
  | { type: 'step_forward' }
  | { type: 'step_back' }
  | { type: 'run_to_end' }
  | { type: 'run_to_step'; stepIndex: number }
  | { type: 'update_code'; code: string }
  | { type: 'start_recording' }
  | { type: 'stop_recording' }
  | { type: 'stop' }
  | { type: '_execution_complete' };

export { stripTypeAnnotations } from '@lastest/shared';
