/**
 * WebSocket Protocol Types for Agent Communication
 * This is a copy of the server-side protocol types for the standalone agent package.
 */

export type MessageType =
  | 'command:run_test'
  | 'command:run_setup'
  | 'command:cancel_test'
  | 'command:start_recording'
  | 'command:stop_recording'
  | 'command:ping'
  | 'command:shutdown'
  | 'response:test_result'
  | 'response:test_progress'
  | 'response:setup_result'
  | 'response:recording_event'
  | 'response:screenshot'
  | 'response:screenshot_ack'
  | 'response:recording_stopped'
  | 'response:error'
  | 'response:pong'
  | 'status:heartbeat'
  | 'connection:established'
  | 'command:capture_screenshot';

export interface BaseMessage {
  id: string;
  type: MessageType;
  timestamp: number;
}

export interface ServerConfig {
  command: string;
  cwd: string;
  healthCheckUrl: string;
  healthCheckTimeout: number;
}

import type { CoreStabilizationSettings } from '@lastest/shared';

export type StabilizationPayload = CoreStabilizationSettings;

export interface RunTestCommandPayload {
  testId: string;
  testRunId: string;
  code: string;
  codeHash: string; // SHA256 hash of code for integrity verification
  targetUrl: string;
  screenshotPath: string;
  timeout: number;
  repositoryId?: string; // For screenshot storage location
  viewport?: { width: number; height: number };
  browser?: 'chromium' | 'firefox' | 'webkit';
  serverConfig?: ServerConfig;
  storageState?: string; // Serialized JSON from page.context().storageState() — carries auth session
  setupVariables?: Record<string, unknown>; // Variables from setup scripts
  cursorPlaybackSpeed?: number; // 0 = instant (skip delays), 1 = realtime
  stabilization?: StabilizationPayload;
  fixtures?: Array<{ filename: string; data: string }>; // base64-encoded fixture files
  grantClipboardAccess?: boolean;
  acceptDownloads?: boolean;
  forceVideoRecording?: boolean;
  recordingViewport?: { width: number; height: number };
  lockViewportToRecording?: boolean;
}

export interface RunTestCommand extends BaseMessage {
  type: 'command:run_test';
  payload: RunTestCommandPayload;
}

export interface RunSetupCommandPayload {
  setupId: string;
  code: string;
  codeHash: string;
  targetUrl: string;
  timeout: number;
  viewport?: { width: number; height: number };
  browser?: 'chromium' | 'firefox' | 'webkit';
  stabilization?: StabilizationPayload;
}

export interface RunSetupCommand extends BaseMessage {
  type: 'command:run_setup';
  payload: RunSetupCommandPayload;
}

export interface SetupResultPayload {
  correlationId: string;
  status: 'passed' | 'failed' | 'error' | 'timeout';
  storageState?: string;
  variables?: Record<string, unknown>;
  durationMs: number;
  error?: string;
  logs: LogEntry[];
}

export interface SetupResultResponse extends BaseMessage {
  type: 'response:setup_result';
  payload: SetupResultPayload;
}

export interface PingCommand extends BaseMessage {
  type: 'command:ping';
  payload: Record<string, never>;
}

export interface CancelTestCommandPayload {
  testRunId: string;
  reason: string;
}

export interface CancelTestCommand extends BaseMessage {
  type: 'command:cancel_test';
  payload: CancelTestCommandPayload;
}

export interface ShutdownCommandPayload {
  reason?: string;
}

export interface ShutdownCommand extends BaseMessage {
  type: 'command:shutdown';
  payload: ShutdownCommandPayload;
}

export interface StartRecordingCommandPayload {
  sessionId: string;
  targetUrl: string;
  viewport?: { width: number; height: number };
  browser?: 'chromium' | 'firefox' | 'webkit';
  selectorPriority?: Array<{ type: string; enabled: boolean; priority: number }>;
  ocrEnabled?: boolean;
  pointerGestures?: boolean;
  cursorFPS?: number;
  setupSteps?: Array<{ code: string; codeHash: string }>;
}

export interface StartRecordingCommand extends BaseMessage {
  type: 'command:start_recording';
  payload: StartRecordingCommandPayload;
}

export interface StopRecordingCommandPayload {
  sessionId: string;
}

export interface StopRecordingCommand extends BaseMessage {
  type: 'command:stop_recording';
  payload: StopRecordingCommandPayload;
}

export interface CaptureScreenshotCommand extends BaseMessage {
  type: 'command:capture_screenshot';
  payload: { sessionId: string };
}

export interface RecordingEventData {
  type: string;
  timestamp: number;
  sequence: number;
  status: 'preview' | 'committed';
  verification?: {
    syntaxValid: boolean;
    domVerified?: boolean;
    lastChecked?: number;
  };
  data: {
    action?: string;
    selector?: string;
    selectors?: Array<{ type: string; value: string; enabled?: boolean; priority?: number }>;
    value?: string;
    url?: string;
    relativePath?: string;
    screenshotPath?: string;
    assertionType?: string;
    coordinates?: { x: number; y: number };
    button?: number;
    modifiers?: string[];
    key?: string;
    actionId?: string;
    elementInfo?: {
      tagName: string;
      id?: string;
      textContent?: string;
      potentialAction?: string;
      potentialSelector?: string;
      selectors?: Array<{ type: string; value: string; enabled?: boolean; priority?: number }>;
    };
    elementAssertion?: {
      type: string;
      selectors: Array<{ type: string; value: string; enabled?: boolean; priority?: number }>;
      expectedValue?: string;
      attributeName?: string;
      attributeValue?: string;
    };
  };
}

export interface RecordingEventPayload {
  sessionId: string;
  events: RecordingEventData[];
  generatedCode?: string;
}

export interface RecordingEventResponse extends BaseMessage {
  type: 'response:recording_event';
  payload: RecordingEventPayload;
}

export interface RecordingStoppedPayload {
  sessionId: string;
  generatedCode: string;
  domSnapshot?: DomSnapshotPayload;
}

export interface RecordingStoppedResponse extends BaseMessage {
  type: 'response:recording_stopped';
  payload: RecordingStoppedPayload;
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface DomSnapshotElementSummary {
  tag: string;
  id?: string;
  textContent?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  selectors: Array<{ type: string; value: string }>;
}

export interface DomSnapshotPayload {
  elements: DomSnapshotElementSummary[];
  url: string;
  timestamp: number;
}

export interface TestResultPayload {
  correlationId: string;
  testId: string;
  testRunId: string;
  status: 'passed' | 'failed' | 'error' | 'timeout' | 'cancelled';
  durationMs: number;
  screenshotCount?: number; // Number of screenshots to expect (for early completion detection)
  error?: {
    message: string;
    stack?: string;
    screenshot?: string;
  };
  logs: LogEntry[];
  softErrors?: string[];
  videoData?: string; // base64-encoded video file
  videoFilename?: string;
  lastReachedStep?: number;
  totalSteps?: number;
  domSnapshot?: DomSnapshotPayload;
}

export interface TestResultResponse extends BaseMessage {
  type: 'response:test_result';
  payload: TestResultPayload;
}

export interface TestProgressPayload {
  correlationId: string;
  step: string;
  progress: number;
}

export interface TestProgressResponse extends BaseMessage {
  type: 'response:test_progress';
  payload: TestProgressPayload;
}

export interface ScreenshotUploadPayload {
  correlationId: string;
  testRunId: string;
  repositoryId?: string; // For screenshot storage location
  filename: string;
  data: string;
  width: number;
  height: number;
  capturedAt: number;
}

export interface ScreenshotUploadResponse extends BaseMessage {
  type: 'response:screenshot';
  payload: ScreenshotUploadPayload;
}

export type ErrorCode =
  | 'BROWSER_LAUNCH_FAILED'
  | 'TEST_TIMEOUT'
  | 'NAVIGATION_FAILED'
  | 'SELECTOR_NOT_FOUND'
  | 'SERVER_START_FAILED'
  | 'SCREENSHOT_FAILED'
  | 'UNKNOWN_COMMAND'
  | 'INTERNAL_ERROR';

export interface ErrorPayload {
  correlationId?: string;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ErrorResponse extends BaseMessage {
  type: 'response:error';
  payload: ErrorPayload;
}

export interface PongResponse extends BaseMessage {
  type: 'response:pong';
  payload: { correlationId: string };
}

export interface SystemInfo {
  platform: string;
  memory: { used: number; total: number };
  uptime: number;
}

export interface HeartbeatPayload {
  status: 'idle' | 'busy' | 'recording';
  currentTask?: string;
  systemInfo: SystemInfo;
  disconnect?: boolean; // Signal graceful shutdown
}

export interface HeartbeatMessage extends BaseMessage {
  type: 'status:heartbeat';
  payload: HeartbeatPayload;
}

export interface ConnectionEstablishedPayload {
  runnerId: string;
  teamId: string;
  capabilities: string[];
  sessionId: string;
  /** @deprecated Use runnerId instead */
  agentId?: string;
}

export interface ConnectionEstablishedMessage extends BaseMessage {
  type: 'connection:established';
  payload: ConnectionEstablishedPayload;
}

export type Message =
  | RunTestCommand
  | RunSetupCommand
  | CancelTestCommand
  | ShutdownCommand
  | PingCommand
  | StartRecordingCommand
  | StopRecordingCommand
  | CaptureScreenshotCommand
  | TestResultResponse
  | TestProgressResponse
  | SetupResultResponse
  | ScreenshotUploadResponse
  | RecordingEventResponse
  | RecordingStoppedResponse
  | ErrorResponse
  | PongResponse
  | HeartbeatMessage
  | ConnectionEstablishedMessage;

export function createMessage<T extends BaseMessage>(
  type: T['type'],
  payload: T extends BaseMessage & { payload: infer P } ? P : never
): T {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: Date.now(),
    payload,
  } as unknown as T;
}
