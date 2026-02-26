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
  | 'command:ping'
  | 'command:shutdown'
  // Agent → Server (Responses)
  | 'response:test_result'
  | 'response:test_progress'
  | 'response:setup_result'
  | 'response:recording_event'
  | 'response:recording_stopped'
  | 'command:capture_screenshot'
  | 'response:screenshot'
  | 'response:screenshot_ack'
  | 'response:error'
  | 'response:pong'
  // Status
  | 'status:heartbeat'
  | 'connection:established'
  // Embedded Browser Streaming
  | 'stream:frame'
  | 'stream:input'
  | 'stream:session'
  | 'stream:status';

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

export interface StabilizationPayload {
  freezeTimestamps: boolean;
  frozenTimestamp: string;
  freezeRandomValues: boolean;
  randomSeed: number;
  freezeAnimations: boolean;
  crossOsConsistency: boolean;
  waitForNetworkIdle: boolean;
  networkIdleTimeout: number;
  waitForDomStable: boolean;
  domStableTimeout: number;
  waitForFonts: boolean;
  waitForImages: boolean;
  waitForImagesTimeout: number;
  crossOsFontCSS?: string;
  waitForCanvasStable: boolean;
  canvasStableTimeout: number;
  canvasStableThreshold: number;
  disableImageSmoothing: boolean;
  roundCanvasCoordinates: boolean;
  reseedRandomOnInput: boolean;
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
  | CaptureScreenshotCommand
  | PingCommand;

export type AgentResponse =
  | TestProgressResponse
  | TestResultResponse
  | SetupResultResponse
  | RecordingEventResponse
  | RecordingStoppedResponse
  | ScreenshotUploadResponse
  | ErrorResponse
  | PongResponse
  | HeartbeatMessage;

export type Message =
  | ServerCommand
  | AgentResponse
  | SetupResultResponse
  | ScreenshotAckResponse
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
  payload: StreamMouseEvent | StreamKeyboardEvent;
}

export interface StreamMouseEvent {
  type: 'mouse';
  action: 'move' | 'down' | 'up' | 'click' | 'dblclick' | 'wheel';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
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

/** Client → Server / Server → Client: Session lifecycle control */
export interface StreamSessionMessage extends BaseMessage {
  type: 'stream:session';
  payload: {
    action: 'start' | 'stop' | 'resize';
    viewport?: { width: number; height: number };
  };
}

/** Server → Client: Stream connection status */
export interface StreamStatusMessage extends BaseMessage {
  type: 'stream:status';
  payload: {
    status: 'connected' | 'disconnected' | 'error';
    currentUrl?: string;
    viewport?: { width: number; height: number };
    error?: string;
  };
}

export type StreamMessage =
  | ScreencastFrameMessage
  | StreamInputMessage
  | StreamSessionMessage
  | StreamStatusMessage;

export function isStreamMessage(msg: { type: string }): boolean {
  return msg.type.startsWith('stream:');
}
