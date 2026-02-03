/**
 * Runner Client
 * Connects to the server and handles commands.
 */

import os from 'os';
import type {
  Message,
  RunTestCommand,
  HeartbeatMessage,
  TestResultResponse,
  TestProgressResponse,
  ScreenshotUploadResponse,
  ErrorResponse,
  PongResponse,
  ConnectionEstablishedMessage,
} from './protocol.js';
import { createMessage } from './protocol.js';
import { TestRunner } from './runner.js';

interface ConnectResponse {
  runnerId: string;
  teamId: string;
  capabilities?: string[];
  commands?: Message[];
}

interface HeartbeatResponse {
  commands?: Message[];
}

export interface RunnerClientOptions {
  token: string;
  serverUrl: string;
  pollInterval?: number;
}

export class RunnerClient {
  private token: string;
  private serverUrl: string;
  private pollInterval: number;
  private running = false;
  private status: 'idle' | 'busy' | 'recording' = 'idle';
  private currentTask?: string;
  private runner: TestRunner;

  constructor(options: RunnerClientOptions) {
    this.token = options.token;
    this.serverUrl = options.serverUrl.replace(/\/$/, '');
    this.pollInterval = options.pollInterval ?? 5000;
    this.runner = new TestRunner();
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
    this.running = false;
    console.log('Runner stopped');
  }

  private async connect(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/api/ws/runner`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`Connection failed: ${response.status} ${text}`);
        return false;
      }

      const data = (await response.json()) as ConnectResponse;
      console.log(`Runner ID: ${data.runnerId}`);
      console.log(`Team ID: ${data.teamId}`);
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

        const response = await fetch(`${this.serverUrl}/api/ws/runner`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify(heartbeat),
        });

        if (response.ok) {
          const data = (await response.json()) as HeartbeatResponse;

          // Process any pending commands
          if (data.commands && data.commands.length > 0) {
            for (const cmd of data.commands) {
              await this.handleCommand(cmd);
            }
          }
        } else {
          console.error(`Heartbeat failed: ${response.status}`);
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

  private async handleRunTest(command: RunTestCommand): Promise<void> {
    this.status = 'busy';
    this.currentTask = command.payload.testRunId;

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
      for (const screenshot of result.screenshots) {
        const screenshotMsg = createMessage<ScreenshotUploadResponse>('response:screenshot', {
          correlationId: command.id,
          testRunId: command.payload.testRunId,
          filename: screenshot.filename,
          data: screenshot.data,
          width: screenshot.width,
          height: screenshot.height,
          capturedAt: Date.now(),
        });
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

  private async sendMessage(message: Message): Promise<void> {
    try {
      await fetch(`${this.serverUrl}/api/ws/runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(message),
      });
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }

  private async sendError(correlationId: string, code: string, message: string): Promise<void> {
    const errorMsg = createMessage<ErrorResponse>('response:error', {
      correlationId,
      code: code as any,
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
