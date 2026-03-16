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
import { EmbeddedDebugExecutor } from './debug-executor.js';
import { CROSS_OS_CHROMIUM_ARGS } from './stabilization.js';

import os from 'os';

// Configuration from environment
const config = {
  serverUrl: process.env.LASTEST2_URL ?? 'http://localhost:3000',
  token: process.env.LASTEST2_TOKEN ?? '',
  systemToken: process.env.SYSTEM_EB_TOKEN ?? '',
  streamPort: parseInt(process.env.STREAM_PORT ?? '9223', 10),
  streamHost: process.env.STREAM_HOST ?? 'localhost', // Hostname for stream URL (EBs are always colocated with the app)
  pollInterval: parseInt(process.env.POLL_INTERVAL ?? '1000', 10),
  viewportWidth: parseInt(process.env.VIEWPORT_WIDTH ?? '1280', 10),
  viewportHeight: parseInt(process.env.VIEWPORT_HEIGHT ?? '720', 10),
  streamAuthToken: process.env.STREAM_AUTH_TOKEN,
  instanceId: process.env.INSTANCE_ID || os.hostname(),
};

if (!config.token && !config.systemToken) {
  console.error('Either LASTEST2_TOKEN or SYSTEM_EB_TOKEN is required');
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
let debugExecutor: EmbeddedDebugExecutor | null = null;
let debugStateReporter: ReturnType<typeof setInterval> | null = null;
let isRecording = false;
let isDebugging = false;
let recordingWatchdog: ReturnType<typeof setInterval> | null = null;
let lastRecordingEventTime = 0;
const RECORDING_INACTIVITY_TIMEOUT = 60_000; // 1 minute

// Concurrent test execution tracking (each test gets its own BrowserContext)
let activeTasks = 0;
const activeTestIds = new Set<string>();

async function startup(): Promise<void> {
  console.log('=== Embedded Browser Service ===');
  console.log(`Server: ${config.serverUrl}`);
  console.log(`Stream port: ${config.streamPort}`);
  console.log(`Viewport: ${config.viewportWidth}x${config.viewportHeight}`);

  // 1. Launch browser
  console.log('[Startup] Launching Chromium...');
  const useCrossOsArgs = process.env.CROSS_OS_CONSISTENCY !== 'false';
  browser = await chromium.launch({
    headless: true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      ...(useCrossOsArgs ? CROSS_OS_CHROMIUM_ARGS : []),
      '--disable-blink-features=AutomationControlled',
    ],
  });

  context = await browser.newContext({
    viewport: { width: config.viewportWidth, height: config.viewportHeight },
  });

  page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
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
    // During recording/debugging, navigate the active page instead of idle page
    const targetPage = (isDebugging && debugExecutor?.getPage())
      ? debugExecutor.getPage()
      : (isRecording && recorder?.isActive()) ? recorder.getPage() : page;
    if (!targetPage) return;
    console.log(`[Navigate] ${url} (${isDebugging ? 'debugging' : isRecording ? 'recording' : 'idle'} page)`);
    try {
      await targetPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      streamServer!.broadcastStatus('ready', targetPage.url());
    } catch (err) {
      console.error(`[Navigate] Failed:`, err);
    }
  };

  // Handle viewport resize requests from stream clients
  streamServer.onResize = async (newViewport: { width: number; height: number }) => {
    console.log(`[Resize] ${newViewport.width}x${newViewport.height}`);
    try {
      if (isDebugging && debugExecutor?.getPage()) {
        await debugExecutor.getPage()!.setViewportSize(newViewport);
      } else if (isRecording && recorder?.isActive()) {
        const recordingPage = recorder.getPage();
        if (recordingPage) await recordingPage.setViewportSize(newViewport);
      } else if (page) {
        await page.setViewportSize(newViewport);
      }
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

  // 4b. Notify clients when a file chooser dialog opens
  page.on('filechooser', () => {
    streamServer?.broadcastStatus('connected', page?.url(), undefined, true);
  });

  // 5. Connect as runner
  runnerClient = new EmbeddedRunnerClient({
    serverUrl: config.serverUrl,
    token: config.token || 'pending', // Will be replaced by system registration if systemToken is set
    streamPort: config.streamPort,
    streamHost: config.streamHost,
    pollInterval: config.pollInterval,
    systemToken: config.systemToken || undefined,
    instanceId: config.instanceId,
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
          storageState?: string;
          setupVariables?: Record<string, unknown>;
          cursorPlaybackSpeed?: number;
          stabilization?: import('./protocol.js').StabilizationPayload;
          headed?: boolean;
        };

        // Dedup: skip if already running (mirrors standard runner activeTestIds)
        if (activeTestIds.has(payload.testId)) {
          console.log(`[Command] Skipping duplicate test ${payload.testId}`);
          break;
        }
        activeTestIds.add(payload.testId);

        // Fire-and-forget concurrent execution (each test creates its own BrowserContext)
        const capturedClient = runnerClient;
        const capturedExecutor = testExecutor;
        const capturedBrowser = browser;
        const capturedCommand = command;

        activeTasks++;
        const isHeaded = !!payload.headed;
        if (activeTasks === 1) {
          capturedClient.setStatus('busy', payload.testId);
          streamServer?.broadcastStatus('busy', payload.targetUrl);
          if (!isHeaded) {
            // Pause screencast to free Chromium CPU for test execution
            await screencast?.stop();
          }
        }

        (async () => {
          try {
            const capturedScreencast = screencast;
            const capturedStreamServer = streamServer;
            const capturedPage = page; // idle page for screencast restore
            const shouldStreamTest = isHeaded && activeTasks === 1 && capturedScreencast && capturedStreamServer;

            const callbacks = shouldStreamTest ? {
              onPageCreated: async (testPage: Page) => {
                try {
                  await capturedScreencast.stop();
                  await capturedScreencast.start(testPage, (frame) => {
                    capturedStreamServer.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
                  });
                } catch (err) {
                  console.error('[Command] Failed to attach screencast to test page:', err);
                }
              },
              onBeforePageClose: async () => {
                try {
                  await capturedScreencast.stop();
                  // Restart on idle page immediately so there's no frame gap
                  if (capturedPage) {
                    await capturedScreencast.start(capturedPage, (frame) => {
                      capturedStreamServer.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
                    });
                  }
                } catch (err) {
                  console.error('[Command] Failed to restore screencast to idle page:', err);
                }
              },
            } : undefined;

            const result = await capturedExecutor.runTest(capturedBrowser, payload, callbacks);

            // Upload screenshots BEFORE result so they're in DB when executor sees "completed"
            if (result.screenshots.length > 0) {
              console.log(`[Command] Uploading ${result.screenshots.length} screenshots for test ${payload.testId}...`);
              await Promise.all(result.screenshots.map((screenshot) =>
                capturedClient.sendMessage({
                  id: crypto.randomUUID(),
                  type: 'response:screenshot',
                  timestamp: Date.now(),
                  payload: {
                    correlationId: capturedCommand.id,
                    testRunId: payload.testRunId,
                    repositoryId: payload.repositoryId,
                    filename: screenshot.filename,
                    data: screenshot.data,
                    width: screenshot.width,
                    height: screenshot.height,
                    capturedAt: Date.now(),
                  },
                })
              ));
              console.log(`[Command] All screenshots uploaded for test ${payload.testId}`);
            }

            // Send result AFTER screenshots so server has them when it sees pass/fail
            await capturedClient.sendMessage({
              id: crypto.randomUUID(),
              type: 'response:test_result',
              timestamp: Date.now(),
              payload: {
                correlationId: capturedCommand.id,
                testId: payload.testId,
                testRunId: payload.testRunId,
                status: result.status,
                durationMs: result.durationMs,
                screenshotCount: result.screenshots.length,
                error: result.error,
                logs: result.logs,
              },
            });
          } catch (err) {
            console.error(`[Command] Test ${payload.testId} failed:`, err);
          } finally {
            activeTestIds.delete(payload.testId);
            activeTasks--;
            if (activeTasks === 0) {
              capturedClient.setStatus('idle');
              streamServer?.broadcastStatus('ready');
              // Restart screencast on idle page (headed: already restored by onBeforePageClose,
              // but start() handles "already running" safely; headless: was stopped at test start)
              if (page && screencast && !isHeaded) {
                try {
                  await screencast.start(page, (frame) => {
                    streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
                  });
                } catch (err) {
                  console.error('[Command] Failed to restart screencast:', err);
                }
              }
            }
          }
        })();
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

        // Notify stream viewers before stopping screencast so they suppress stall detection
        streamServer?.broadcastStatus('busy');

        // Stop screencast/input on idle page
        await screencast?.stop();
        await inputHandler?.detach();

        try {
          // Start recording on a fresh context+page
          const recordingPage = await recorder.start(browser, payload, (events) => {
            lastRecordingEventTime = Date.now();
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

          // Start inactivity watchdog
          lastRecordingEventTime = Date.now();
          recordingWatchdog = setInterval(() => {
            if (isRecording && Date.now() - lastRecordingEventTime > RECORDING_INACTIVITY_TIMEOUT) {
              console.warn('[Watchdog] Recording inactive for 60s — auto-stopping');
              runnerClient?.onCommand?.({
                id: crypto.randomUUID(),
                type: 'command:stop_recording',
                timestamp: Date.now(),
                payload: { sessionId: payload.sessionId },
              });
            }
          }, 15_000);

          streamServer?.broadcastStatus('recording', recordingPage.url());
          console.log(`[Command] Recording started on fresh page, navigated to ${payload.targetUrl}`);
        } catch (err) {
          console.error(`[Command] Failed to start recording:`, err);
          isRecording = false;
          if (recordingWatchdog) { clearInterval(recordingWatchdog); recordingWatchdog = null; }
          // Force cleanup recorder if it partially started
          await recorder.forceCleanup();
          // Restore screencast/input on idle page
          if (page) {
            try {
              await screencast?.start(page, (frame) => {
                streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
              });
              await inputHandler?.attach(page);
            } catch (restoreErr) {
              console.error('[Command] Error restoring idle page after failed recording start:', restoreErr);
            }
          }
          runnerClient.setStatus('idle');
          streamServer?.broadcastStatus('ready');
        }
        break;
      }

      case 'command:stop_recording': {
        if (!runnerClient || !page) break;
        const payload = command.payload as { sessionId: string };

        // Clear watchdog first
        if (recordingWatchdog) { clearInterval(recordingWatchdog); recordingWatchdog = null; }

        if (isRecording && recorder) {
          try {
            await screencast?.stop();
            await inputHandler?.detach();
            await recorder.stop();
          } catch (err) {
            console.error('[Command] Error stopping recording:', err);
            await recorder.forceCleanup();
          }
          isRecording = false;

          // Re-attach screencast + input to idle page
          try {
            await screencast?.start(page, (frame) => {
              streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
            });
            await inputHandler?.attach(page);
          } catch (err) {
            console.error('[Command] Error restoring idle page:', err);
          }
        }

        // These ALWAYS execute regardless of errors above
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
            ? { correlationId: command.id, filename: `capture-${Date.now()}.png`, data: screenshot.data, width: screenshot.width, height: screenshot.height, capturedAt: Date.now() }
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

      case 'command:flag_download': {
        if (!recorder?.isActive()) break;
        recorder.flagDownload();
        console.log(`[Command] Flagged next click as download trigger`);
        break;
      }

      case 'command:insert_timestamp': {
        if (!recorder?.isActive()) break;
        await recorder.insertTimestamp();
        console.log(`[Command] Inserted timestamp`);
        break;
      }

      case 'command:start_debug': {
        if (!browser || !runnerClient) break;
        const payload = command.payload as {
          sessionId: string; testId: string; code: string;
          cleanBody: string; steps: import('./debug-executor.js').DebugStep[];
          targetUrl: string;
          viewport?: { width: number; height: number };
          storageState?: string;
          setupVariables?: Record<string, unknown>;
          stabilization?: import('./protocol.js').StabilizationPayload;
        };

        runnerClient.setStatus('busy', payload.sessionId);

        // Notify stream viewers before stopping screencast so they suppress stall detection
        streamServer?.broadcastStatus('busy');

        // Stop screencast/input on idle page
        await screencast?.stop();
        await inputHandler?.detach();

        try {
          debugExecutor = new EmbeddedDebugExecutor(browser);
          await debugExecutor.start(payload);

          // Attach screencast + input to the debug page
          const dbgPage = debugExecutor.getPage();
          if (dbgPage && screencast) {
            await screencast.start(dbgPage, (frame) => {
              streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
            });
            await inputHandler?.attach(dbgPage);
          }

          isDebugging = true;

          // Start state reporter (250ms interval)
          debugStateReporter = setInterval(() => {
            if (debugExecutor && runnerClient) {
              runnerClient.sendMessage({
                id: crypto.randomUUID(),
                type: 'response:debug_state',
                timestamp: Date.now(),
                payload: debugExecutor.getState(),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any).catch(() => {});
            }
          }, 250);

          streamServer?.broadcastStatus('debugging', payload.targetUrl);
          console.log(`[Command] Debug session started for test ${payload.testId}`);
        } catch (err) {
          console.error(`[Command] Failed to start debug session:`, err);
          isDebugging = false;
          if (debugStateReporter) { clearInterval(debugStateReporter); debugStateReporter = null; }
          if (debugExecutor) { await debugExecutor.stop(); debugExecutor = null; }
          // Restore idle page
          if (page) {
            try {
              await screencast?.start(page, (frame) => {
                streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
              });
              await inputHandler?.attach(page);
            } catch (restoreErr) {
              console.error('[Command] Error restoring idle page after failed debug start:', restoreErr);
            }
          }
          runnerClient.setStatus('idle');
          streamServer?.broadcastStatus('ready');
        }
        break;
      }

      case 'command:debug_action': {
        if (!debugExecutor || !runnerClient) break;
        const payload = command.payload as {
          sessionId: string;
          action: 'step_forward' | 'step_back' | 'run_to_end' | 'run_to_step' | 'update_code';
          stepIndex?: number;
          code?: string;
          cleanBody?: string;
          steps?: import('./debug-executor.js').DebugStep[];
        };

        await debugExecutor.handleAction(payload.action, payload);

        // After step_back, screencast needs restart on new page (old context closed)
        if (payload.action === 'step_back') {
          await screencast?.stop();
          await inputHandler?.detach();
          const newPage = debugExecutor.getPage();
          if (newPage && screencast) {
            await screencast.start(newPage, (frame) => {
              streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
            });
            await inputHandler?.attach(newPage);
          }
        }
        break;
      }

      case 'command:stop_debug': {
        if (!runnerClient || !page) break;

        // Clear state reporter
        if (debugStateReporter) { clearInterval(debugStateReporter); debugStateReporter = null; }

        if (isDebugging && debugExecutor) {
          try {
            await screencast?.stop();
            await inputHandler?.detach();
            await debugExecutor.stop();
          } catch (err) {
            console.error('[Command] Error stopping debug session:', err);
          }
          debugExecutor = null;
          isDebugging = false;

          // Re-attach screencast + input to idle page
          try {
            await screencast?.start(page, (frame) => {
              streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
            });
            await inputHandler?.attach(page);
          } catch (err) {
            console.error('[Command] Error restoring idle page after debug stop:', err);
          }
        }

        runnerClient.setStatus('idle');
        streamServer?.broadcastStatus('ready');
        console.log(`[Command] Debug session stopped`);
        break;
      }

      case 'command:cancel_test': {
        if (testExecutor) {
          testExecutor.abort();
          console.log('[Command] Test execution cancelled');
        }
        break;
      }

      case 'command:run_setup': {
        if (!browser || !testExecutor || !runnerClient) break;
        const payload = command.payload as {
          setupId: string; code: string; codeHash: string;
          targetUrl: string; timeout?: number;
          viewport?: { width: number; height: number };
          stabilization?: import('./protocol.js').StabilizationPayload;
          browser?: string;
        };

        // Fire-and-forget async (same activeTasks bookkeeping as run_test)
        const capturedClient = runnerClient;
        const capturedExecutor = testExecutor;
        const capturedBrowser = browser;
        const capturedCommand = command;

        activeTasks++;
        if (activeTasks === 1) {
          capturedClient.setStatus('busy', `setup:${payload.setupId}`);
          streamServer?.broadcastStatus('busy', payload.targetUrl);
          // Pause screencast to free Chromium CPU for setup execution
          await screencast?.stop();
        }

        (async () => {
          try {
            const result = await capturedExecutor.runSetup(capturedBrowser, payload);

            await capturedClient.sendMessage({
              id: crypto.randomUUID(),
              type: 'response:setup_result',
              timestamp: Date.now(),
              payload: {
                correlationId: capturedCommand.id,
                status: result.status,
                storageState: result.storageState,
                variables: result.variables,
                durationMs: result.durationMs,
                error: result.error,
                logs: result.logs,
              },
            });
          } catch (err) {
            console.error(`[Command] Setup ${payload.setupId} failed:`, err);
            // Send failed result so executor doesn't hang
            await capturedClient.sendMessage({
              id: crypto.randomUUID(),
              type: 'response:setup_result',
              timestamp: Date.now(),
              payload: {
                correlationId: capturedCommand.id,
                status: 'failed',
                durationMs: 0,
                error: err instanceof Error ? err.message : String(err),
                logs: [],
              },
            });
          } finally {
            activeTasks--;
            if (activeTasks === 0) {
              capturedClient.setStatus('idle');
              streamServer?.broadcastStatus('ready');
              // Restart screencast on idle page
              if (page && screencast) {
                try {
                  await screencast.start(page, (frame) => {
                    streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
                  });
                } catch (err) {
                  console.error('[Command] Failed to restart screencast:', err);
                }
              }
            }
          }
        })();
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
