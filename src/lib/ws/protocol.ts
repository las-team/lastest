/**
 * WebSocket Protocol Types for Agent Communication
 *
 * Defines the message format and types for server <-> agent communication.
 */

// ============================================
// Base Message Types
// ============================================

export type MessageType =
  // Server → Agent (Commands)
  | 'command:run_test'
  | 'command:run_setup'
  | 'command:cancel_test'
  | 'command:start_recording'
  | 'command:stop_recording'
  | 'command:create_assertion'
  | 'command:create_wait'
  | 'command:flag_download'
  | 'command:insert_timestamp'
  | 'command:start_debug'
  | 'command:debug_action'
  | 'command:stop_debug'
  | 'command:ping'
  | 'command:shutdown'
  // Agent → Server (Responses)
  | 'response:test_result'
  | 'response:test_progress'
  | 'response:setup_result'
  | 'response:recording_event'
  | 'response:recording_stopped'
  | 'response:debug_state'
  | 'command:capture_screenshot'
  | 'response:screenshot'
  | 'response:screenshot_ack'
  | 'response:network_bodies'
  | 'response:error'
  | 'response:pong'
  // Status
  | 'status:heartbeat'
  | 'connection:established'
  // Embedded Browser Streaming
  | 'stream:frame'
  | 'stream:input'
  | 'stream:session'
  | 'stream:status'
  | 'stream:inspect_element_request'
  | 'stream:inspect_element_response'
  | 'stream:dom_snapshot_request'
  | 'stream:dom_snapshot_response'
  | 'stream:inspect_mode';

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
  viewport?: {
    width: number;
    height: number;
  };
  serverConfig?: ServerConfig;
  storageState?: string; // Serialized JSON from page.context().storageState() — carries auth session
  setupVariables?: Record<string, unknown>; // Variables from setup scripts
  cursorPlaybackSpeed?: number; // 0 = instant (skip delays), 1 = realtime
  stabilization?: StabilizationPayload;
  browser?: 'chromium' | 'firefox' | 'webkit';
  fixtures?: Array<{ filename: string; data: string }>; // base64-encoded fixture files
  grantClipboardAccess?: boolean;
  acceptDownloads?: boolean;
  headed?: boolean;
  forceVideoRecording?: boolean;
  recordingViewport?: { width: number; height: number };
  lockViewportToRecording?: boolean;
  consoleErrorMode?: 'fail' | 'warn' | 'ignore';
  networkErrorMode?: 'fail' | 'warn' | 'ignore';
  ignoreExternalNetworkErrors?: boolean;
  enableNetworkInterception?: boolean;
  // Extract-mode TestVariables — runner reads these page fields after the test body runs.
  extractVariables?: Array<{
    name: string;
    targetSelector: string;
    attribute?: 'value' | 'textContent' | 'innerText' | 'innerHTML';
  }>;
  // When true, the runner re-throws TypeError / ReferenceError / SyntaxError
  // from the soft-wrap so a broken test body fails the run instead of being
  // recorded as a soft warning. Driven by the test's `all_steps_executed`
  // Criteria rule (default ON, off only when user explicitly opted out).
  failOnRuntimeError?: boolean;
  /** Parsed assertions from `parseAssertions(code)`. Runner uses these to
   *  wrap each `expect(...)` line with a structured pass/fail recorder
   *  keyed by the host-computed `id`. Order-sensitive — must match the
   *  source order produced by the parser. */
  assertions?: Array<{
    id: string;
    codeLineStart?: number;
    codeLineEnd?: number;
  }>;
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
  viewport?: {
    width: number;
    height: number;
  };
  stabilization?: StabilizationPayload;
  browser?: 'chromium' | 'firefox' | 'webkit';
  // Debug-mode flag: when true, the EB keeps the CDP screencast attached to
  // the setup page so the user can watch setup execute live (login flow,
  // OAuth redirects). Default false preserves the CPU-saving behavior of
  // headless batch runs.
  headed?: boolean;
}

export interface RunSetupCommand extends BaseMessage {
  type: 'command:run_setup';
  payload: RunSetupCommandPayload;
}

export interface SetupResultPayload {
  correlationId: string;
  status: 'passed' | 'failed' | 'error' | 'timeout';
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
  type: 'response:setup_result';
  payload: SetupResultPayload;
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

export interface StopRecordingCommand extends BaseMessage {
  type: 'command:stop_recording';
  payload: {
    sessionId: string;
  };
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

// ============================================
// Agent → Server Responses
// ============================================

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
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
    screenshot?: string; // Base64 error screenshot
  };
  logs: LogEntry[];
  softErrors?: string[];
  /** Per-`expect()` outcome rows produced by the runner's assertion tracker.
   *  `assertionId` matches one of the `assertions[].id` sent in the run
   *  command. The criteria evaluator keys on these to fail the test when a
   *  user-pinned assertion failed. */
  assertionResults?: import('@/lib/db/schema').AssertionResult[];
  videoData?: string; // base64-encoded video file
  videoFilename?: string;
  lastReachedStep?: number;
  totalSteps?: number;
  domSnapshot?: import('@/lib/db/schema').DomSnapshotData; // DOM state captured after test body ran
  extractedVariables?: Record<string, string>; // Values pulled from page fields by extract-mode TestVariables
}

export interface TestResultResponse extends BaseMessage {
  type: 'response:test_result';
  payload: TestResultPayload;
}

export interface RecordingEventData {
  type: 'click' | 'fill' | 'navigate' | 'screenshot' | 'scroll' | 'hover';
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

export interface RecordingEventPayload {
  sessionId: string;
  events: Array<{
    type: string;
    timestamp: number;
    sequence: number;
    status: 'preview' | 'committed';
    verification?: {
      syntaxValid: boolean;
      domVerified?: boolean;
      lastChecked?: number;
    };
    data: Record<string, unknown>;
  }>;
}

export interface RecordingEventResponse extends BaseMessage {
  type: 'response:recording_event';
  payload: RecordingEventPayload;
}

export interface RecordingStoppedPayload {
  sessionId: string;
  generatedCode: string;
  domSnapshot?: import('@/lib/db/schema').DomSnapshotData; // DOM state captured on the recording page before stop
}

export interface RecordingStoppedResponse extends BaseMessage {
  type: 'response:recording_stopped';
  payload: RecordingStoppedPayload;
}

export interface CreateAssertionCommandPayload {
  sessionId: string;
  assertionType: string;
}

export interface CreateAssertionCommand extends BaseMessage {
  type: 'command:create_assertion';
  payload: CreateAssertionCommandPayload;
}

export type WaitType = 'duration' | 'selector';
export type WaitSelectorCondition = 'visible' | 'hidden';

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
  type: 'command:create_wait';
  payload: CreateWaitCommandPayload;
}

export interface FlagDownloadCommandPayload {
  sessionId: string;
}

export interface FlagDownloadCommand extends BaseMessage {
  type: 'command:flag_download';
  payload: FlagDownloadCommandPayload;
}

export interface InsertTimestampCommand extends BaseMessage {
  type: 'command:insert_timestamp';
  payload: { sessionId: string };
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
  type: 'action' | 'navigation' | 'assertion' | 'screenshot' | 'wait' | 'variable' | 'log' | 'other';
}

export interface DebugStepResult {
  stepId: number;
  status: 'passed' | 'failed' | 'pending';
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
}

export interface StartDebugCommand extends BaseMessage {
  type: 'command:start_debug';
  payload: StartDebugCommandPayload;
}

export interface DebugActionCommandPayload {
  sessionId: string;
  action: 'step_forward' | 'step_back' | 'run_to_end' | 'run_to_step' | 'update_code';
  stepIndex?: number;
  code?: string;
  cleanBody?: string;
  steps?: DebugStep[];
}

export interface DebugActionCommand extends BaseMessage {
  type: 'command:debug_action';
  payload: DebugActionCommandPayload;
}

export interface StopDebugCommandPayload {
  sessionId: string;
}

export interface StopDebugCommand extends BaseMessage {
  type: 'command:stop_debug';
  payload: StopDebugCommandPayload;
}

export interface DebugStateResponsePayload {
  sessionId: string;
  testId: string;
  status: 'initializing' | 'paused' | 'stepping' | 'running' | 'completed' | 'error';
  currentStepIndex: number;
  steps: DebugStep[];
  stepResults: DebugStepResult[];
  code: string;
  error?: string;
  codeVersion: number;
}

export interface DebugStateResponse extends BaseMessage {
  type: 'response:debug_state';
  payload: DebugStateResponsePayload;
}

export interface CaptureScreenshotCommand extends BaseMessage {
  type: 'command:capture_screenshot';
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
}

export interface ScreenshotUploadResponse extends BaseMessage {
  type: 'response:screenshot';
  payload: ScreenshotUploadPayload;
}

export interface ScreenshotAckPayload {
  correlationId: string;
  storagePath: string;
}

export interface ScreenshotAckResponse extends BaseMessage {
  type: 'response:screenshot_ack';
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
  type: 'response:network_bodies';
  payload: NetworkBodiesPayload;
}

export type ErrorCode =
  | 'BROWSER_LAUNCH_FAILED'
  | 'TEST_TIMEOUT'
  | 'NAVIGATION_FAILED'
  | 'SELECTOR_NOT_FOUND'
  | 'SERVER_START_FAILED'
  | 'SCREENSHOT_FAILED'
  | 'UNKNOWN_COMMAND'
  | 'INTERNAL_ERROR'
  | 'AUTH_FAILED';

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

export interface PongPayload {
  correlationId: string;
}

export interface PongResponse extends BaseMessage {
  type: 'response:pong';
  payload: PongPayload;
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
  status: 'idle' | 'busy' | 'recording' | 'debugging';
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
  /** @deprecated Use runnerId instead */
  agentId?: string;
}

export interface ConnectionEstablishedMessage extends BaseMessage {
  type: 'connection:established';
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
  | CaptureScreenshotCommand
  | StartDebugCommand
  | DebugActionCommand
  | StopDebugCommand
  | PingCommand;

export type AgentResponse =
  | TestProgressResponse
  | TestResultResponse
  | SetupResultResponse
  | RecordingEventResponse
  | RecordingStoppedResponse
  | ScreenshotUploadResponse
  | NetworkBodiesResponse
  | DebugStateResponse
  | ErrorResponse
  | PongResponse
  | HeartbeatMessage;

export type Message =
  | ServerCommand
  | AgentResponse
  | SetupResultResponse
  | ScreenshotAckResponse
  | DebugStateResponse
  | ConnectionEstablishedMessage;

// ============================================
// Helper Functions
// ============================================

export function createMessage<T extends Message>(
  type: T['type'],
  payload: T['payload']
): T {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: Date.now(),
    payload,
  } as unknown as T;
}

export function isServerCommand(msg: Message): msg is ServerCommand {
  return msg.type.startsWith('command:');
}

export function isAgentResponse(msg: Message): msg is AgentResponse {
  return msg.type.startsWith('response:') || msg.type.startsWith('status:');
}

// ============================================
// Embedded Browser Streaming Types
// ============================================

/** Server → Client: CDP screencast frame */
export interface ScreencastFrameMessage extends BaseMessage {
  type: 'stream:frame';
  payload: {
    data: string;          // base64 JPEG
    width: number;
    height: number;
    timestamp: number;
  };
}

/** Client → Server: Mouse/keyboard input forwarding */
export interface StreamInputMessage extends BaseMessage {
  type: 'stream:input';
  payload: StreamMouseEvent | StreamKeyboardEvent | StreamFileUploadEvent | StreamClipboardEvent | StreamTouchEvent;
}

export interface StreamMouseEvent {
  type: 'mouse';
  action: 'move' | 'down' | 'up' | 'wheel';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
}

export interface StreamKeyboardEvent {
  type: 'keyboard';
  action: 'keydown' | 'keyup' | 'type';
  key: string;
  code?: string;
  text?: string;
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
}

export interface StreamFileUploadEvent {
  type: 'file_upload';
  files: Array<{ name: string; data: string; mimeType: string }>; // base64 data
}

export interface StreamClipboardEvent {
  type: 'clipboard_paste';
  text: string;
}

export interface StreamTouchEvent {
  type: 'touch';
  action: 'start' | 'move' | 'end' | 'cancel';
  touches: Array<{ x: number; y: number; id: number }>;
}

/** Client → Server / Server → Client: Session lifecycle control */
export interface StreamSessionMessage extends BaseMessage {
  type: 'stream:session';
  payload:
    | { action: 'start' | 'stop' }
    | { action: 'resize'; viewport: { width: number; height: number } }
    | { action: 'navigate'; url: string };
}

/** Server → Client: Stream connection status */
export interface StreamStatusMessage extends BaseMessage {
  type: 'stream:status';
  payload: {
    status: 'connected' | 'disconnected' | 'error';
    currentUrl?: string;
    viewport?: { width: number; height: number };
    error?: string;
    fileChooserPending?: boolean;
  };
}

/** Client → Server: Request selectors for element at coordinates */
export interface InspectElementRequestMessage extends BaseMessage {
  type: 'stream:inspect_element_request';
  payload: { x: number; y: number };
}

/** Server → Client: Selectors for inspected element */
export interface InspectElementResponseMessage extends BaseMessage {
  type: 'stream:inspect_element_response';
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
  type: 'stream:dom_snapshot_request';
}

/** Server → Client: Full DOM snapshot with all interactive elements */
export interface DomSnapshotResponseMessage extends BaseMessage {
  type: 'stream:dom_snapshot_response';
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
  type: 'stream:inspect_mode';
  payload: { enabled: boolean };
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
  | InspectModeMessage;

export function isStreamMessage(msg: { type: string }): boolean {
  return msg.type.startsWith('stream:');
}
