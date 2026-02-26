/**
 * Embedded Browser Service
 *
 * Entry point for the embedded browser container.
 * Launches Playwright Chromium, starts CDP screencast streaming,
 * and connects to the main Lastest2 app as a runner.
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { ScreencastManager } from './screencast.js';
import { InputHandler } from './input-handler.js';
import { StreamServer } from './stream-server.js';
import { EmbeddedRunnerClient } from './runner-client.js';
import { EmbeddedTestExecutor } from './test-executor.js';
import { EmbeddedRecorder } from './embedded-recorder.js';

// Configuration from environment
const config = {
  serverUrl: process.env.LASTEST2_URL ?? 'http://localhost:3000',
  token: process.env.LASTEST2_TOKEN ?? '',
  streamPort: parseInt(process.env.STREAM_PORT ?? '9223', 10),
  streamHost: process.env.STREAM_HOST ?? '', // Public hostname for stream URL (empty = use os.hostname())
  pollInterval: parseInt(process.env.POLL_INTERVAL ?? '3000', 10),
  viewportWidth: parseInt(process.env.VIEWPORT_WIDTH ?? '1280', 10),
  viewportHeight: parseInt(process.env.VIEWPORT_HEIGHT ?? '720', 10),
  streamAuthToken: process.env.STREAM_AUTH_TOKEN,
};

if (!config.token) {
  console.error('LASTEST2_TOKEN is required');
  process.exit(1);
}

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let screencast: ScreencastManager | null = null;
let inputHandler: InputHandler | null = null;
let streamServer: StreamServer | null = null;
let runnerClient: EmbeddedRunnerClient | null = null;
let testExecutor: EmbeddedTestExecutor | null = null;
let recorder: EmbeddedRecorder | null = null;
let isRecording = false;

// Command queue to serialize test execution (prevents parallel page collisions)
const testCommandQueue: Array<() => Promise<void>> = [];
let isProcessingQueue = false;
const activeTestIds = new Set<string>();

async function processTestQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  while (testCommandQueue.length > 0) {
    const next = testCommandQueue.shift()!;
    try {
      await next();
    } catch (err) {
      console.error('[Queue] Task failed:', err);
    }
  }
  isProcessingQueue = false;
}

async function startup(): Promise<void> {
  console.log('=== Embedded Browser Service ===');
  console.log(`Server: ${config.serverUrl}`);
  console.log(`Stream port: ${config.streamPort}`);
  console.log(`Viewport: ${config.viewportWidth}x${config.viewportHeight}`);

  // 1. Launch browser
  console.log('[Startup] Launching Chromium...');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  context = await browser.newContext({
    viewport: { width: config.viewportWidth, height: config.viewportHeight },
  });

  page = await context.newPage();
  await page.goto('about:blank');
  console.log('[Startup] Browser ready');

  // 2. Start stream server
  streamServer = new StreamServer({
    port: config.streamPort,
    authToken: config.streamAuthToken,
  });
  streamServer.start();

  // 3. Start screencast
  screencast = new ScreencastManager({
    maxWidth: config.viewportWidth,
    maxHeight: config.viewportHeight,
    quality: 80,
    format: 'jpeg',
  });

  streamServer.setScreencast(screencast);

  // Handle navigate requests from stream clients (toolbar URL bar)
  streamServer.onNavigate = async (url: string) => {
    if (!page) return;
    console.log(`[Navigate] ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      streamServer!.broadcastStatus('ready', page.url());
    } catch (err) {
      console.error(`[Navigate] Failed:`, err);
    }
  };

  // Handle viewport resize requests from stream clients
  streamServer.onResize = async (newViewport: { width: number; height: number }) => {
    if (!page) return;
    console.log(`[Resize] ${newViewport.width}x${newViewport.height}`);
    try {
      await page.setViewportSize(newViewport);
    } catch (err) {
      console.error(`[Resize] Failed:`, err);
    }
  };

  await screencast.start(page, (frame) => {
    streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
  });

  // 4. Start input handler
  inputHandler = new InputHandler();
  await inputHandler.attach(page);
  streamServer.setInputHandler(inputHandler);

  // 5. Connect as runner
  runnerClient = new EmbeddedRunnerClient({
    serverUrl: config.serverUrl,
    token: config.token,
    streamPort: config.streamPort,
    streamHost: config.streamHost,
    pollInterval: config.pollInterval,
  });

  // Initialize test executor and recorder
  testExecutor = new EmbeddedTestExecutor();
  recorder = new EmbeddedRecorder();

  // Handle commands from main app
  runnerClient.onCommand = async (command) => {
    console.log(`[Command] Received: ${command.type}`);

    switch (command.type) {
      case 'command:run_test': {
        if (!browser || !testExecutor || !runnerClient) break;
        const payload = command.payload as {
          testId: string; testRunId: string; code: string;
          codeHash: string; targetUrl: string; timeout?: number;
          repositoryId?: string;
          viewport?: { width: number; height: number };
        };

        // Dedup: skip if already running/queued (mirrors standard runner activeTestIds)
        if (activeTestIds.has(payload.testId)) {
          console.log(`[Command] Skipping duplicate test ${payload.testId}`);
          break;
        }
        activeTestIds.add(payload.testId);

        // Queue test execution to prevent parallel page collisions
        const capturedClient = runnerClient;
        const capturedExecutor = testExecutor;
        const capturedBrowser = browser;
        testCommandQueue.push(async () => {
          try {
            capturedClient.setStatus('busy', payload.testId);
            streamServer?.broadcastStatus('busy', payload.targetUrl);

            const result = await capturedExecutor.runTest(capturedBrowser, payload);

            // Send result FIRST so server sees pass/fail before timeout
            await capturedClient.sendMessage({
              id: crypto.randomUUID(),
              type: 'response:test_result',
              timestamp: Date.now(),
              payload: {
                correlationId: command.id,
                testId: payload.testId,
                testRunId: payload.testRunId,
                status: result.status,
                durationMs: result.durationMs,
                screenshotCount: result.screenshots.length,
                error: result.error,
                logs: result.logs,
              },
            });

            // Upload screenshots separately (matching standard runner pattern)
            if (result.screenshots.length > 0) {
              console.log(`[Command] Uploading ${result.screenshots.length} screenshots...`);
              for (const screenshot of result.screenshots) {
                await capturedClient.sendMessage({
                  id: crypto.randomUUID(),
                  type: 'response:screenshot',
                  timestamp: Date.now(),
                  payload: {
                    correlationId: command.id,
                    testRunId: payload.testRunId,
                    repositoryId: payload.repositoryId,
                    filename: screenshot.filename,
                    data: screenshot.data,
                    width: screenshot.width,
                    height: screenshot.height,
                    capturedAt: Date.now(),
                  },
                });
              }
              console.log(`[Command] All screenshots uploaded`);
            }

            capturedClient.setStatus('idle');
            streamServer?.broadcastStatus('ready');
          } finally {
            activeTestIds.delete(payload.testId);
          }
        });
        processTestQueue();
        break;
      }

      case 'command:start_recording': {
        if (!browser || !runnerClient || !recorder) break;
        const payload = command.payload as {
          sessionId: string; targetUrl: string;
          viewport?: { width: number; height: number };
          selectorPriority?: Array<{ type: string; enabled: boolean; priority: number }>;
          pointerGestures?: boolean;
          cursorFPS?: number;
          setupSteps?: Array<{ code: string; codeHash: string }>;
        };

        runnerClient.setStatus('busy', payload.sessionId);

        // Stop screencast/input on idle page
        await screencast?.stop();
        await inputHandler?.detach();

        try {
          // Start recording on a fresh context+page
          const recordingPage = await recorder.start(browser, payload, (events) => {
            runnerClient!.sendMessage({
              id: crypto.randomUUID(),
              type: 'response:recording_event',
              timestamp: Date.now(),
              payload: { sessionId: payload.sessionId, events },
            });
          });

          // Attach screencast + input to the recording page
          await screencast?.start(recordingPage, (frame) => {
            streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
          });
          await inputHandler?.attach(recordingPage);
          isRecording = true;
          streamServer?.broadcastStatus('recording', recordingPage.url());
          console.log(`[Command] Recording started on fresh page, navigated to ${payload.targetUrl}`);
        } catch (err) {
          console.error(`[Command] Failed to start recording:`, err);
          isRecording = false;
          // Restore screencast/input on idle page
          if (page) {
            await screencast?.start(page, (frame) => {
              streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
            });
            await inputHandler?.attach(page);
          }
          runnerClient.setStatus('idle');
          streamServer?.broadcastStatus('ready');
        }
        break;
      }

      case 'command:stop_recording': {
        if (!runnerClient || !page) break;
        const payload = command.payload as { sessionId: string };

        if (isRecording && recorder) {
          // Stop screencast/input on recording page
          await screencast?.stop();
          await inputHandler?.detach();

          // Stop recording (closes recording context+page)
          await recorder.stop();
          isRecording = false;

          // Re-attach screencast + input to idle page
          await screencast?.start(page, (frame) => {
            streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
          });
          await inputHandler?.attach(page);
        }

        // Send recording stopped response
        await runnerClient.sendMessage({
          id: crypto.randomUUID(),
          type: 'response:recording_stopped',
          timestamp: Date.now(),
          payload: {
            sessionId: payload.sessionId,
            generatedCode: '',
          },
        });

        runnerClient.setStatus('idle');
        streamServer?.broadcastStatus('ready');
        console.log(`[Command] Recording stop handled`);
        break;
      }

      case 'command:capture_screenshot': {
        if (!runnerClient) break;
        // During recording, capture from the recording page
        let screenshot: { data: string; width: number; height: number } | null = null;
        if (isRecording && recorder?.isActive()) {
          screenshot = await recorder.takeScreenshot();
        } else if (page && testExecutor) {
          screenshot = await testExecutor.captureScreenshot(page);
        }
        await runnerClient.sendMessage({
          id: crypto.randomUUID(),
          type: 'response:screenshot',
          timestamp: Date.now(),
          payload: screenshot
            ? { correlationId: command.id, data: screenshot.data, width: screenshot.width, height: screenshot.height }
            : { correlationId: command.id, error: 'Failed to capture screenshot' },
        });
        break;
      }

      case 'command:create_assertion': {
        if (!recorder?.isActive() || !runnerClient) break;
        const assertPayload = command.payload as { sessionId: string; assertionType: string };
        recorder.createAssertion(assertPayload.assertionType);
        console.log(`[Command] Created assertion: ${assertPayload.assertionType}`);
        break;
      }

      case 'command:cancel_test': {
        if (testExecutor) {
          testExecutor.abort();
          console.log('[Command] Test execution cancelled');
        }
        break;
      }

      case 'command:ping': {
        await runnerClient?.sendMessage({
          id: crypto.randomUUID(),
          type: 'response:pong',
          timestamp: Date.now(),
          payload: { correlationId: command.id },
        });
        break;
      }

      default:
        console.warn(`[Command] Unknown command type: ${command.type}`);
    }
  };

  await runnerClient.start();
  console.log('[Startup] Fully operational');
}

async function shutdown(): Promise<void> {
  console.log('[Shutdown] Starting...');

  if (runnerClient) {
    await runnerClient.stop();
  }

  if (screencast) {
    await screencast.stop();
  }

  if (inputHandler) {
    await inputHandler.detach();
  }

  if (streamServer) {
    await streamServer.stop();
  }

  if (context) {
    await context.close();
  }

  if (browser) {
    await browser.close();
  }

  console.log('[Shutdown] Complete');
  process.exit(0);
}

// Health check endpoint (simple HTTP on same port + 1)
import { createServer } from 'http';

const healthPort = config.streamPort + 1;
const healthServer = createServer((req, res) => {
  if (req.url === '/health') {
    const healthy = browser?.isConnected() ?? false;
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      browser: healthy ? 'connected' : 'disconnected',
      clients: streamServer?.getClientCount() ?? 0,
      screencast: screencast?.isRunning() ?? false,
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(healthPort, () => {
  console.log(`[Health] Listening on port ${healthPort}`);
});

// Graceful shutdown
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start
startup().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
