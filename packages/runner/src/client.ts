/**
 * Runner Client
 * Connects to the server and handles commands.
 */

import os from 'os';
import type {
  Message,
  RunTestCommand,
  RunSetupCommand,
  CancelTestCommand,
  ShutdownCommand,
  StartRecordingCommand,
  StopRecordingCommand,
  CaptureScreenshotCommand,
  HeartbeatMessage,
  TestResultResponse,
  TestProgressResponse,
  SetupResultResponse,
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
  private commandQueue: Message[] = [];
  private processingCommands = false;
  private activeTasks = 0;
  private seenCommandIds = new Set<string>();
  private activeTestIds = new Set<string>();
  // Retry queue for failed result/screenshot sends
  private pendingResults: Message[] = [];
  // Resolve this to wake the heartbeat sleep early (for fast shutdown)
  private wakeHeartbeat: (() => void) | null = null;

  constructor(options: RunnerClientOptions) {
    this.token = options.token;
    this.serverUrl = options.serverUrl.replace(/\/$/, '');
    this.pollInterval = options.pollInterval ?? 1000; // 1s buffer between long-poll cycles
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
    console.log('[Stop] Shutting down...');

    // Wake heartbeat sleep immediately so the loop exits fast
    this.wakeHeartbeat?.();

    // Abort all active tests
    for (const testId of this.activeTestIds) {
      console.log(`[Stop] Aborting active test: ${testId}`);
      this.runner.abort(testId);
    }

    // Send offline notification with a hard 5s timeout
    try {
      const offlineMsg = createMessage<HeartbeatMessage>('status:heartbeat', {
        status: 'idle',
        currentTask: undefined,
        systemInfo: this.getSystemInfo(),
        disconnect: true,
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
        signal: AbortSignal.timeout(5000),
      });

      console.log('[Stop] Server notified');
    } catch {
      console.log('[Stop] Server notification skipped (timeout or unreachable)');
    }

    // Close browser
    await this.runner.closeBrowserIfIdle();
    console.log('[Stop] Done');
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

      // Enqueue any pending commands
      if (data.commands && data.commands.length > 0) {
        this.commandQueue.push(...data.commands);
        this.processCommandQueue();
      }

      return true;
    } catch (error) {
      console.error('Connection error:', error);
      return false;
    }
  }

  private async heartbeatLoop(): Promise<void> {
    while (this.running) {
      // Flush pending results retry queue before heartbeat
      if (this.pendingResults.length > 0) {
        const retrying = [...this.pendingResults];
        this.pendingResults = [];
        for (const msg of retrying) {
          const ok = await this.sendMessage(msg);
          if (!ok) {
            this.pendingResults.push(msg);
          }
        }
        // Cap retry queue to prevent unbounded growth
        if (this.pendingResults.length > 100) {
          console.warn(`[Retry] Dropping ${this.pendingResults.length - 100} oldest pending results`);
          this.pendingResults = this.pendingResults.slice(-100);
        }
      }

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

          // Enqueue commands for sequential processing (non-blocking so heartbeats continue)
          if (data.commands && data.commands.length > 0) {
            console.log(`[Heartbeat] Received ${data.commands.length} commands:`, data.commands.map((c: Message) => c.type));
            this.commandQueue.push(...data.commands);
            this.processCommandQueue();
          }
        } else {
          const text = await response.text();
          console.error(`Heartbeat failed: ${response.status} - ${text}`);
        }
      } catch (error) {
        console.error('Heartbeat error:', error);
      }

      // Wait for next poll — interruptible via wakeHeartbeat() for fast shutdown
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.pollInterval);
        this.wakeHeartbeat = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wakeHeartbeat = null;
    }
  }

  /**
   * Process queued commands. run_test commands are fired concurrently
   * WITHOUT blocking the queue — so cancel_test and other commands
   * arriving on subsequent heartbeats get processed immediately.
   */
  private async processCommandQueue(): Promise<void> {
    if (this.processingCommands) return; // Already processing
    this.processingCommands = true;

    while (this.commandQueue.length > 0) {
      const cmd = this.commandQueue.shift()!;

      // Dedup by command ID (except run_test which dedupes by testId)
      if (cmd.type !== 'command:run_test') {
        if (this.seenCommandIds.has(cmd.id)) {
          console.log(`[Queue] Skipping duplicate command ${cmd.id}`);
          continue;
        }
        this.seenCommandIds.add(cmd.id);
      }

      if (cmd.type === 'command:run_test') {
        const testCmd = cmd as RunTestCommand;
        const testId = testCmd.payload.testId;
        if (this.activeTestIds.has(testId)) {
          console.log(`[Queue] Skipping duplicate run_test for testId ${testId} (cmd ${testCmd.id.slice(0, 8)})`);
          continue;
        }
        this.activeTestIds.add(testId);

        // Fire and forget — don't block the queue processor
        console.log(`[Queue] Launching test ${testId}`);
        this.handleCommand(cmd).catch(error => {
          console.error(`Command ${cmd.type} (${cmd.id}) failed:`, error);
        });
      } else if (cmd.type === 'command:run_setup') {
        // Fire and forget — setup is long-running, don't block the queue
        console.log(`[Queue] Launching setup ${cmd.id.slice(0, 8)}`);
        this.handleCommand(cmd).catch(error => {
          console.error(`Command ${cmd.type} (${cmd.id}) failed:`, error);
        });
      } else {
        // Non-test commands (cancel_test, ping, etc.) — process immediately
        console.log(`[Queue] Processing ${cmd.type}`);
        try {
          await this.handleCommand(cmd);
        } catch (error) {
          console.error(`Command ${cmd.type} failed:`, error);
        }
      }
    }

    // Cap the dedup set to prevent unbounded growth
    if (this.seenCommandIds.size > 1000) {
      const entries = [...this.seenCommandIds];
      this.seenCommandIds = new Set(entries.slice(entries.length - 500));
    }

    this.processingCommands = false;
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

      case 'command:run_setup':
        await this.handleRunSetup(message as RunSetupCommand);
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
    this.activeTasks++;
    this.status = 'busy';
    this.currentTask = command.payload.testRunId;
    const testId = command.payload.testId;

    // Override targetUrl if baseUrl is configured
    if (this.baseUrl) {
      console.log(`[Test ${testId}] Overriding targetUrl: ${command.payload.targetUrl} → ${this.baseUrl}`);
      command.payload.targetUrl = this.baseUrl.replace(/\/+$/, '');
    }

    try {
      console.log(`[Test ${testId}] Starting test execution (commandId: ${command.id.slice(0, 8)}, timeout: ${command.payload.timeout}ms)`);

      const result = await this.runner.runTest(command.payload, (step, progress) => {
        // Send progress update
        const progressMsg = createMessage<TestProgressResponse>('response:test_progress', {
          correlationId: command.id,
          step,
          progress,
        });
        this.sendMessage(progressMsg);
      });

      console.log(`[Test ${testId}] runTest returned: status=${result.status}, screenshots=${result.screenshots.length}, duration=${result.durationMs}ms`);

      // Upload screenshots BEFORE result so they're in DB when executor sees "completed"
      if (result.screenshots.length > 0) {
        console.log(`[Test ${testId}] Uploading ${result.screenshots.length} screenshots in parallel...`);
        const screenshotResults = await Promise.all(result.screenshots.map((screenshot) => {
          const screenshotMsg = createMessage<ScreenshotUploadResponse>('response:screenshot', {
            correlationId: command.id,
            testRunId: command.payload.testRunId,
            repositoryId: command.payload.repositoryId,
            filename: screenshot.filename,
            data: screenshot.data,
            width: screenshot.width,
            height: screenshot.height,
            capturedAt: screenshot.capturedAt || Date.now(),
          });
          return this.sendMessage(screenshotMsg).then(sent => {
            if (!sent) {
              console.warn(`[Test ${testId}]   Screenshot send failed, queuing for retry`);
              this.pendingResults.push(screenshotMsg);
            }
            return sent;
          });
        }));
        console.log(`[Test ${testId}] All screenshots uploaded (${screenshotResults.filter(Boolean).length}/${result.screenshots.length} succeeded)`);
      }

      // Send result AFTER screenshots so server has them when it sees pass/fail
      const resultMsg = createMessage<TestResultResponse>('response:test_result', {
        correlationId: command.id,
        testId: command.payload.testId,
        testRunId: command.payload.testRunId,
        status: result.status,
        durationMs: result.durationMs,
        screenshotCount: result.screenshots.length,
        error: result.error,
        logs: result.logs,
        softErrors: result.softErrors,
        videoData: result.videoData,
        videoFilename: result.videoFilename,
      });
      console.log(`[Test ${testId}] Sending result to server...`);
      const resultSent = await this.sendMessage(resultMsg);
      if (!resultSent) {
        console.warn(`[Test ${testId}] Result send failed, queuing for retry`);
        this.pendingResults.push(resultMsg);
      } else {
        console.log(`[Test ${testId}] Result sent: ${result.status}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Test ${testId}] handleRunTest error: ${errorMessage}`);
      await this.sendError(command.id, 'INTERNAL_ERROR', errorMessage);
    } finally {
      this.activeTestIds.delete(testId);
      this.activeTasks--;
      console.log(`[Test ${testId}] Cleanup done (activeTasks: ${this.activeTasks})`);
      if (this.activeTasks === 0) {
        this.status = 'idle';
        this.currentTask = undefined;
      }
    }
  }

  private async handleRunSetup(command: RunSetupCommand): Promise<void> {
    this.activeTasks++;
    this.status = 'busy';
    this.currentTask = `setup:${command.payload.setupId}`;

    // Override targetUrl if baseUrl is configured
    if (this.baseUrl) {
      console.log(`[Setup] Overriding targetUrl: ${command.payload.targetUrl} → ${this.baseUrl}`);
      command.payload.targetUrl = this.baseUrl.replace(/\/+$/, '');
    }

    try {
      console.log(`[Setup] Starting setup execution (commandId: ${command.id.slice(0, 8)}, timeout: ${command.payload.timeout}ms)`);

      const result = await this.runner.runSetup(command.payload);

      console.log(`[Setup] runSetup returned: status=${result.status}, duration=${result.durationMs}ms`);

      const resultMsg = createMessage<SetupResultResponse>('response:setup_result', {
        correlationId: command.id,
        status: result.status,
        storageState: result.storageState,
        variables: result.variables,
        durationMs: result.durationMs,
        error: result.error,
        logs: result.logs,
      });

      const sent = await this.sendMessage(resultMsg);
      if (!sent) {
        console.warn(`[Setup] Result send failed, queuing for retry`);
        this.pendingResults.push(resultMsg);
      } else {
        console.log(`[Setup] Result sent: ${result.status}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Setup] handleRunSetup error: ${errorMessage}`);
      await this.sendError(command.id, 'INTERNAL_ERROR', errorMessage);
    } finally {
      this.activeTasks--;
      if (this.activeTasks === 0) {
        this.status = 'idle';
        this.currentTask = undefined;
      }
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

  private async sendMessage(message: Message): Promise<boolean> {
    try {
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
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        console.error(`Send failed: ${response.status}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
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
