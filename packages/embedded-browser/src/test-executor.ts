/**
 * Test Executor for Embedded Browser
 *
 * Executes test code against the live shared page (no new browser launch).
 * Uses the same `new Function()` pattern as `packages/runner/src/runner.ts`
 * but adapted for the embedded context.
 *
 * Features mirrored from the standard runner:
 * - Stabilization (freeze timestamps/random/animations, wait for network idle/DOM/canvas)
 * - StorageState injection
 * - Timeout handling with context.close to kill in-flight ops
 * - Heartbeat logging
 * - RAF flush wrapping for actions
 * - locateWithFallback with { type, value } selectors, ocr-text, role-name, coordinate fallback
 * - Speed-aware replayCursorPath
 * - stepLogger with softExpect/softAction
 * - Robust stripTypeAnnotations
 * - Removal of test-local function definitions
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import type { StabilizationPayload } from './protocol.js';
import { setupFreezeScripts, applyPreScreenshotStabilization } from './stabilization.js';
import { getAllDomSelectors, type DomSnapshotResult, type SelectorPriorityConfig } from './selector-utils.js';
import { instrumentAssertionTracking, instrumentStepTracking, stripTypeAnnotations, watermarkVideo } from '@lastest/shared';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_DOM_SNAPSHOT_PRIORITY: SelectorPriorityConfig = [
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

export interface EmbeddedNetworkRequest {
  url: string;
  method: string;
  status: number;
  duration: number;
  resourceType: string;
  failed?: boolean;
  errorText?: string;
  startTime?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
  responseBody?: string;
  responseSize?: number;
}

export interface EmbeddedTestResult {
  status: 'passed' | 'failed' | 'error' | 'timeout' | 'cancelled';
  durationMs: number;
  error?: { message: string; stack?: string; screenshot?: string };
  logs: Array<{ timestamp: number; level: string; message: string }>;
  screenshots: Array<{ filename: string; data: string; width: number; height: number }>;
  consoleErrors?: string[];
  networkRequests?: EmbeddedNetworkRequest[];
  softErrors?: string[];
  /** One entry per `expect(...)` call wrapped by `instrumentAssertionTracking`.
   *  `assertionId` matches a parsed `TestAssertion.id` from the host. The
   *  Criteria evaluator (`src/lib/execution/evaluation.ts`) keys on these to
   *  promote a soft assertion failure to a hard test failure. */
  assertionResults?: Array<{
    assertionId: string;
    status: 'passed' | 'failed' | 'skipped';
    actualValue?: string;
    errorMessage?: string;
    durationMs?: number;
  }>;
  videoData?: string; // base64-encoded video file
  videoFilename?: string;
  lastReachedStep?: number;
  totalSteps?: number;
  domSnapshot?: DomSnapshotResult; // DOM state captured after test body ran
  extractedVariables?: Record<string, string>; // Values pulled from page fields by extract-mode TestVariables
}

export interface EmbeddedSetupResult {
  status: 'passed' | 'failed' | 'error' | 'timeout';
  storageState?: string;
  // Serialized JSON of the captured storageState. `storageState` above may be
  // a "persistent:<setupId>" marker that instructs the test-executor to reuse
  // the live BrowserContext; consumers that can't access that in-process map
  // (e.g. the debug-executor) need the real JSON here.
  storageStateJson?: string;
  variables?: Record<string, unknown>;
  durationMs: number;
  error?: string;
  logs: Array<{ timestamp: number; level: string; message: string }>;
}

export interface RunSetupPayload {
  setupId: string;
  code: string;
  codeHash: string;
  targetUrl: string;
  timeout?: number;
  viewport?: { width: number; height: number };
  stabilization?: StabilizationPayload;
  browser?: string;
  headed?: boolean;
}

export interface RunTestPayload {
  testId: string;
  testRunId: string;
  code: string;
  codeHash: string;
  targetUrl: string;
  timeout?: number;
  viewport?: { width: number; height: number };
  repositoryId?: string;
  storageState?: string;
  setupVariables?: Record<string, unknown>;
  cursorPlaybackSpeed?: number;
  stabilization?: StabilizationPayload;
  consoleErrorMode?: 'fail' | 'warn' | 'ignore';
  networkErrorMode?: 'fail' | 'warn' | 'ignore';
  ignoreExternalNetworkErrors?: boolean;
  enableNetworkInterception?: boolean;
  acceptDownloads?: boolean;
  forceVideoRecording?: boolean;
  extractVariables?: Array<{
    name: string;
    targetSelector: string;
    attribute?: 'value' | 'textContent' | 'innerText' | 'innerHTML';
  }>;
  /** Parsed assertions from the host's `parseAssertions(code)`. The runner
   *  uses `(codeLineStart, codeLineEnd)` as a registry to map each runtime
   *  `expect(...)` call to the right parsed `id`, so the host stays the
   *  single source of truth for id computation. */
  assertions?: Array<{
    id: string;
    codeLineStart?: number;
    codeLineEnd?: number;
  }>;
}

/**
 * Remove a named async function definition from a code body by brace-matching.
 */
function removeFunctionDefinition(body: string, funcName: string): { body: string; removed: boolean } {
  const pattern = `async function ${funcName}`;
  if (!body.includes(pattern)) return { body, removed: false };

  const regex = new RegExp(`async function ${funcName}\\s*\\([^)]*\\)\\s*\\{`);
  const startMatch = body.match(regex);
  if (!startMatch || startMatch.index === undefined) return { body, removed: false };

  const startIdx = startMatch.index;
  const braceStart = body.indexOf('{', startIdx);
  let depth = 1;
  let endIdx = braceStart + 1;
  while (depth > 0 && endIdx < body.length) {
    if (body[endIdx] === '{') depth++;
    else if (body[endIdx] === '}') depth--;
    endIdx++;
  }
  return {
    body: body.slice(0, startIdx) + `/* ${funcName} provided by runner */` + body.slice(endIdx),
    removed: true,
  };
}

export class EmbeddedTestExecutor {
  private abortController: AbortController | null = null;
  // Persistent setup contexts — setup stores its BrowserContext here keyed by setupId.
  // Subsequent tests in the same run reuse it (preserves sessionStorage/IndexedDB/
  // in-memory auth that Playwright's storageState() can't capture). We also store
  // a serialized storageState snapshot alongside — if Chromium disposes the live
  // context's target for any reason (observed behavior between tests), subsequent
  // tests can rebuild a fresh context with the same cookies/localStorage.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private setupContexts = new Map<string, { context: BrowserContext; createdAt: number; storageState?: any; viewport?: { width: number; height: number } }>();
  private setupContextSweeper: ReturnType<typeof setInterval> | null = null;
  // Live persistent BrowserContext TTL. Must comfortably exceed a full build's
  // wall-clock time (setup + all tests on this worker). Default 60 min; override
  // via EB_SETUP_CONTEXT_TTL_MS env.
  private readonly SETUP_CONTEXT_TTL_MS = parseInt(process.env.EB_SETUP_CONTEXT_TTL_MS || String(60 * 60 * 1000), 10);

  get isRunning(): boolean {
    return this.abortController !== null;
  }

  abort(): boolean {
    if (this.abortController) {
      this.abortController.abort();
      return true;
    }
    return false;
  }

  private ensureSetupContextSweeper() {
    if (this.setupContextSweeper) return;
    this.setupContextSweeper = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.setupContexts) {
        if (now - entry.createdAt > this.SETUP_CONTEXT_TTL_MS) {
          console.log(`  [INFO] Evicting persistent setup context ${id} (TTL exceeded)`);
          entry.context.close().catch(() => {});
          this.setupContexts.delete(id);
        }
      }
      if (this.setupContexts.size === 0) {
        clearInterval(this.setupContextSweeper!);
        this.setupContextSweeper = null;
      }
    }, 60 * 1000);
    if (this.setupContextSweeper.unref) this.setupContextSweeper.unref();
  }

  async releaseSetupContext(setupId: string): Promise<void> {
    const entry = this.setupContexts.get(setupId);
    if (!entry) return;
    this.setupContexts.delete(setupId);
    await entry.context.close().catch(() => {});
  }

  async runTest(
    browser: Browser,
    command: RunTestPayload,
    callbacks?: {
      onPageCreated?: (page: Page) => Promise<void> | void;
      onBeforePageClose?: () => Promise<void> | void;
    },
  ): Promise<EmbeddedTestResult> {
    const abortCtrl = new AbortController();
    this.abortController = abortCtrl;

    const startTime = Date.now();
    const logs: Array<{ timestamp: number; level: string; message: string }> = [];
    const screenshots: Array<{ filename: string; data: string; width: number; height: number }> = [];
    const softErrors: string[] = [];
    const assertionResults: NonNullable<EmbeddedTestResult['assertionResults']> = [];
    const consoleErrors: string[] = [];
    let allNetworkRequests: EmbeddedNetworkRequest[] = [];
    const testTimeout = Math.max(command.timeout || 120000, 30000);

    const logFn = (level: string, message: string) => {
      logs.push({ timestamp: Date.now(), level, message });
      console.log(`  [${level.toUpperCase()}] [embedded:${command.testId}] ${message}`);
    };

    const viewport = command.viewport || { width: 1280, height: 720 };

    // Determine context options based on stabilization settings
    const needsStabilizedContext = command.stabilization?.crossOsConsistency || command.stabilization?.freezeAnimations;

    // Parse storageState. "persistent:<setupId>" marker → reuse setup's live context.
    let persistentSetupId: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedStorageState: any;
    if (command.storageState) {
      if (command.storageState.startsWith('persistent:')) {
        persistentSetupId = command.storageState.slice('persistent:'.length);
      } else {
        try {
          parsedStorageState = JSON.parse(command.storageState);
          logFn('info', `Injecting storageState: ${parsedStorageState.cookies?.length ?? 0} cookies, ${parsedStorageState.origins?.length ?? 0} origins`);
        } catch (e) {
          logFn('warn', `Failed to parse storageState: ${e}`);
        }
      }
    }

    // Set up video recording if requested
    const videoEnabled = command.forceVideoRecording;
    const videoDir = videoEnabled ? path.join(os.tmpdir(), `lastest-video-${Date.now()}`) : undefined;
    if (videoDir) {
      fs.mkdirSync(videoDir, { recursive: true });
    }

    // Persistent-context branch: reuse setup's live context; skip storageState serialization.
    // Limitations: per-test video + context-level stabilization overrides can't be applied.
    let testContext: BrowserContext;
    let reusedPersistentContext = false;
    const buildFreshContext = async (state: unknown) => {
      return browser.newContext({
        viewport,
        acceptDownloads: true,
        ...(state ? { storageState: state as Parameters<Browser['newContext']>[0] extends infer T ? T extends { storageState?: infer S } ? S : never : never } : {}),
        ...(needsStabilizedContext ? { deviceScaleFactor: 1 } : {}),
        ...(needsStabilizedContext ? { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' as const } : {}),
        ...(command.stabilization?.freezeAnimations ? { reducedMotion: 'reduce' as const } : {}),
        ...(videoDir ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
      });
    };
    if (persistentSetupId) {
      const entry = this.setupContexts.get(persistentSetupId);
      if (entry) {
        if (videoDir) {
          logFn('warn', 'Per-test video recording not supported in persistent-context mode — disabled');
        }
        testContext = entry.context;
        reusedPersistentContext = true;
        logFn('info', `Reusing persistent setup context (setupId=${persistentSetupId})`);
      } else {
        logFn('warn', `persistent setup context ${persistentSetupId} not found — falling back to fresh context (auth state will be missing)`);
        testContext = await buildFreshContext(undefined);
      }
    } else {
      // Create a fresh context + page per test (mirrors standard runner)
      testContext = await buildFreshContext(parsedStorageState);
    }

    // FALLBACK: Chromium sometimes disposes a persistent BrowserContext's
    // target between tests (observed: test N passes, test N+1 throws "Target
    // has been closed" on newPage). When that happens, rebuild a fresh
    // context using the storageState snapshot we captured during setup, so
    // the test still runs with the right cookies/localStorage even though
    // sessionStorage/IndexedDB/in-memory auth are lost.
    let page;
    try {
      page = await testContext.newPage();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (reusedPersistentContext && /Target .*has been closed|has been closed/i.test(msg)) {
        logFn('warn', `Persistent context for ${persistentSetupId} is zombie — rebuilding fresh context from storageState snapshot`);
        const snapshotEntry = this.setupContexts.get(persistentSetupId!);
        const snapshot = snapshotEntry?.storageState;
        // Drop the dead context from the map so other tests don't hit it too.
        this.setupContexts.delete(persistentSetupId!);
        try { await snapshotEntry?.context.close(); } catch { /* already dead */ }
        testContext = await buildFreshContext(snapshot);
        reusedPersistentContext = false;
        page = await testContext.newPage();
      } else {
        throw err;
      }
    }
    if (reusedPersistentContext) {
      try { await page.setViewportSize(viewport); } catch { /* best-effort */ }
    }
    if (callbacks?.onPageCreated) {
      await callbacks.onPageCreated(page);
    }

    let result: EmbeddedTestResult | undefined;
    let reachedStep = -1;
    let stepCount = 0;
    let domSnapshot: DomSnapshotResult | undefined;
    const captureFinalDomSnapshot = async () => {
      if (!page || page.isClosed()) return;
      try {
        domSnapshot = await getAllDomSelectors(page, DEFAULT_DOM_SNAPSHOT_PRIORITY);
      } catch (err) {
        logFn('warn', `DOM snapshot capture failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    try {
      if (abortCtrl.signal.aborted) {
        throw new Error('Test cancelled before starting');
      }

      // Set default timeouts (mirrors standard runner)
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      // Intercept File System Access API so blob downloads trigger Playwright's download event.
      // Always inject — native file dialogs hang forever in headless mode.
      await page.addInitScript(() => {
        if (typeof window !== 'undefined') {
          (window as unknown as Record<string, unknown>).showSaveFilePicker = async function (...args: unknown[]) {
            const opts = (args[0] ?? {}) as Record<string, unknown>;
            const suggestedName = (opts.suggestedName as string) || 'download';
            console.log('[lastest-shim] showSaveFilePicker called:', suggestedName);
            const chunks: BlobPart[] = [];
            return {
              createWritable: async () => ({
                write: async (data: BlobPart) => { chunks.push(data); },
                seek: async () => {},
                truncate: async () => {},
                close: async () => {
                  console.log('[lastest-shim] writable.close() — triggering download:', suggestedName, 'chunks:', chunks.length);
                  const blob = new Blob(chunks);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = suggestedName;
                  a.style.display = 'none';
                  document.body.appendChild(a);
                  a.click();
                  console.log('[lastest-shim] <a> clicked, download should fire');
                  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
                },
              }),
              getFile: async () => new File(chunks, suggestedName),
            };
          };
        }
      });

      // Setup freeze scripts (timestamps, random, animations) BEFORE any navigation
      if (command.stabilization) {
        await setupFreezeScripts(page, command.stabilization);
        logFn('info', `Stabilization: freeze timestamps=${command.stabilization.freezeTimestamps}, random=${command.stabilization.freezeRandomValues}, animations=${command.stabilization.freezeAnimations}, crossOS=${command.stabilization.crossOsConsistency}`);
      }

      // Page event listeners — capture console errors and network requests
      // Environmental transient errors (CNI/DNS/NAT bursts when 30 EB pods start
      // near-simultaneously) surface as `ERR_NETWORK_CHANGED` / `ERR_NAME_NOT_RESOLVED`
      // on sub-resource loads fired AFTER the main navigation — unrelated to
      // the test's intent. Keep them out of the failure classification; log as
      // info so they're still traceable.
      const TRANSIENT_NET_CONSOLE_RX = /ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_NETWORK_IO_SUSPENDED/i;
      page.on('console', (msg) => {
        const text = msg.text();
        // Log shim messages to container output for debugging
        if (text.startsWith('[lastest-shim]')) {
          logFn('info', text);
        }
        if (msg.type() === 'error') {
          if (TRANSIENT_NET_CONSOLE_RX.test(text)) {
            logFn('info', `Transient network console error (ignored for classification): ${text}`);
            return;
          }
          consoleErrors.push(text);
          logFn('warn', `Console error: ${text}`);
        }
      });
      page.on('pageerror', (err) => logFn('warn', `Page error: ${err.message}`));

      // Network request capture (all requests, not just failures)
      const captureNetworkBodies = command.enableNetworkInterception ?? false;
      page.on('request', (req) => {
        allNetworkRequests.push({
          url: req.url(),
          method: req.method(),
          status: 0,
          duration: 0,
          resourceType: req.resourceType(),
          startTime: Date.now(),
          failed: false,
          ...(captureNetworkBodies ? {
            requestHeaders: req.headers(),
            postData: req.postData() ?? undefined,
          } : {}),
        });
        if (allNetworkRequests.length > 500) {
          allNetworkRequests = allNetworkRequests.slice(-500);
        }
      });
      page.on('response', (resp) => {
        const entry = allNetworkRequests.findLast(
          e => e.url === resp.url() && e.status === 0 && !e.failed
        );
        if (entry) {
          entry.status = resp.status();
          entry.duration = entry.startTime ? Date.now() - entry.startTime : 0;
          const contentLength = resp.headers()['content-length'];
          if (contentLength) entry.responseSize = parseInt(contentLength, 10);
          if (captureNetworkBodies) {
            entry.responseHeaders = resp.headers();
            // Capture response body for API calls (fetch/xhr) — cap at 16KB
            const rt = entry.resourceType;
            if (rt === 'fetch' || rt === 'xhr' || rt === 'document') {
              resp.text().then(body => {
                entry.responseBody = body.length > 16384 ? body.slice(0, 16384) + '… (truncated)' : body;
                if (!entry.responseSize) entry.responseSize = body.length;
              }).catch(() => {});
            }
          }
        }
      });
      page.on('requestfailed', (req) => {
        const entry = allNetworkRequests.findLast(
          e => e.url === req.url() && e.status === 0 && !e.failed
        );
        if (entry) {
          entry.failed = true;
          entry.errorText = req.failure()?.errorText;
          entry.duration = entry.startTime ? Date.now() - entry.startTime : 0;
        }
        logFn('warn', `Request failed: ${req.url()} ${req.failure()?.errorText ?? ''}`);
      });

      // Save raw screenshot method BEFORE overriding page.screenshot (prevents infinite recursion)
      const rawScreenshot = page.screenshot.bind(page);
      let screenshotStep = 1;

      // Screenshot helper with stabilization
      const captureScreenshot = async (label: string) => {
        try {
          // Apply pre-screenshot stabilization (network idle, images, fonts, DOM)
          await applyPreScreenshotStabilization(page, command.stabilization);
          const buffer = await rawScreenshot({ fullPage: true });
          const filename = `${command.testRunId}-${command.testId}-${label.replace(/ /g, '_')}.png`;
          const base64 = buffer.toString('base64');
          screenshots.push({ filename, data: base64, width: viewport.width, height: viewport.height });
          logFn('info', `Captured screenshot: ${filename}`);
          // Disable RAF gating + unfreeze performance.now after screenshot
          /* eslint-disable @typescript-eslint/no-explicit-any */
          await page.evaluate(() => {
            if (typeof (window as any).__disableRAFGating === 'function') {
              (window as any).__disableRAFGating();
            }
            (window as any).__perfNowFrozen = false;
          }).catch(() => {});
          /* eslint-enable @typescript-eslint/no-explicit-any */
        } catch (err) {
          logFn('warn', `Failed to capture screenshot: ${err}`);
        }
      };

      // Override page.screenshot to intercept screenshot calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (page as any).screenshot = async (options?: any) => {
        const label = `Step ${screenshotStep++}`;
        await captureScreenshot(label);
        return rawScreenshot(options);
      };

      // Intercept page.goto with logging + retry ladder for transient CNI
      // bursts observed on builds (ERR_NETWORK_CHANGED / DNS flakes from 30 EBs
      // hitting the same target concurrently). Retries at 1s, 2s, 4s = ~7s
      // total; if still failing, throw a tagged error so the upper layer can
      // decide to swap to a fresh EB instead of burning the test.
      const originalGoto = page.goto.bind(page);
      const TRANSIENT_NET_RX = /ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_NETWORK_IO_SUSPENDED/i;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (page as any).goto = async (url: string, options?: any) => {
        logFn('info', `Navigating to ${url}...`);
        const delays = [1000, 2000, 4000];
        let lastErr: unknown;
        for (let attempt = 0; attempt <= delays.length; attempt++) {
          try {
            const response = await originalGoto(url, options);
            if (attempt > 0) {
              logFn('info', `Navigation complete (retry ${attempt}): ${response?.status() ?? 'no response'}`);
            } else {
              logFn('info', `Navigation complete: ${response?.status() ?? 'no response'}`);
            }
            return response;
          } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            if (!TRANSIENT_NET_RX.test(msg)) throw err;
            if (attempt === delays.length) break;
            logFn('warn', `Navigation hit transient network error (attempt ${attempt + 1}/${delays.length + 1}), backing off ${delays[attempt]}ms: ${msg}`);
            await new Promise((r) => setTimeout(r, delays[attempt]));
          }
        }
        // All retries exhausted on a transient error — this EB's network stack
        // looks unhealthy. Tag the error so the app-side worker releases + re-claims.
        const finalMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        const tagged = new Error(`EB network unhealthy after retries: ${finalMsg}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tagged as any).__ebNetworkUnhealthy = true;
        throw tagged;
      };

      // Extract function body
      const funcMatch = command.code.match(
        /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
      );

      let body: string;
      if (funcMatch) {
        body = stripTypeAnnotations(funcMatch[1]);
      } else {
        logFn('info', 'No export async function test(...) wrapper found — using code as body');
        body = stripTypeAnnotations(command.code);
      }

      // Strip re-declarations of runner-injected variables (expect, test) from import/require
      // AI-generated code sometimes includes these despite prompt instructions
      body = body.replace(/^\s*(?:const|let|var)\s+\{[^}]*\bexpect\b[^}]*\}\s*=\s*(?:await\s+)?(?:import|require)\s*\([^)]*\);?\s*$/gm, '');
      body = body.replace(/^\s*(?:const|let|var)\s+expect\s*=\s*(?:await\s+)?(?:import|require)\s*\([^)]*\);?\s*$/gm, '');
      body = body.replace(/^\s*import\s+\{[^}]*\}\s+from\s+['"][^'"]*['"];?\s*$/gm, '');
      logFn('info', `Extracted test body: ${body.length} chars`);

      // Remove test-local locateWithFallback (using runner-provided version)
      const lwfResult = removeFunctionDefinition(body, 'locateWithFallback');
      if (lwfResult.removed) {
        body = lwfResult.body;
        logFn('info', 'Removed test-local locateWithFallback (using runner-provided version)');
      }

      // Remove test-local replayCursorPath (using runner-provided speed-aware version)
      const rcpResult = removeFunctionDefinition(body, 'replayCursorPath');
      if (rcpResult.removed) {
        body = rcpResult.body;
        logFn('info', 'Removed test-local replayCursorPath (using runner-provided version)');
      }

      // Patch selectAll (mirrors runner.ts)
      body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

      // Instrument assertions BEFORE step instrumentation and soft-wrapping.
      // Each `expect(...)` / `await page.waitForLoadState(...)` line gets
      // wrapped with `await __assertion(id, async () => { <stmt> })` so the
      // runner can record structured AssertionResult[] keyed to the host's
      // parsed assertion ids. Lines wrapped here are skipped by the
      // soft-error regex below (they no longer match the bare `expect(`
      // pattern), so each assertion fails through `__assertion` only.
      if (command.assertions && command.assertions.length > 0) {
        const ar = instrumentAssertionTracking(body, command.assertions);
        body = ar.instrumentedBody;
        if (ar.wrappedCount !== command.assertions.length) {
          logFn('warn', `Assertion instrumentation wrapped ${ar.wrappedCount}/${command.assertions.length} assertions — runtime/parser drift`);
        }
      }

      // Instrument step tracking before soft error wrapping
      const instrumentResult = instrumentStepTracking(body);
      body = instrumentResult.instrumentedBody;
      stepCount = instrumentResult.stepCount;
      reachedStep = -1;
      const __stepReached = async (n: number) => { reachedStep = Math.max(reachedStep, n); };

      // Per-assertion bookkeeping invoked by lines wrapped by
      // `instrumentAssertionTracking`. Push one row per call (so a loop
      // around an `expect()` records each iteration); the criteria evaluator
      // uses `.find(... status === 'failed')` so any single failure trips
      // the rule — matches the soft-fail semantics we keep at runtime.
      const __assertion = async (id: string, fn: () => Promise<void>) => {
        const start = Date.now();
        try {
          await fn();
          assertionResults.push({ assertionId: id, status: 'passed', durationMs: Date.now() - start });
        } catch (e: unknown) {
          // A real `__hardAssertion` (set on the error) still escapes — host
          // tests rely on that to fail-fast on TypeError / ReferenceError.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (e && (e as any).__hardAssertion) throw e;
          const msg = e instanceof Error ? e.message : String(e);
          assertionResults.push({
            assertionId: id, status: 'failed', errorMessage: msg, durationMs: Date.now() - start,
          });
          // Mirror into softErrors so the legacy steps tab still surfaces the
          // human-readable message — the structured row is what the criteria
          // evaluator actually keys on.
          softErrors.push(msg);
          logFn('warn', `[ASSERTION FAIL] ${msg}`);
        }
      };

      // Soft error wrapping — skip screenshot lines AND navigation lines
      // (mirrors runner.ts). `page.goto` failures must fail the test hard:
      // if a worker can't reach the target URL, subsequent steps would run
      // on about:blank and produce blank-white screenshots recorded as passes.
      // `__assertion(...)` lines are also skipped — they manage their own
      // pass/fail bookkeeping and re-throwing them as soft warnings would
      // double-report into softErrors.
      body = body.replace(/^(\s*)(await\s+.+;)\s*$/gm, (_match, indent, stmt) => {
        if (stmt.includes('.screenshot(')) return `${indent}${stmt}`;
        if (stmt.includes('.goto(')) return `${indent}${stmt}`;
        if (stmt.includes('__assertion(')) return `${indent}${stmt}`;
        return `${indent}try { ${stmt} } catch(__softErr) { if (__softErr && __softErr.__hardAssertion) throw __softErr; stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
      });
      // Also soft-wrap synchronous expect() calls so assertion failures don't kill the test
      // (only hits expects that the assertion instrumenter didn't claim — e.g. multi-line statements)
      body = body.replace(/^(\s*)(expect\(.+;)\s*$/gm, (_match, indent, stmt) => {
        return `${indent}try { ${stmt} } catch(__softErr) { if (__softErr && __softErr.__hardAssertion) throw __softErr; stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
      });

      // Step logger with softExpect/softAction (matches runner)
      const stepLogger = {
        log: (msg: string) => logFn('info', `Step: ${msg}`),
        warn: (msg: string) => {
          softErrors.push(msg);
          logFn('warn', `[WARN] ${msg}`);
        },
        error: (msg: string) => logFn('error', `Step error: ${msg}`),
        softExpect: async (fn: () => Promise<void>, label?: string) => {
          try {
            await fn();
          } catch (e: unknown) {
            const msg = label || (e instanceof Error ? e.message : String(e));
            softErrors.push(msg);
            logFn('warn', `[SOFT FAIL] ${msg}`);
          }
        },
        softAction: async (fn: () => Promise<void>, label?: string) => {
          try {
            await fn();
          } catch (e: unknown) {
            const msg = label || (e instanceof Error ? e.message : String(e));
            softErrors.push(msg);
            logFn('warn', `[SOFT FAIL] ${msg}`);
          }
        },
      };

      // Basic expect implementation (mirrors runner.ts createExpect)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expect = (target: any, message?: string) => {
        const msgPrefix = message ? `${message}: ` : '';
        const isPage = typeof target?.goto === 'function';
        const isLocator = typeof target?.click === 'function' && typeof target?.fill === 'function';
        if (isPage) {
          return {
            async toHaveTitle(expected: string | RegExp) {
              const title = await target.title();
              const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
              if (!regex.test(title)) throw new Error(`${msgPrefix}Expected title "${title}" to match ${regex}`);
            },
            async toHaveURL(expected: string | RegExp) {
              const url = target.url();
              const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
              if (!regex.test(url)) throw new Error(`${msgPrefix}Expected URL "${url}" to match ${regex}`);
            },
          };
        }
        if (isLocator) {
          return {
            async toBeVisible() {
              if (!await target.isVisible()) throw new Error(`${msgPrefix}Expected element to be visible`);
            },
            async toBeHidden() {
              if (await target.isVisible()) throw new Error(`${msgPrefix}Expected element to be hidden`);
            },
            async toHaveText(expected: string | RegExp) {
              const text = await target.textContent() || '';
              const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
              if (!regex.test(text)) throw new Error(`${msgPrefix}Expected text "${text}" to match ${regex}`);
            },
            async toContainText(expected: string) {
              const text = await target.textContent() || '';
              if (!text.includes(expected)) throw new Error(`${msgPrefix}Expected text to contain "${expected}"`);
            },
            not: {
              async toBeVisible() {
                if (await target.isVisible()) throw new Error(`${msgPrefix}Expected element not to be visible`);
              },
            },
          };
        }
        return {
          toBe(expected: unknown) { if (target !== expected) throw new Error(`${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`); },
          toEqual(expected: unknown) { if (JSON.stringify(target) !== JSON.stringify(expected)) throw new Error(`${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`); },
          toBeTruthy() { if (!target) throw new Error(`${msgPrefix}Expected value to be truthy but got ${target}`); },
          toBeFalsy() { if (target) throw new Error(`${msgPrefix}Expected value to be falsy but got ${target}`); },
          toContain(expected: unknown) {
            if (Array.isArray(target)) { if (!target.includes(expected)) throw new Error(`${msgPrefix}Expected array to contain ${JSON.stringify(expected)}`); }
            else if (typeof target === 'string') { if (!target.includes(expected as string)) throw new Error(`${msgPrefix}Expected string to contain "${expected}"`); }
          },
          toHaveLength(expected: number) { if (target?.length !== expected) throw new Error(`${msgPrefix}Expected length ${expected} but got ${target?.length}`); },
          toBeGreaterThan(expected: number) { if (!(target > expected)) throw new Error(`${msgPrefix}Expected ${target} to be greater than ${expected}`); },
          toBeGreaterThanOrEqual(expected: number) { if (!(target >= expected)) throw new Error(`${msgPrefix}Expected ${target} to be greater than or equal to ${expected}`); },
          toMatch(expected: string | RegExp) {
            const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
            if (!regex.test(String(target))) throw new Error(`${msgPrefix}Expected "${target}" to match ${regex}`);
          },
          not: {
            toBe(expected: unknown) { if (target === expected) throw new Error(`${msgPrefix}Expected not to be ${JSON.stringify(expected)}`); },
            toBeTruthy() { if (target) throw new Error(`${msgPrefix}Expected value not to be truthy`); },
            toContain(expected: unknown) {
              if (Array.isArray(target) && target.includes(expected)) throw new Error(`${msgPrefix}Expected array not to contain ${JSON.stringify(expected)}`);
              if (typeof target === 'string' && target.includes(expected as string)) throw new Error(`${msgPrefix}Expected string not to contain "${expected}"`);
            },
          },
        };
      };

      // locateWithFallback — supports { type, value } format, ocr-text, role-name, coordinate fallback
      const locateWithFallback = async (
        pg: Page,
        selectors: Array<{ type: string; value: string } | string | { selector?: string; css?: string; text?: string }>,
        action: string,
        value?: string | null,
        coords?: { x: number; y: number } | null,
        options?: Record<string, unknown> | null
      ) => {
        // Normalize selectors to { type, value } format
        const validSelectors = selectors
          .map((sel) => {
            if (typeof sel === 'string') return { type: 'css', value: sel };
            if ('type' in sel && 'value' in sel) return sel as { type: string; value: string };
            // Legacy format: { selector, css, text }
            const legacy = sel as { selector?: string; css?: string; text?: string };
            return { type: 'css', value: legacy.selector || legacy.css || legacy.text || '' };
          })
          .filter((s) => s.value && s.value.trim() && !s.value.includes('undefined'));

        logFn('info', `[action] ${action}${value ? ` "${value}"` : ''} (${validSelectors.length} selectors)`);

        for (const sel of validSelectors) {
          try {
            let locator;
            if (sel.type === 'ocr-text') {
              const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
              locator = pg.getByText(text, { exact: false });
            } else if (sel.type === 'role-name') {
              const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
              if (match) {
                locator = pg.getByRole(match[1] as 'button' | 'link' | 'heading', { name: match[2] });
              } else {
                locator = pg.locator(sel.value);
              }
            } else {
              locator = pg.locator(sel.value);
            }

            const target = locator.first();
            await target.waitFor({ timeout: 3000 });

            logFn('info', `[action] ${action} matched via ${sel.type}`);
            if (action === 'locate') return target;
            if (action === 'click') await target.click(options || {});
            else if (action === 'fill') await target.fill(value || '');
            else if (action === 'selectOption') await target.selectOption(value || '');
            else if (action === 'check') await target.check();
            else if (action === 'uncheck') await target.uncheck();

            return target;
          } catch {
            continue;
          }
        }

        // Coordinate fallback for clicks
        if (action === 'click' && coords) {
          logFn('info', `Falling back to coordinate click at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y, options || {});
          return;
        }

        // Coordinate fallback for fill - click to focus then type
        if (action === 'fill' && coords) {
          logFn('info', `Falling back to coordinate fill at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y);
          await pg.keyboard.press('Control+a');
          await pg.keyboard.type(value || '');
          return;
        }

        throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
      };

      // Speed-aware replayCursorPath — respects cursorPlaybackSpeed setting
      const speed = command.cursorPlaybackSpeed ?? 1;
      const replayCursorPathFn = async (pg: Page, moves: [number, number, number][]) => {
        for (const [x, y, delay] of moves) {
          await pg.mouse.move(x, y);
          if (delay > 0 && speed > 0) {
            await pg.waitForTimeout(Math.round(delay / speed));
          }
        }
      };

      // Downloads helper — always provided, captures downloads passively + on-demand
      const dlList: Array<{ suggestedFilename: string; path: string }> = [];
      // Passive listener — catches all downloads automatically
      page.on('download', async (download) => {
        const safeName = download.suggestedFilename().replace(/\.\./g, '_');
        logFn('info', `[download] Captured: ${safeName} (url: ${download.url().slice(0, 80)})`);
        if (!dlList.some(d => d.suggestedFilename === safeName)) {
          dlList.push({ suggestedFilename: safeName, path: safeName });
        }
      });
      const downloadsHelper = {
        waitForDownload: async (triggerAction: () => Promise<void>) => {
          const [download] = await Promise.all([
            page.waitForEvent('download'),
            triggerAction(),
          ]);
          const safeName = download.suggestedFilename().replace(/\.\./g, '_');
          if (!dlList.some(d => d.suggestedFilename === safeName)) {
            dlList.push({ suggestedFilename: safeName, path: safeName });
          }
          return { filename: safeName, path: safeName };
        },
        list: () => dlList,
        waitForAny: async (timeoutMs = 5000) => {
          logFn('info', `[download] waitForAny: polling for up to ${timeoutMs}ms (current count: ${dlList.length})`);
          const start = Date.now();
          while (dlList.length === 0 && Date.now() - start < timeoutMs) {
            await page.waitForTimeout(250);
          }
          logFn('info', `[download] waitForAny: done after ${Date.now() - start}ms, downloads: ${dlList.length}`);
        },
      };

      logFn('info', 'Executing test code...');

      // Heartbeat timer — logs every 15s so the user knows the test is still running
      const heartbeatStart = Date.now();
      const heartbeat = setInterval(() => {
        const elapsed = Math.round((Date.now() - heartbeatStart) / 1000);
        logFn('info', `Test still running... (${elapsed}s elapsed)`);
      }, 15000);

      // Execute with timeout — close context to kill in-flight Playwright ops on timeout
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
            const testFn = new AsyncFunction(
              'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'appState', 'locateWithFallback', 'fileUpload', 'clipboard', 'downloads', 'network', 'replayCursorPath', 'fixtures', '__stepReached', '__assertion',
              body
            );
            await testFn(page, command.targetUrl.replace(/\/+$/, ''), 'screenshot.png', stepLogger, expect, null, locateWithFallback, null, null, downloadsHelper, null, replayCursorPathFn, {}, __stepReached, __assertion);
          })().then(r => { clearTimeout(timeoutTimer); return r; }),
          new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(() => {
              // For persistent (reused) contexts, close only the page (other tests still need the context).
              if (reusedPersistentContext) {
                logFn('warn', `Timeout fired (${testTimeout}ms) — closing page (keeping persistent context)`);
                page.close().catch(() => {});
              } else {
                logFn('warn', `Timeout fired (${testTimeout}ms) — closing context to kill in-flight operations`);
                testContext.close().catch(() => {});
              }
              reject(new Error(`Test execution timed out after ${testTimeout}ms`));
            }, testTimeout);
            abortCtrl.signal.addEventListener('abort', () => {
              clearTimeout(timeoutTimer);
              if (reusedPersistentContext) {
                logFn('info', 'Abort signal received — closing page (keeping persistent context)');
                page.close().catch(() => {});
              } else {
                logFn('info', 'Abort signal received — closing context');
                testContext.close().catch(() => {});
              }
              reject(new Error('Test cancelled'));
            });
          }),
        ]);
      } finally {
        clearTimeout(timeoutTimer);
        clearInterval(heartbeat);
      }

      logFn('info', 'Test code execution completed');

      // Extract values from page fields for extract-mode TestVariables.
      // Done before close so locators still resolve. Failures are best-effort
      // (logged + recorded as empty string), never fail the whole test.
      let extractedVariables: Record<string, string> | undefined;
      if (command.extractVariables && command.extractVariables.length > 0) {
        extractedVariables = {};
        for (const v of command.extractVariables) {
          if (!v.targetSelector) continue;
          try {
            const locator = page.locator(v.targetSelector).first();
            let raw: string | null;
            switch (v.attribute) {
              case 'textContent': raw = await locator.textContent({ timeout: 2000 }); break;
              case 'innerText':   raw = await locator.innerText({ timeout: 2000 }); break;
              case 'innerHTML':   raw = await locator.innerHTML({ timeout: 2000 }); break;
              default:            raw = await locator.inputValue({ timeout: 2000 }); break;
            }
            extractedVariables[v.name] = (raw ?? '').toString().trim();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logFn('warn', `Failed to extract variable "${v.name}" (${v.targetSelector}): ${msg}`);
            extractedVariables[v.name] = '';
          }
        }
      }

      // Check console/network error modes (mirrors runner.ts logic)
      const consoleErrorMode = command.consoleErrorMode || 'fail';
      const networkErrorMode = command.networkErrorMode || 'fail';
      const ignoreExternal = command.ignoreExternalNetworkErrors ?? false;
      let targetOrigin: string | undefined;
      try { targetOrigin = new URL(command.targetUrl).origin; } catch { /* ignore */ }
      const errorParts: string[] = [];

      if (consoleErrors.length > 0 && consoleErrorMode !== 'ignore') {
        const msg = `Console errors detected: ${consoleErrors.join('; ')}`;
        if (consoleErrorMode === 'warn') {
          logFn('warn', msg);
        } else {
          errorParts.push(msg);
        }
      }

      const networkFailures = allNetworkRequests.filter(r => {
        if (r.status < 400 && !r.failed) return false;
        if (ignoreExternal && targetOrigin) {
          try { if (new URL(r.url).origin !== targetOrigin) return false; } catch { /* keep */ }
        }
        // Ignore transient network bursts on sub-resource loads (CNI/DNS
        // instability during build startup). Keep real 4xx/5xx.
        if (r.failed && r.errorText && /net::ERR_NETWORK_CHANGED|net::ERR_NAME_NOT_RESOLVED|net::ERR_CONNECTION_RESET|net::ERR_CONNECTION_CLOSED|net::ERR_NETWORK_IO_SUSPENDED/i.test(r.errorText)) {
          return false;
        }
        return true;
      });
      if (networkFailures.length > 0 && networkErrorMode !== 'ignore') {
        const failureDetails = networkFailures.map(f => `${f.method} ${f.url} (${f.status})`).join('; ');
        const msg = `Network failures detected: ${failureDetails}`;
        if (networkErrorMode === 'warn') {
          logFn('warn', msg);
        } else {
          errorParts.push(msg);
        }
      }

      if (errorParts.length > 0) {
        throw new Error(errorParts.join(' | '));
      }

      // Take success screenshot if none captured
      if (screenshots.length === 0) {
        await captureScreenshot('success');
      }

      // Capture DOM snapshot after test body ran so it aligns with the final screenshot.
      await captureFinalDomSnapshot();

      const durationMs = Date.now() - startTime;
      logFn('info', `Test passed in ${durationMs}ms (${screenshots.length} screenshots)`);

      result = {
        status: 'passed' as const,
        durationMs,
        logs,
        screenshots,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
        networkRequests: allNetworkRequests.length > 0 ? allNetworkRequests : undefined,
        softErrors: softErrors.length > 0 ? softErrors : undefined,
        assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
        lastReachedStep: reachedStep >= 0 ? reachedStep : undefined,
        totalSteps: stepCount > 0 ? stepCount : undefined,
        domSnapshot,
        extractedVariables,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const isCancelled = errorMessage.includes('cancelled') || abortCtrl.signal.aborted;

      if (isCancelled) {
        logFn('info', 'Test cancelled');
        result = {
          status: 'cancelled' as const, durationMs, logs, screenshots,
          consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
          networkRequests: allNetworkRequests.length > 0 ? allNetworkRequests : undefined,
          softErrors: softErrors.length > 0 ? softErrors : undefined,
          assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
          lastReachedStep: reachedStep >= 0 ? reachedStep : undefined,
          totalSteps: stepCount > 0 ? stepCount : undefined,
          domSnapshot,
        };
      } else {
        const isTimeout = errorMessage.includes('timed out');
        logFn('error', `Test ${isTimeout ? 'timed out' : 'failed'}: ${errorMessage}`);

        // Try to capture error screenshot + DOM snapshot (skip on timeout — context is closed)
        let errorScreenshot: string | undefined;
        if (!isTimeout) {
          try {
            const buffer = await page.screenshot();
            errorScreenshot = buffer.toString('base64');
          } catch { /* ignore */ }
          await captureFinalDomSnapshot();
        }

        result = {
          status: (isTimeout ? 'timeout' : 'failed') as 'timeout' | 'failed',
          durationMs,
          error: { message: errorMessage, stack: errorStack, screenshot: errorScreenshot },
          logs,
          screenshots,
          consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
          networkRequests: allNetworkRequests.length > 0 ? allNetworkRequests : undefined,
          softErrors: softErrors.length > 0 ? softErrors : undefined,
          assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
          lastReachedStep: reachedStep >= 0 ? reachedStep : undefined,
          totalSteps: stepCount > 0 ? stepCount : undefined,
          domSnapshot,
        };
      }
    } finally {
      this.abortController = null;
      // Capture video before closing context (video is finalized on close)
      const video = page?.video();
      // Stop screencast before closing page so CDP session doesn't die unexpectedly
      if (callbacks?.onBeforePageClose) {
        try { await callbacks.onBeforePageClose(); } catch { /* ignore */ }
      }
      // Close the per-test page + context (no state leaks between tests).
      // For reused persistent contexts, keep the context alive for sibling tests.
      await page.close().catch(() => {});
      if (!reusedPersistentContext) {
        await testContext.close().catch(() => {});
      }

      // After context close, video file is finalized — read and base64 encode it
      if (video && videoDir && result) {
        try {
          const videoFilename = `${command.testRunId}-${command.testId}.webm`;
          const tempDest = path.join(videoDir, videoFilename);
          await video.saveAs(tempDest);
          await video.delete();
          await watermarkVideo(tempDest);
          const videoBuffer = fs.readFileSync(tempDest);
          result.videoData = videoBuffer.toString('base64');
          result.videoFilename = videoFilename;
          logFn('info', `Video captured: ${videoFilename} (${Math.round(videoBuffer.length / 1024)}KB)`);
          // Clean up temp dir
          fs.rmSync(videoDir, { recursive: true, force: true });
        } catch {
          // Video capture is best-effort
        }
      }
    }

    return result!
  }

  async runSetup(
    browser: Browser,
    command: RunSetupPayload,
    callbacks?: {
      onPageCreated?: (page: Page) => Promise<void> | void;
    },
  ): Promise<EmbeddedSetupResult> {
    const startTime = Date.now();
    const logs: Array<{ timestamp: number; level: string; message: string }> = [];
    const setupTimeout = Math.max(command.timeout || 120000, 30000);

    const logFn = (level: string, message: string) => {
      logs.push({ timestamp: Date.now(), level, message });
      console.log(`  [${level.toUpperCase()}] [setup:${command.setupId}] ${message}`);
    };

    const viewport = command.viewport || { width: 1280, height: 720 };
    const needsStabilizedContext = command.stabilization?.crossOsConsistency || command.stabilization?.freezeAnimations;

    // No storageState injection — this IS the setup that creates the session
    const setupContext = await browser.newContext({
      viewport,
      ...(needsStabilizedContext ? { deviceScaleFactor: 1 } : {}),
      ...(needsStabilizedContext ? { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' as const } : {}),
      ...(command.stabilization?.freezeAnimations ? { reducedMotion: 'reduce' as const } : {}),
    });
    const page = await setupContext.newPage();
    // On success, we transfer ownership of setupContext to this.setupContexts
    // for reuse by subsequent tests; finally block must not close it in that case.
    let setupPageClosed = false;
    let retainContext = false;

    try {
      // Give the caller a chance to attach live-stream infra (CDP screencast) to
      // the setup page before navigation begins. Used by debug mode so the user
      // can watch setup run.
      if (callbacks?.onPageCreated) {
        try {
          await callbacks.onPageCreated(page);
        } catch (cbErr) {
          logFn('warn', `onPageCreated callback failed: ${cbErr instanceof Error ? cbErr.message : String(cbErr)}`);
        }
      }

      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      // Setup freeze scripts BEFORE navigation
      if (command.stabilization) {
        await setupFreezeScripts(page, command.stabilization);
        logFn('info', `Stabilization applied`);
      }

      // Extract function body (same pattern as runTest, also match setup functions)
      const setupMatch = command.code.match(
        /export\s+async\s+function\s+setup\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
      );
      const testMatch = command.code.match(
        /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
      );
      const funcMatch = setupMatch || testMatch;

      let body: string;
      if (funcMatch) {
        body = stripTypeAnnotations(funcMatch[1]);
      } else {
        body = stripTypeAnnotations(command.code);
      }

      // Remove test-local function definitions
      const lwfResult = removeFunctionDefinition(body, 'locateWithFallback');
      if (lwfResult.removed) body = lwfResult.body;
      const rcpResult = removeFunctionDefinition(body, 'replayCursorPath');
      if (rcpResult.removed) body = rcpResult.body;

      // Patch selectAll
      body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

      // Noop screenshot/stepLogger for setup
      const _noopScreenshot = async () => {};
      const stepLogger = {
        log: (msg: string) => logFn('info', `Step: ${msg}`),
        warn: (msg: string) => logFn('warn', `[WARN] ${msg}`),
        error: (msg: string) => logFn('error', `Step error: ${msg}`),
        softExpect: async (fn: () => Promise<void>) => { try { await fn(); } catch { /* soft */ } },
        softAction: async (fn: () => Promise<void>) => { try { await fn(); } catch { /* soft */ } },
      };

      // Create helpers matching the test execution path so setup code can use them
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expect = (target: any, message?: string) => {
        const msgPrefix = message ? `${message}: ` : '';
        const isPage = typeof target?.goto === 'function';
        const isLocator = typeof target?.click === 'function' && typeof target?.fill === 'function';
        if (isPage) {
          return {
            async toHaveTitle(expected: string | RegExp) { const title = await target.title(); const regex = typeof expected === 'string' ? new RegExp(expected) : expected; if (!regex.test(title)) throw new Error(`${msgPrefix}Expected title "${title}" to match ${regex}`); },
            async toHaveURL(expected: string | RegExp) { const url = target.url(); const regex = typeof expected === 'string' ? new RegExp(expected) : expected; if (!regex.test(url)) throw new Error(`${msgPrefix}Expected URL "${url}" to match ${regex}`); },
          };
        }
        if (isLocator) {
          return {
            async toBeVisible() { if (!await target.isVisible()) throw new Error(`${msgPrefix}Expected element to be visible`); },
            async toBeHidden() { if (await target.isVisible()) throw new Error(`${msgPrefix}Expected element to be hidden`); },
            async toHaveText(expected: string | RegExp) { const text = await target.textContent() || ''; const regex = typeof expected === 'string' ? new RegExp(expected) : expected; if (!regex.test(text)) throw new Error(`${msgPrefix}Expected text "${text}" to match ${regex}`); },
            async toContainText(expected: string) { const text = await target.textContent() || ''; if (!text.includes(expected)) throw new Error(`${msgPrefix}Expected text to contain "${expected}"`); },
            not: { async toBeVisible() { if (await target.isVisible()) throw new Error(`${msgPrefix}Expected element not to be visible`); } },
          };
        }
        return {
          toBe(expected: unknown) { if (target !== expected) throw new Error(`${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`); },
          toBeTruthy() { if (!target) throw new Error(`${msgPrefix}Expected value to be truthy but got ${target}`); },
          not: { toBe(expected: unknown) { if (target === expected) throw new Error(`${msgPrefix}Expected not to be ${JSON.stringify(expected)}`); } },
        };
      };

      const locateWithFallback = async (
        pg: Page,
        selectors: Array<{ type: string; value: string } | string | { selector?: string; css?: string; text?: string }>,
        action: string,
        value?: string | null,
        coords?: { x: number; y: number } | null,
        options?: Record<string, unknown> | null
      ) => {
        const validSelectors = selectors
          .map((sel) => {
            if (typeof sel === 'string') return { type: 'css', value: sel };
            if ('type' in sel && 'value' in sel) return sel as { type: string; value: string };
            const legacy = sel as { selector?: string; css?: string; text?: string };
            return { type: 'css', value: legacy.selector || legacy.css || legacy.text || '' };
          })
          .filter((s) => s.value && s.value.trim() && !s.value.includes('undefined'));

        logFn('info', `[setup action] ${action}${value ? ` "${value}"` : ''} (${validSelectors.length} selectors)`);

        for (const sel of validSelectors) {
          try {
            let locator;
            if (sel.type === 'ocr-text') {
              const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
              locator = pg.getByText(text, { exact: false });
            } else if (sel.type === 'role-name') {
              const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
              if (match) locator = pg.getByRole(match[1] as 'button' | 'link' | 'heading', { name: match[2] });
              else locator = pg.locator(sel.value);
            } else {
              locator = pg.locator(sel.value);
            }
            const target = locator.first();
            await target.waitFor({ timeout: 3000 });
            logFn('info', `[setup action] ${action} matched via ${sel.type}`);
            if (action === 'locate') return target;
            if (action === 'click') await target.click(options || {});
            else if (action === 'fill') await target.fill(value || '');
            else if (action === 'selectOption') await target.selectOption(value || '');
            else if (action === 'check') await target.check();
            else if (action === 'uncheck') await target.uncheck();
            return target;
          } catch {
            continue;
          }
        }
        if (action === 'click' && coords) {
          logFn('info', `Falling back to coordinate click at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y, options || {});
          return;
        }
        if (action === 'fill' && coords) {
          logFn('info', `Falling back to coordinate fill at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y);
          await pg.keyboard.press('Control+a');
          await pg.keyboard.type(value || '');
          return;
        }
        throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
      };

      const replayCursorPathFn = async (_pg: Page, moves: [number, number, number][]) => {
        for (const [x, y, delay] of moves) {
          await page.mouse.move(x, y);
          if (delay > 0) await page.waitForTimeout(delay);
        }
      };

      logFn('info', 'Executing setup code...');

      // Execute with timeout
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        (async () => {
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          const setupFn = new AsyncFunction(
            'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'appState', 'locateWithFallback', 'replayCursorPath',
            body
          );
          await setupFn(page, command.targetUrl.replace(/\/+$/, ''), 'screenshot.png', stepLogger, expect, null, locateWithFallback, replayCursorPathFn);
        })().then(r => { clearTimeout(timeoutTimer); return r; }),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            logFn('warn', `Setup timeout fired (${setupTimeout}ms)`);
            setupContext.close().catch(() => {});
            reject(new Error(`Setup timed out after ${setupTimeout}ms`));
          }, setupTimeout);
        }),
      ]);

      logFn('info', 'Setup code executed successfully');

      // Wait for post-setup navigation (e.g., login redirect)
      const setupPageUrl = page.url();
      try {
        await page.waitForURL(
          (url: URL) => url.toString() !== setupPageUrl,
          { timeout: 10000, waitUntil: 'networkidle' }
        );
        logFn('info', `Post-setup navigation: ${setupPageUrl} → ${page.url()}`);
      } catch {
        logFn('info', 'No post-setup navigation detected (URL unchanged)');
      }

      // Poll for session cookies
      try {
        const ctx = page.context();
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const cookies = await ctx.cookies();
          const hasSession = cookies.some(c =>
            c.name.includes('session') || c.name.includes('auth') || c.name.includes('token')
          );
          if (hasSession) {
            logFn('info', `Session cookie found after setup (${cookies.length} total cookies)`);
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        }
      } catch {
        // Cookie polling failed — continue anyway
      }

      // Capture storageState snapshot. Used as a fallback: if Chromium
      // disposes the live context's target between tests (observed behavior),
      // we rebuild a fresh context with these cookies + localStorage instead
      // of failing the test with "Target has been closed".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let storageStateSnapshot: any = undefined;
      try {
        storageStateSnapshot = await setupContext.storageState();
        logFn('info', `Captured storageState snapshot: ${storageStateSnapshot.cookies.length} cookies, ${storageStateSnapshot.origins.length} origins`);
      } catch (e) {
        logFn('warn', `Failed to capture storageState snapshot: ${e}`);
      }

      // Persist the setup's BrowserContext — tests in this run reuse it,
      // preserving sessionStorage/IndexedDB/in-memory auth that storageState drops.
      //
      // KEEPALIVE PAGE: we intentionally keep the setup page OPEN. Chromium
      // disposes a BrowserContext's target when it has 0 pages for a short
      // while — keeping one navigated-but-idle page alive anchors the target
      // so tests can open and close their own pages freely alongside it.
      setupPageClosed = true; // prevent the finally block from closing it
      this.setupContexts.set(command.setupId, {
        context: setupContext,
        createdAt: Date.now(),
        storageState: storageStateSnapshot,
        viewport,
      });
      this.ensureSetupContextSweeper();
      retainContext = true;
      logFn('info', `Persistent setup context retained with keepalive page (setupId=${command.setupId}) — tests in this run will reuse it`);

      return {
        status: 'passed',
        storageState: `persistent:${command.setupId}`,
        storageStateJson: storageStateSnapshot ? JSON.stringify(storageStateSnapshot) : undefined,
        durationMs: Date.now() - startTime,
        logs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('timed out');
      logFn('error', `Setup ${isTimeout ? 'timed out' : 'failed'}: ${errorMessage}`);

      return {
        status: isTimeout ? 'timeout' : 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        logs,
      };
    } finally {
      if (!setupPageClosed) await page.close().catch(() => {});
      if (!retainContext) await setupContext.close().catch(() => {});
    }
  }

  async captureScreenshot(page: Page): Promise<{ data: string; width: number; height: number } | null> {
    try {
      const buffer = await page.screenshot({ fullPage: true });
      const viewport = page.viewportSize() || { width: 1280, height: 720 };
      return {
        data: buffer.toString('base64'),
        width: viewport.width,
        height: viewport.height,
      };
    } catch {
      return null;
    }
  }
}
