/**
 * Runner Client
 * Connects to the server and handles commands.
 */

import os from 'os';
import type {
  Message,
  RunTestCommand,
  CancelTestCommand,
  ShutdownCommand,
  StartRecordingCommand,
  StopRecordingCommand,
  CaptureScreenshotCommand,
  HeartbeatMessage,
  TestResultResponse,
  TestProgressResponse,
  ScreenshotUploadResponse,
  RecordingEventResponse,
  RecordingStoppedResponse,
  RecordingEventData,
  ErrorResponse,
  PongResponse,
  ErrorCode,
} from './protocol.js';
import { createMessage } from './protocol.js';
import { TestRunner } from './runner.js';
import { RemoteRecorder } from './recorder.js';

interface ConnectResponse {
  runnerId: string;
  teamId: string;
  capabilities?: string[];
  commands?: Message[];
  sessionId: string;
}

interface HeartbeatResponse {
  commands?: Message[];
}

export interface RunnerClientOptions {
  token: string;
  serverUrl: string;
  pollInterval?: number;
  baseUrl?: string;
}

export class RunnerClient {
  private token: string;
  private serverUrl: string;
  private pollInterval: number;
  private baseUrl?: string;
  private running = false;
  private status: 'idle' | 'busy' | 'recording' = 'idle';
  private currentTask?: string;
  private runner: TestRunner;
  private recorder: RemoteRecorder;
  private sessionId?: string;

  constructor(options: RunnerClientOptions) {
    this.token = options.token;
    this.serverUrl = options.serverUrl.replace(/\/$/, '');
    this.pollInterval = options.pollInterval ?? 30000; // 30 seconds default
    this.baseUrl = options.baseUrl;
    this.runner = new TestRunner();
    this.recorder = new RemoteRecorder();
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`Connecting to ${this.serverUrl}...`);

    // Initial connection
    const connected = await this.connect();
    if (!connected) {
      throw new Error('Failed to connect to server');
    }

    console.log('Connected! Starting poll loop...');

    // Start heartbeat loop
    this.heartbeatLoop();
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    console.log('Sending offline notification...');

    // Send explicit offline message before stopping
    try {
      const offlineMsg = createMessage<HeartbeatMessage>('status:heartbeat', {
        status: 'idle', // Will be treated as 'offline' intent with disconnect flag
        currentTask: undefined,
        systemInfo: this.getSystemInfo(),
        disconnect: true, // Signal graceful disconnect
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      };

      if (this.sessionId) {
        headers['X-Session-ID'] = this.sessionId;
      }

      await fetch(`${this.serverUrl}/api/ws/runner`, {
        method: 'POST',
        headers,
        body: JSON.stringify(offlineMsg),
      });

      console.log('Runner stopped gracefully');
    } catch (error) {
      console.error('Failed to send offline notification:', error);
      console.log('Runner stopped (ungraceful)');
    }
  }

  private async connect(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/api/ws/runner`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (response.status === 409) {
        const data = await response.json() as { error?: string };
        console.error('❌ Connection rejected: another runner instance is already connected with this token');
        console.error(`   ${data.error ?? 'Unknown error'}`);
        return false;
      }

      if (!response.ok) {
        const text = await response.text();
        console.error(`Connection failed: ${response.status} ${text}`);
        return false;
      }

      const data = (await response.json()) as ConnectResponse;

      // Store session ID for subsequent requests
      this.sessionId = data.sessionId;

      console.log(`Runner ID: ${data.runnerId}`);
      console.log(`Team ID: ${data.teamId}`);
      console.log(`Session ID: ${data.sessionId}`);
      console.log(`Capabilities: ${data.capabilities?.join(', ') || 'run, record'}`);

      // Process any pending commands
      if (data.commands && data.commands.length > 0) {
        for (const cmd of data.commands) {
          await this.handleCommand(cmd);
        }
      }

      return true;
    } catch (error) {
      console.error('Connection error:', error);
      return false;
    }
  }

  private async heartbeatLoop(): Promise<void> {
    while (this.running) {
      try {
        const heartbeat = createMessage<HeartbeatMessage>('status:heartbeat', {
          status: this.status,
          currentTask: this.currentTask,
          systemInfo: this.getSystemInfo(),
        });

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        };

        // Include session ID if we have one
        if (this.sessionId) {
          headers['X-Session-ID'] = this.sessionId;
        }

        const response = await fetch(`${this.serverUrl}/api/ws/runner`, {
          method: 'POST',
          headers,
          body: JSON.stringify(heartbeat),
        });

        if (response.status === 409) {
          // Session conflict - another instance took over
          console.error('❌ Session conflict: another runner instance has connected with this token');
          console.error('   This instance will shut down gracefully.');
          await this.stop();
          return;
        }

        if (response.ok) {
          const data = (await response.json()) as HeartbeatResponse;

          // Process any pending commands
          if (data.commands && data.commands.length > 0) {
            console.log(`[Heartbeat] Received ${data.commands.length} commands:`, data.commands.map((c: Message) => c.type));
            for (const cmd of data.commands) {
              await this.handleCommand(cmd);
            }
          }
        } else {
          const text = await response.text();
          console.error(`Heartbeat failed: ${response.status} - ${text}`);
        }
      } catch (error) {
        console.error('Heartbeat error:', error);
      }

      // Wait for next poll
      await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
    }
  }

  private async handleCommand(message: Message): Promise<void> {
    console.log(`Received command: ${message.type}`);

    switch (message.type) {
      case 'command:ping':
        await this.handlePing(message.id);
        break;

      case 'command:run_test':
        await this.handleRunTest(message as RunTestCommand);
        break;

      case 'command:cancel_test':
        await this.handleCancelTest(message as CancelTestCommand);
        break;

      case 'command:start_recording':
        await this.handleStartRecording(message as StartRecordingCommand);
        break;

      case 'command:stop_recording':
        await this.handleStopRecording(message as StopRecordingCommand);
        break;

      case 'command:capture_screenshot':
        await this.handleCaptureScreenshot(message as CaptureScreenshotCommand);
        break;

      case 'command:shutdown':
        await this.handleShutdown(message as ShutdownCommand);
        break;

      default:
        console.warn(`Unknown command type: ${message.type}`);
        await this.sendError(message.id, 'UNKNOWN_COMMAND', `Unknown command: ${message.type}`);
    }
  }

  private async handlePing(correlationId: string): Promise<void> {
    const pong = createMessage<PongResponse>('response:pong', {
      correlationId,
    });
    await this.sendMessage(pong);
  }

  private async handleCancelTest(command: CancelTestCommand): Promise<void> {
    const { testRunId, reason } = command.payload;
    console.log(`Received cancel command for test run ${testRunId}: ${reason}`);

    const aborted = this.runner.abort(testRunId);
    if (aborted) {
      console.log(`Test run ${testRunId} aborted successfully`);
    } else if (this.runner.isRunning()) {
      console.log(`Test run ${testRunId} is not the current test, ignoring cancel`);
    } else {
      console.log(`No test running to cancel`);
    }
  }

  private async handleShutdown(command: ShutdownCommand): Promise<void> {
    const reason = command.payload.reason || 'Remote shutdown requested';
    console.log(`\n🛑 Shutdown command received: ${reason}`);
    console.log('Stopping runner...');
    await this.stop();
    // Exit the process after graceful shutdown
    process.exit(0);
  }

  private async handleRunTest(command: RunTestCommand): Promise<void> {
    this.status = 'busy';
    this.currentTask = command.payload.testRunId;

    // Override targetUrl if baseUrl is configured
    if (this.baseUrl) {
      console.log(`Overriding targetUrl: ${command.payload.targetUrl} → ${this.baseUrl}`);
      command.payload.targetUrl = this.baseUrl.replace(/\/+$/, '');
    }

    try {
      console.log(`Running test: ${command.payload.testId}`);

      const result = await this.runner.runTest(command.payload, (step, progress) => {
        // Send progress update
        const progressMsg = createMessage<TestProgressResponse>('response:test_progress', {
          correlationId: command.id,
          step,
          progress,
        });
        this.sendMessage(progressMsg);
      });

      // Upload screenshots
      console.log(`Uploading ${result.screenshots.length} screenshots...`);
      for (const screenshot of result.screenshots) {
        const screenshotMsg = createMessage<ScreenshotUploadResponse>('response:screenshot', {
          correlationId: command.id,
          testRunId: command.payload.testRunId,
          repositoryId: command.payload.repositoryId,
          filename: screenshot.filename,
          data: screenshot.data,
          width: screenshot.width,
          height: screenshot.height,
          capturedAt: Date.now(),
        });
        console.log(`  Sending screenshot: ${screenshot.filename}`);
        await this.sendMessage(screenshotMsg);
      }

      // Send result
      const resultMsg = createMessage<TestResultResponse>('response:test_result', {
        correlationId: command.id,
        testId: command.payload.testId,
        testRunId: command.payload.testRunId,
        status: result.status,
        durationMs: result.durationMs,
        error: result.error,
        logs: result.logs,
      });
      await this.sendMessage(resultMsg);

      console.log(`Test ${result.status}: ${command.payload.testId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.sendError(command.id, 'INTERNAL_ERROR', errorMessage);
    } finally {
      this.status = 'idle';
      this.currentTask = undefined;
    }
  }

  private async handleStartRecording(command: StartRecordingCommand): Promise<void> {
    if (this.recorder.isActive()) {
      await this.sendError(command.id, 'INTERNAL_ERROR', 'Recording already in progress');
      return;
    }

    this.status = 'recording';
    this.currentTask = command.payload.sessionId;

    try {
      console.log(`Starting recording: ${command.payload.targetUrl}`);

      await this.recorder.start(
        command.payload,
        // onEvent callback — send events back to server
        (events: RecordingEventData[]) => {
          const msg = createMessage<RecordingEventResponse>('response:recording_event', {
            sessionId: command.payload.sessionId,
            events,
          });
          this.sendMessage(msg);
        },
        // onStopped callback — browser was closed by user
        () => {
          console.log('Recording stopped (browser closed)');
          const msg = createMessage<RecordingStoppedResponse>('response:recording_stopped', {
            sessionId: command.payload.sessionId,
            generatedCode: '', // Server will generate code from stored events
          });
          this.sendMessage(msg);
          this.status = 'idle';
          this.currentTask = undefined;
        }
      );

      console.log('Recording started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to start recording:', errorMessage);
      await this.sendError(command.id, 'BROWSER_LAUNCH_FAILED', errorMessage);
      this.status = 'idle';
      this.currentTask = undefined;
    }
  }

  private async handleStopRecording(command: StopRecordingCommand): Promise<void> {
    if (!this.recorder.isActive()) {
      await this.sendError(command.id, 'INTERNAL_ERROR', 'No recording in progress');
      return;
    }

    try {
      console.log('Stopping recording...');
      await this.recorder.stop();

      const msg = createMessage<RecordingStoppedResponse>('response:recording_stopped', {
        sessionId: command.payload.sessionId,
        generatedCode: '', // Server generates code from stored events
      });
      await this.sendMessage(msg);

      console.log('Recording stopped successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to stop recording:', errorMessage);
      await this.sendError(command.id, 'INTERNAL_ERROR', errorMessage);
    } finally {
      this.status = 'idle';
      this.currentTask = undefined;
    }
  }

  private async handleCaptureScreenshot(command: CaptureScreenshotCommand): Promise<void> {
    if (!this.recorder.isActive()) {
      await this.sendError(command.id, 'INTERNAL_ERROR', 'No recording in progress');
      return;
    }

    try {
      const screenshot = await this.recorder.takeScreenshot();
      if (screenshot) {
        const msg = createMessage<ScreenshotUploadResponse>('response:screenshot', {
          correlationId: command.id,
          testRunId: '', // Not a test run
          filename: `recording-screenshot-${Date.now()}.png`,
          data: screenshot.data,
          width: screenshot.width,
          height: screenshot.height,
          capturedAt: Date.now(),
        });
        await this.sendMessage(msg);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.sendError(command.id, 'SCREENSHOT_FAILED', errorMessage);
    }
  }

  private async sendMessage(message: Message): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      };

      // Include session ID if we have one
      if (this.sessionId) {
        headers['X-Session-ID'] = this.sessionId;
      }

      await fetch(`${this.serverUrl}/api/ws/runner`, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
      });
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }

  private async sendError(correlationId: string, code: ErrorCode, message: string): Promise<void> {
    const errorMsg = createMessage<ErrorResponse>('response:error', {
      correlationId,
      code,
      message,
    });
    await this.sendMessage(errorMsg);
  }

  private getSystemInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    return {
      platform: `${os.platform()} ${os.release()}`,
      memory: {
        used: totalMem - freeMem,
        total: totalMem,
      },
      uptime: os.uptime(),
    };
  }
}
