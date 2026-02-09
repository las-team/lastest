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
  | 'command:cancel_test'
  | 'command:start_recording'
  | 'command:stop_recording'
  | 'command:ping'
  | 'command:shutdown'
  // Agent → Server (Responses)
  | 'response:test_result'
  | 'response:test_progress'
  | 'response:recording_event'
  | 'response:screenshot'
  | 'response:screenshot_ack'
  | 'response:error'
  | 'response:pong'
  // Status
  | 'status:heartbeat'
  | 'connection:established';

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
}

export interface RunTestCommand extends BaseMessage {
  type: 'command:run_test';
  payload: RunTestCommandPayload;
}

export interface StartRecordingCommandPayload {
  sessionId: string;
  targetUrl: string;
  viewport?: { width: number; height: number };
  selectorPriority: string[];
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
  error?: {
    message: string;
    stack?: string;
    screenshot?: string; // Base64 error screenshot
  };
  logs: LogEntry[];
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
  event: RecordingEventData;
  generatedCode: string;
}

export interface RecordingEventResponse extends BaseMessage {
  type: 'response:recording_event';
  payload: RecordingEventPayload;
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
  | CancelTestCommand
  | ShutdownCommand
  | StartRecordingCommand
  | StopRecordingCommand
  | PingCommand;

export type AgentResponse =
  | TestProgressResponse
  | TestResultResponse
  | RecordingEventResponse
  | ScreenshotUploadResponse
  | ErrorResponse
  | PongResponse
  | HeartbeatMessage;

export type Message =
  | ServerCommand
  | AgentResponse
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
