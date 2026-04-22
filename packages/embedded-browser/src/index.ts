/**
 * Embedded Browser Service
 *
 * Entry point for the embedded browser container.
 * Launches Playwright Chromium, starts CDP screencast streaming,
 * and connects to the main Lastest app as a runner.
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
import { inspectElementAtPoint, getAllDomSelectors, type SelectorPriorityConfig } from './selector-utils.js';

import os from 'os';
import net from 'net';

// Configuration from environment
const streamPort = parseInt(process.env.STREAM_PORT ?? '9223', 10);
const config = {
  serverUrl: process.env.LASTEST_URL ?? 'http://localhost:3000',
  token: process.env.LASTEST_TOKEN ?? '',
  systemToken: process.env.SYSTEM_EB_TOKEN ?? '',
  streamPort,
  streamHost: process.env.STREAM_HOST ?? '', // Empty = auto-detect container IP
  pollInterval: parseInt(process.env.POLL_INTERVAL ?? '1000', 10),
  viewportWidth: parseInt(process.env.VIEWPORT_WIDTH ?? '1280', 10),
  viewportHeight: parseInt(process.env.VIEWPORT_HEIGHT ?? '720', 10),
  streamAuthToken: process.env.STREAM_AUTH_TOKEN,
  instanceId: process.env.INSTANCE_ID || os.hostname(),
  // Derive from streamPort when unset so multiple EBs sharing a network
  // namespace (e.g. k8s pod with eb1..eb5 sidecars) get unique CDP ports
  // and don't collide on 9222.
  cdpPort: parseInt(process.env.CDP_PORT ?? String(streamPort + 2), 10),
};

if (!config.token && !config.systemToken) {
  console.error('Either LASTEST_TOKEN or SYSTEM_EB_TOKEN is required');
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
  // Modern Chromium (106+) hard-codes `--remote-debugging-address=127.0.0.1`
  // as a security measure — the flag is silently ignored for non-localhost
  // values. That breaks @playwright/mcp (--cdp-endpoint) for healer/generator
  // agents when the EB runs in a separate k8s pod. Work around by binding
  // Chromium to localhost as usual, then running a tiny Node TCP proxy on
  // 0.0.0.0:<cdpPort> that forwards to 127.0.0.1:<cdpPort>.
  browser = await chromium.launch({
    headless: true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      ...(useCrossOsArgs ? CROSS_OS_CHROMIUM_ARGS : []),
      '--disable-blink-features=AutomationControlled',
      `--remote-debugging-port=${config.cdpPort}`,
    ],
  });
  console.log(`[Startup] CDP endpoint available at http://127.0.0.1:${config.cdpPort}`);

  // TCP proxy: expose the Chromium CDP port on all interfaces so other pods
  // can reach it. Plain byte pipe — CDP is WebSocket + HTTP, both just TCP.
  try {
    const cdpProxy = net.createServer((client) => {
      const upstream = net.createConnection(config.cdpPort, '127.0.0.1');
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      client.pipe(upstream);
      upstream.pipe(client);
    });
    cdpProxy.on('error', (err) => {
      console.error('[CDP proxy] error:', err);
    });
    await new Promise<void>((resolve) => {
      cdpProxy.listen(config.cdpPort + 10, '0.0.0.0', () => resolve());
    });
    console.log(`[Startup] CDP proxy listening on 0.0.0.0:${config.cdpPort + 10} → 127.0.0.1:${config.cdpPort}`);
  } catch (err) {
    console.error('[Startup] Failed to start CDP proxy (MCP tools from other pods will not work):', err);
  }

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

  // Handle inspect element requests (point-and-click selector inspector)
  streamServer.onInspectElement = async (x: number, y: number) => {
    const targetPage = (isDebugging && debugExecutor?.getPage())
      ? debugExecutor.getPage()
      : (isRecording && recorder?.isActive()) ? recorder.getPage() : page;
    if (!targetPage) return null;
    // Use default priority if no settings available
    const defaultPriority: SelectorPriorityConfig = [
      { type: 'data-testid', enabled: true, priority: 1 },
      { type: 'id', enabled: true, priority: 2 },
      { type: 'label', enabled: true, priority: 3 },
      { type: 'role-name', enabled: true, priority: 4 },
      { type: 'aria-label', enabled: true, priority: 5 },
      { type: 'text', enabled: true, priority: 6 },
      { type: 'placeholder', enabled: true, priority: 7 },
      { type: 'name', enabled: true, priority: 8 },
      { type: 'css-path', enabled: true, priority: 9 },
      { type: 'heading-context', enabled: true, priority: 10 },
    ];
    return inspectElementAtPoint(targetPage, x, y, defaultPriority);
  };

  // Handle DOM snapshot requests (download all selectors)
  streamServer.onDomSnapshot = async () => {
    const targetPage = (isDebugging && debugExecutor?.getPage())
      ? debugExecutor.getPage()
      : (isRecording && recorder?.isActive()) ? recorder.getPage() : page;
    if (!targetPage) return { elements: [], url: '', timestamp: Date.now() };
    const defaultPriority: SelectorPriorityConfig = [
      { type: 'data-testid', enabled: true, priority: 1 },
      { type: 'id', enabled: true, priority: 2 },
      { type: 'label', enabled: true, priority: 3 },
      { type: 'role-name', enabled: true, priority: 4 },
      { type: 'aria-label', enabled: true, priority: 5 },
      { type: 'text', enabled: true, priority: 6 },
      { type: 'placeholder', enabled: true, priority: 7 },
      { type: 'name', enabled: true, priority: 8 },
      { type: 'css-path', enabled: true, priority: 9 },
      { type: 'heading-context', enabled: true, priority: 10 },
    ];
    return getAllDomSelectors(targetPage, defaultPriority);
  };

  // Inject/remove a DOM-based highlight overlay that follows the mouse.
  // CDP Overlay.setInspectMode doesn't respond to Input.dispatchMouseEvent in
  // headless mode, so we inject a script that listens for native mousemove and
  // draws a highlight box + info tooltip on the element under the cursor.
  streamServer.onInspectModeChange = (enabled: boolean) => {
    const targetPage = (isDebugging && debugExecutor?.getPage())
      ? debugExecutor.getPage()
      : (isRecording && recorder?.isActive()) ? recorder.getPage() : page;
    if (!targetPage) return;

    if (enabled) {
      targetPage.evaluate(() => {
        // Remove previous if any
        document.getElementById('__lastest_inspect_overlay')?.remove();
        document.getElementById('__lastest_inspect_tooltip')?.remove();

        const overlay = document.createElement('div');
        overlay.id = '__lastest_inspect_overlay';
        overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #3b82f6;background:rgba(59,130,246,0.08);border-radius:2px;transition:all 0.05s ease-out;display:none;';
        document.documentElement.appendChild(overlay);

        const tooltip = document.createElement('div');
        tooltip.id = '__lastest_inspect_tooltip';
        tooltip.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#1f2937;color:#e5e7eb;font:11px/1.4 system-ui,sans-serif;padding:3px 8px;border-radius:4px;white-space:nowrap;display:none;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        document.documentElement.appendChild(tooltip);

        function onMove(e: MouseEvent) {
          const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
          if (!el || el === overlay || el === tooltip || el === document.body || el === document.documentElement) {
            overlay.style.display = 'none';
            tooltip.style.display = 'none';
            return;
          }
          const rect = el.getBoundingClientRect();
          overlay.style.display = 'block';
          overlay.style.left = rect.x + 'px';
          overlay.style.top = rect.y + 'px';
          overlay.style.width = rect.width + 'px';
          overlay.style.height = rect.height + 'px';

          // Build tooltip text
          let info = el.tagName.toLowerCase();
          if (el.id) info += '#' + el.id;
          const cls = el.className;
          if (typeof cls === 'string' && cls.trim()) {
            info += '.' + cls.trim().split(/\s+/).slice(0, 2).join('.');
          }
          info += '  ' + Math.round(rect.width) + ' \u00d7 ' + Math.round(rect.height);
          tooltip.textContent = info;
          tooltip.style.display = 'block';

          // Position tooltip above or below the element
          const ttRect = tooltip.getBoundingClientRect();
          let tx = rect.x;
          let ty = rect.y - ttRect.height - 6;
          if (ty < 0) ty = rect.bottom + 6;
          if (tx + ttRect.width > window.innerWidth) tx = window.innerWidth - ttRect.width - 4;
          if (tx < 0) tx = 4;
          tooltip.style.left = tx + 'px';
          tooltip.style.top = ty + 'px';
        }

        document.addEventListener('mousemove', onMove, true);
        // Store cleanup reference
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__lastest_inspect_cleanup = () => {
          document.removeEventListener('mousemove', onMove, true);
          overlay.remove();
          tooltip.remove();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (window as any).__lastest_inspect_cleanup;
        };
      }).catch(err => console.error('[Inspect] Failed to inject overlay script:', err));
      console.log('[Inspect] DOM overlay injected');
    } else {
      targetPage.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__lastest_inspect_cleanup?.();
      }).catch(() => {});
      console.log('[Inspect] DOM overlay removed');
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
    // Register the PROXY port as the externally-reachable CDP endpoint. The
    // raw Chromium CDP socket is 127.0.0.1-only (see TCP proxy above).
    cdpPort: config.cdpPort + 10,
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
          forceVideoRecording?: boolean;
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
            const testViewport = payload.viewport ?? { width: config.viewportWidth, height: config.viewportHeight };

            const callbacks = shouldStreamTest ? {
              onPageCreated: async (testPage: Page) => {
                try {
                  // Force the test page to render at the test's configured viewport so the
                  // streamed framebuffer matches the resolution the test was authored for.
                  const cdp = await testPage.context().newCDPSession(testPage);
                  await cdp.send('Emulation.setDeviceMetricsOverride', {
                    width: testViewport.width,
                    height: testViewport.height,
                    deviceScaleFactor: 1,
                    mobile: false,
                  });
                  await cdp.detach();

                  await capturedScreencast.stop();
                  await capturedScreencast.updateViewport(testViewport.width, testViewport.height);
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

            // Split network requests: summary for inline result, full bodies sent separately
            const networkSummaries = result.networkRequests?.map(r => ({
              url: r.url,
              method: r.method,
              status: r.status,
              duration: r.duration,
              resourceType: r.resourceType,
              startTime: r.startTime,
              failed: r.failed,
              errorText: r.errorText,
              responseSize: r.responseSize,
            }));
            const hasNetworkBodies = result.networkRequests?.some(
              r => r.requestHeaders || r.responseHeaders || r.postData || r.responseBody
            );

            // Send result AFTER screenshots so server has them when it sees pass/fail
            await capturedClient.sendMessage({
              id: crypto.randomUUID(),
              type: 'response:test_result',
              timestamp: Date.now(),
              payload: {
                correlationId: capturedCommand.id,
                testId: payload.testId,
                testRunId: payload.testRunId,
                repositoryId: payload.repositoryId,
                status: result.status,
                durationMs: result.durationMs,
                screenshotCount: result.screenshots.length,
                error: result.error,
                logs: result.logs,
                consoleErrors: result.consoleErrors,
                networkRequests: networkSummaries,
                softErrors: result.softErrors,
                videoData: result.videoData,
                videoFilename: result.videoFilename,
                lastReachedStep: result.lastReachedStep,
                totalSteps: result.totalSteps,
                domSnapshot: result.domSnapshot,
              },
            });

            // Send full network body data. Awaited so that if a SIGTERM arrives
            // immediately after test completion, the payload is flushed before
            // shutdown()'s drain() returns.
            if (hasNetworkBodies && result.networkRequests) {
              try {
                await capturedClient.sendMessage({
                  id: crypto.randomUUID(),
                  type: 'response:network_bodies' as 'response:test_result',
                  timestamp: Date.now(),
                  payload: {
                    correlationId: capturedCommand.id,
                    testId: payload.testId,
                    testRunId: payload.testRunId,
                    repositoryId: payload.repositoryId,
                    networkRequests: result.networkRequests,
                  },
                });
              } catch (err) {
                console.warn(`[Command] Failed to send network bodies for test ${payload.testId}:`, err);
              }
            }
          } catch (err) {
            console.error(`[Command] Test ${payload.testId} failed:`, err);
          } finally {
            activeTestIds.delete(payload.testId);
            activeTasks--;
            if (activeTasks === 0) {
              // Post-task cleanup: ensure clean state for next pool assignment
              if (browser) {
                // Close any lingering contexts (leaked from crashed tests)
                const contexts = browser.contexts();
                for (const ctx of contexts) {
                  if (ctx !== context) {
                    try { await ctx.close(); } catch {}
                  }
                }
                // Clear idle context state so next task starts fresh
                if (context) {
                  try {
                    await context.clearCookies();
                    await context.clearPermissions();
                    if (page) await page.goto('about:blank');
                  } catch {}
                }
              }

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
        // Reset inspect mode (may have been left on by a debug session)
        if (streamServer) {
          streamServer.inspectMode = false;
        }
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

        // Reset inspect mode when stopping recording
        if (streamServer) streamServer.inspectMode = false;

        // Clear watchdog first
        if (recordingWatchdog) { clearInterval(recordingWatchdog); recordingWatchdog = null; }

        // Capture final DOM snapshot on the recording page BEFORE stopping —
        // the test baseline needs this to compute DOM deltas at run time.
        let recordingDomSnapshot: Awaited<ReturnType<typeof getAllDomSelectors>> | undefined;
        if (isRecording && recorder?.isActive()) {
          const recPage = recorder.getPage();
          if (recPage && !recPage.isClosed()) {
            try {
              const defaultPriority: SelectorPriorityConfig = [
                { type: 'data-testid', enabled: true, priority: 1 },
                { type: 'id', enabled: true, priority: 2 },
                { type: 'label', enabled: true, priority: 3 },
                { type: 'role-name', enabled: true, priority: 4 },
                { type: 'aria-label', enabled: true, priority: 5 },
                { type: 'text', enabled: true, priority: 6 },
                { type: 'placeholder', enabled: true, priority: 7 },
                { type: 'name', enabled: true, priority: 8 },
                { type: 'css-path', enabled: true, priority: 9 },
                { type: 'heading-context', enabled: true, priority: 10 },
              ];
              recordingDomSnapshot = await getAllDomSelectors(recPage, defaultPriority);
            } catch (err) {
              console.warn('[Command] Failed to capture recording DOM snapshot:', err);
            }
          }
        }

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
            domSnapshot: recordingDomSnapshot,
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
        // Remember & reset inspect mode from any previous session
        const wasInspecting = streamServer?.inspectMode ?? false;
        if (streamServer) {
          streamServer.inspectMode = false;
        }
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
            // Force the debug page to render at the EB's native resolution
            const cdp = await dbgPage.context().newCDPSession(dbgPage);
            await cdp.send('Emulation.setDeviceMetricsOverride', {
              width: config.viewportWidth,
              height: config.viewportHeight,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await cdp.detach();

            await screencast.start(dbgPage, (frame) => {
              streamServer!.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
            });
            await inputHandler?.attach(dbgPage);
          }

          isDebugging = true;

          // Re-inject inspect overlay on the new debug page if it was active
          if (wasInspecting && streamServer) {
            streamServer.inspectMode = true;
            streamServer.onInspectModeChange?.(true);
          }

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
            // Force the new debug page to render at the EB's native resolution
            const cdp = await newPage.context().newCDPSession(newPage);
            await cdp.send('Emulation.setDeviceMetricsOverride', {
              width: config.viewportWidth,
              height: config.viewportHeight,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await cdp.detach();

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

        // Remember & reset inspect mode
        const debugWasInspecting = streamServer?.inspectMode ?? false;
        if (streamServer) streamServer.inspectMode = false;

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

          // Re-inject inspect overlay on the idle page if it was active
          if (debugWasInspecting && streamServer) {
            streamServer.inspectMode = true;
            streamServer.onInspectModeChange?.(true);
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
          headed?: boolean;
        };

        // Fire-and-forget async (same activeTasks bookkeeping as run_test)
        const capturedClient = runnerClient;
        const capturedExecutor = testExecutor;
        const capturedBrowser = browser;
        const capturedCommand = command;
        const setupHeaded = !!payload.headed;

        activeTasks++;
        if (activeTasks === 1) {
          capturedClient.setStatus('busy', `setup:${payload.setupId}`);
          streamServer?.broadcastStatus('busy', payload.targetUrl);
          if (!setupHeaded) {
            // Pause screencast to free Chromium CPU for setup execution.
            // In headed (debug) mode we keep it alive and re-route it to the
            // setup page in the onPageCreated callback below.
            await screencast?.stop();
          }
        }

        (async () => {
          try {
            const capturedScreencast = screencast;
            const capturedStreamServer = streamServer;
            const shouldStreamSetup = setupHeaded && activeTasks === 1 && capturedScreencast && capturedStreamServer;
            const setupViewport = payload.viewport ?? { width: config.viewportWidth, height: config.viewportHeight };

            const setupCallbacks = shouldStreamSetup ? {
              onPageCreated: async (setupPage: Page) => {
                try {
                  // Force the setup page to render at the configured viewport so the
                  // streamed framebuffer matches what the user expects to see.
                  const cdp = await setupPage.context().newCDPSession(setupPage);
                  await cdp.send('Emulation.setDeviceMetricsOverride', {
                    width: setupViewport.width,
                    height: setupViewport.height,
                    deviceScaleFactor: 1,
                    mobile: false,
                  });
                  await cdp.detach();

                  await capturedScreencast.stop();
                  await capturedScreencast.updateViewport(setupViewport.width, setupViewport.height);
                  await capturedScreencast.start(setupPage, (frame) => {
                    capturedStreamServer.broadcastFrame(frame.data, frame.width, frame.height, frame.timestamp);
                  });
                } catch (err) {
                  console.error('[Command] Failed to attach screencast to setup page:', err);
                }
              },
            } : undefined;

            const result = await capturedExecutor.runSetup(capturedBrowser, payload, setupCallbacks);

            await capturedClient.sendMessage({
              id: crypto.randomUUID(),
              type: 'response:setup_result',
              timestamp: Date.now(),
              payload: {
                correlationId: capturedCommand.id,
                status: result.status,
                storageState: result.storageState,
                storageStateJson: result.storageStateJson,
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

      case 'command:shutdown': {
        // Graceful shutdown initiated by the server (typically by
        // maybeTerminateReleasedEB before the k8s Job is DELETEd).
        // Detach the command loop and enter shutdown(); shutdown() will
        // drain any in-flight sendMessage promises before process.exit.
        const reason = (command.payload as { reason?: string } | undefined)?.reason ?? 'server-requested';
        console.log(`[Command] Shutdown requested: ${reason}`);
        void shutdown();
        break;
      }

      default:
        console.warn(`[Command] Unknown command type: ${command.type}`);
    }
  };

  await runnerClient.start();
  console.log('[Startup] Fully operational');
}

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[Shutdown] Starting...');

  if (runnerClient) {
    // Drain any in-flight test_result / screenshot / network_bodies POSTs
    // BEFORE stopping the runner loop. 15s covers typical k8s termination
    // grace (we set terminationGracePeriodSeconds=60 on the Job template).
    try {
      await runnerClient.drain(15_000);
    } catch (err) {
      console.warn('[Shutdown] drain error:', err);
    }
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
