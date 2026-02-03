/**
 * WebSocket Protocol Types for Agent Communication
 * This is a copy of the server-side protocol types for the standalone agent package.
 */

export type MessageType =
  | 'command:run_test'
  | 'command:start_recording'
  | 'command:stop_recording'
  | 'command:ping'
  | 'response:test_result'
  | 'response:test_progress'
  | 'response:recording_event'
  | 'response:screenshot'
  | 'response:screenshot_ack'
  | 'response:error'
  | 'response:pong'
  | 'status:heartbeat'
  | 'connection:established';

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

export interface RunTestCommandPayload {
  testId: string;
  testRunId: string;
  code: string;
  targetUrl: string;
  screenshotPath: string;
  timeout: number;
  viewport?: { width: number; height: number };
  serverConfig?: ServerConfig;
}

export interface RunTestCommand extends BaseMessage {
  type: 'command:run_test';
  payload: RunTestCommandPayload;
}

export interface PingCommand extends BaseMessage {
  type: 'command:ping';
  payload: Record<string, never>;
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface TestResultPayload {
  correlationId: string;
  testId: string;
  testRunId: string;
  status: 'passed' | 'failed' | 'error' | 'timeout';
  durationMs: number;
  error?: {
    message: string;
    stack?: string;
    screenshot?: string;
  };
  logs: LogEntry[];
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
}

export interface HeartbeatMessage extends BaseMessage {
  type: 'status:heartbeat';
  payload: HeartbeatPayload;
}

export interface ConnectionEstablishedPayload {
  agentId: string;
  teamId: string;
  capabilities: string[];
}

export interface ConnectionEstablishedMessage extends BaseMessage {
  type: 'connection:established';
  payload: ConnectionEstablishedPayload;
}

export type Message =
  | RunTestCommand
  | PingCommand
  | TestResultResponse
  | TestProgressResponse
  | ScreenshotUploadResponse
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
  } as T;
}
