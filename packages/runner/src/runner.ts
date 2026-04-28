/**
 * Test Runner for Agent
 * Executes Playwright tests and returns results.
 */

import { chromium, firefox, webkit, Browser, Page, BrowserContext } from 'playwright';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { RunTestCommandPayload, RunSetupCommandPayload, LogEntry, StabilizationPayload, DomSnapshotPayload } from './protocol.js';
import { CROSS_OS_CHROMIUM_ARGS, setupFreezeScripts, applyPreScreenshotStabilization } from './stabilization.js';
import { instrumentAssertionTracking, instrumentStepTracking, stripTypeAnnotations, watermarkVideo } from '@lastest/shared';

/**
 * Verify code integrity by comparing SHA256 hash.
 */
function verifyCodeIntegrity(code: string, expectedHash: string): boolean {
  const actualHash = createHash('sha256').update(code).digest('hex');
  return actualHash === expectedHash;
}

export interface TestRunResult {
  status: 'passed' | 'failed' | 'error' | 'timeout' | 'cancelled';
  durationMs: number;
  error?: {
    message: string;
    stack?: string;
    screenshot?: string;
  };
  logs: LogEntry[];
  screenshots: Array<{ filename: string; data: string; width: number; height: number; capturedAt?: number }>;
  softErrors?: string[];
  /** Per-`expect()` outcome rows produced by the runner's `__assertion`
   *  helper. The criteria evaluator uses `assertionId` to match these to
   *  the user's `assertion_failed` rules. */
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
  domSnapshot?: DomSnapshotPayload;
}

/**
 * Capture a DOM snapshot of the live page. Evaluates a self-contained script
 * that extracts interactive-element metadata + selector candidates. Mirrors
 * `packages/embedded-browser/src/selector-utils.ts` but inlined so the runner
 * package stays zero-dep on server code.
 */
async function captureDomSnapshotForRunner(page: Page): Promise<DomSnapshotPayload> {
  let url = '';
  try { url = page.url(); } catch { /* page may be closed */ }
  const elements = await page.evaluate(() => {
    const DYNAMIC_ID_PATTERNS = [
      /^react-select-\d+-/, /^headlessui-\w+-\d+$/, /^mui-\d+$/, /^:r[a-z0-9]+:$/,
      /^radix-/, /^ember\d+$/, /^[a-z]+[-_]\d{2,}$/i, /[a-f0-9]{8,}/, /\d{4,}/,
    ];
    const isDyn = (id: string) => id.includes('undefined') || DYNAMIC_ID_PATTERNS.some(p => p.test(id));
    const implicitRole = (el: HTMLElement): string | null => {
      const map: Record<string, string> = {
        BUTTON: 'button', A: 'link',
        INPUT: el.getAttribute('type') === 'checkbox' ? 'checkbox'
          : el.getAttribute('type') === 'radio' ? 'radio'
          : el.getAttribute('type') === 'submit' ? 'button'
          : 'textbox',
        SELECT: 'combobox', TEXTAREA: 'textbox', IMG: 'img',
        NAV: 'navigation', MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo',
      };
      return map[el.tagName] || null;
    };
    const cssPath = (el: HTMLElement): string => {
      const parts: string[] = [];
      let cur: HTMLElement | null = el;
      while (cur && cur !== document.body) {
        let s = cur.tagName.toLowerCase();
        const c = cur.getAttribute('class');
        if (c) {
          const cls = c.split(' ').filter(x => x && !x.includes(':') && !x.startsWith('_')).slice(0, 2)
            .map(x => x.replace(/([[\]()#.>+~=|^$*!@])/g, '\\$1'));
          if (cls.length) s += '.' + cls.join('.');
        }
        parts.unshift(s);
        cur = cur.parentElement;
      }
      return parts.slice(-3).join(' > ');
    };
    const INTERACTIVE = new Set([
      'button','option','menuitem','menuitemcheckbox','menuitemradio',
      'tab','treeitem','link','switch','radio','checkbox','combobox','listitem',
    ]);
    const buildSelectors = (el: HTMLElement) => {
      const m = new Map<string, string>();
      if (el.dataset.testid) m.set('data-testid', `[data-testid="${el.dataset.testid}"]`);
      if (el.id && !isDyn(el.id)) m.set('id', `#${el.id}`);
      const labelText = (
        (el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`) as HTMLElement)?.textContent?.trim() : null) ||
        (el.closest('label') as HTMLElement)?.textContent?.trim() ||
        (el.getAttribute('aria-labelledby') ? document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent?.trim() : null)
      )?.slice(0, 50) || null;
      if (labelText) m.set('label', `label="${labelText}"`);
      const role = el.getAttribute('role') || implicitRole(el);
      const name = el.getAttribute('aria-label') || el.getAttribute('title') || labelText || el.textContent?.trim().slice(0, 30);
      if (role && name) m.set('role-name', `role=${role}[name="${name}"]`);
      const aria = el.getAttribute('aria-label');
      if (aria) m.set('aria-label', `[aria-label="${aria}"]`);
      const elRole = el.getAttribute('role');
      if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'LI' || el.tagName === 'LABEL' || (elRole && INTERACTIVE.has(elRole))) {
        const t = el.textContent?.trim().slice(0, 30);
        if (t) m.set('text', `text="${t}"`);
      }
      if (!m.has('text') && el.children.length === 0) {
        const t = el.textContent?.trim().slice(0, 30);
        if (t) m.set('text', `text="${t}"`);
      }
      const ph = el.getAttribute('placeholder');
      if (ph) m.set('placeholder', `[placeholder="${ph}"]`);
      const nm = el.getAttribute('name');
      if (nm && !isDyn(nm)) m.set('name', `[name="${nm}"]`);
      const cp = cssPath(el);
      if (cp) m.set('css-path', cp);
      const PRIORITY = ['data-testid','id','label','role-name','aria-label','text','placeholder','name','css-path'];
      const out: Array<{ type: string; value: string }> = [];
      for (const k of PRIORITY) { const v = m.get(k); if (v) out.push({ type: k, value: v }); }
      for (const [k, v] of m) { if (!out.some(s => s.type === k)) out.push({ type: k, value: v }); }
      return out;
    };
    const SEL = 'a, button, input, select, textarea, [role], [data-testid], [tabindex], [aria-label], label, li, [onclick]';
    const list = document.querySelectorAll(SEL);
    const seen = new Set<HTMLElement>();
    const out: Array<{ tag: string; id?: string; textContent?: string; boundingBox: { x: number; y: number; width: number; height: number }; selectors: Array<{ type: string; value: string }> }> = [];
    const MAX = 5000;
    let n = 0;
    for (const node of list) {
      if (n >= MAX) break;
      const el = node as HTMLElement;
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const sels = buildSelectors(el);
      if (sels.length === 0) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        textContent: el.textContent?.trim().slice(0, 100) || undefined,
        boundingBox: { x: r.x, y: r.y, width: r.width, height: r.height },
        selectors: sels,
      });
      n++;
    }
    return out;
  }).catch(() => [] as DomSnapshotPayload['elements']);
  return { elements, url, timestamp: Date.now() };
}

export class TestRunner {
  private browser: Browser | null = null;
  private browserLaunchPromise: Promise<Browser> | null = null;
  private currentLaunchArgs: string[] = [];
  private currentBrowserType: 'chromium' | 'firefox' | 'webkit' = 'chromium';
  private activeTests = new Map<string, { abort: AbortController; testRunId: string }>();
  private logs: LogEntry[] = [];
  // Legacy single-test tracking (for backward compat with abort/isRunning)
  private abortController: AbortController | null = null;
  private currentTestRunId: string | null = null;
  // Persistent setup contexts: keyed by setupId, reused across all tests in a run.
  // Fixes the storageState-serialization path losing session state that Playwright's
  // storageState() can't capture (sessionStorage, IndexedDB, in-memory auth tokens).
  private setupContexts = new Map<string, { context: BrowserContext; createdAt: number }>();
  private setupContextSweeper: ReturnType<typeof setInterval> | null = null;
  private readonly SETUP_CONTEXT_TTL_MS = 30 * 60 * 1000;

  /**
   * Ensure a shared browser instance is running.
   * Concurrent calls share the same launch promise.
   * If args or browser type differ from the current browser, close and relaunch.
   */
  private async ensureBrowser(browserType: 'chromium' | 'firefox' | 'webkit' = 'chromium', args?: string[]): Promise<Browser> {
    const requestedArgs = args ?? [];
    const argsKey = requestedArgs.join(',');
    const currentKey = this.currentLaunchArgs.join(',');

    // If browser exists but args or type differ, close and relaunch
    if (this.browser && this.browser.isConnected() && (argsKey !== currentKey || browserType !== this.currentBrowserType)) {
      const b = this.browser;
      this.browser = null;
      this.browserLaunchPromise = null;
      await b.close().catch(() => {});
    }

    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    if (this.browserLaunchPromise) {
      return this.browserLaunchPromise;
    }
    this.currentLaunchArgs = requestedArgs;
    this.currentBrowserType = browserType;
    const launcher = browserType === 'firefox' ? firefox : browserType === 'webkit' ? webkit : chromium;
    this.browserLaunchPromise = launcher.launch({ headless: true, args: requestedArgs.length > 0 ? requestedArgs : undefined }).then(b => {
      this.browser = b;
      this.browserLaunchPromise = null;
      return b;
    });
    return this.browserLaunchPromise;
  }

  /**
   * Close the shared browser if no tests are running AND no persistent
   * setup contexts are alive. Persistent contexts depend on the shared
   * browser, so we must keep it up while any are held.
   */
  async closeBrowserIfIdle(): Promise<void> {
    if (this.activeTests.size === 0 && this.setupContexts.size === 0 && this.browser) {
      const b = this.browser;
      this.browser = null;
      await b.close().catch(() => {});
    }
  }

  /**
   * Lazily start a sweeper that closes persistent setup contexts idle longer
   * than SETUP_CONTEXT_TTL_MS. Called from runSetup when we store the first
   * persistent context.
   */
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
      // Stop sweeper + maybe close browser if no contexts remain
      if (this.setupContexts.size === 0) {
        clearInterval(this.setupContextSweeper!);
        this.setupContextSweeper = null;
        this.closeBrowserIfIdle().catch(() => {});
      }
    }, 60 * 1000);
    if (this.setupContextSweeper.unref) this.setupContextSweeper.unref();
  }

  /**
   * Explicitly release a persistent setup context. Called by the cleanup
   * command or on error paths.
   */
  async releaseSetupContext(setupId: string): Promise<void> {
    const entry = this.setupContexts.get(setupId);
    if (!entry) return;
    this.setupContexts.delete(setupId);
    await entry.context.close().catch(() => {});
    await this.closeBrowserIfIdle();
  }

  /**
   * Abort tests by testId, testRunId, or all.
   * Checks both the map key (testId) and the entry's testRunId field,
   * so cancelling a build run aborts all its tests.
   */
  abort(id?: string): boolean {
    if (id) {
      // Direct lookup by testId
      const direct = this.activeTests.get(id);
      if (direct) {
        direct.abort.abort();
        return true;
      }
      // Scan for matching testRunId (cancel entire run)
      let aborted = false;
      for (const [, entry] of this.activeTests) {
        if (entry.testRunId === id) {
          entry.abort.abort();
          aborted = true;
        }
      }
      if (aborted) return true;
      // Legacy fallback
      if (this.currentTestRunId === id && this.abortController) {
        this.abortController.abort();
        return true;
      }
      return false;
    }
    if (this.abortController) {
      this.abortController.abort();
      return true;
    }
    return false;
  }

  isRunning(): boolean {
    return this.activeTests.size > 0 || this.abortController !== null;
  }

  getCurrentTestRunId(): string | null {
    return this.currentTestRunId;
  }

  private log(level: 'info' | 'warn' | 'error', message: string) {
    this.logs.push({ timestamp: Date.now(), level, message });
    const prefix = level === 'error' ? '  [ERROR]' : level === 'warn' ? '  [WARN]' : '  [INFO]';
    console.log(`${prefix} ${message}`);
  }

  async runTest(
    command: RunTestCommandPayload,
    onProgress?: (step: string, progress: number) => void
  ): Promise<TestRunResult> {
    const testAbort = new AbortController();
    // Key by testId (unique per test), NOT testRunId (shared per build)
    this.activeTests.set(command.testId, { abort: testAbort, testRunId: command.testRunId });
    // Legacy single-test tracking
    this.abortController = testAbort;
    this.currentTestRunId = command.testRunId;

    const logs: LogEntry[] = [];
    const softErrors: string[] = [];
    const assertionResults: NonNullable<TestRunResult['assertionResults']> = [];
    const logFn = (level: 'info' | 'warn' | 'error', message: string) => {
      logs.push({ timestamp: Date.now(), level, message });
      const prefix = level === 'error' ? '  [ERROR]' : level === 'warn' ? '  [WARN]' : '  [INFO]';
      console.log(`${prefix} [${command.testId}] ${message}`);
    };

    const startTime = Date.now();
    const screenshots: Array<{ filename: string; data: string; width: number; height: number; capturedAt?: number }> = [];
    let result: TestRunResult | null = null;

    let context: BrowserContext | null = null;
    let page: Page | null = null;
    // Whether `context` is a reused persistent setup context (don't close in finally).
    let reusedPersistentContext = false;
    // Raw screenshot function, saved before executeTestCode overrides page.screenshot
    let rawScreenshot: ((options?: { fullPage?: boolean }) => Promise<Buffer>) | null = null;

    // Enforce a hard timeout on the entire test execution
    const testTimeout = Math.max(command.timeout || 120000, 30000);
    logFn('info', `Test timeout: ${testTimeout}ms`);

    try {
      // Check if already aborted
      if (testAbort.signal.aborted) {
        throw new Error('Test cancelled before starting');
      }

      // Verify code integrity before execution (prevents MITM code injection)
      if (!verifyCodeIntegrity(command.code, command.codeHash)) {
        throw new Error('Code integrity check failed - hash mismatch');
      }

      logFn('info', 'Launching browser...');
      onProgress?.('Launching browser', 10);

      // Determine launch args based on stabilization settings.
      // Use deterministic rendering args when EITHER crossOsConsistency or freezeAnimations
      // is enabled — GPU compositing and Skia optimizations cause non-deterministic
      // anti-aliasing on canvas elements (roughjs lines differ between runs).
      const browserType = command.browser || 'chromium';
      const needsDeterministicRendering = command.stabilization?.crossOsConsistency || command.stabilization?.freezeAnimations;
      const launchArgs = needsDeterministicRendering && browserType === 'chromium' ? CROSS_OS_CHROMIUM_ARGS : [];

      // Use shared browser instance (will relaunch if args or browser type changed)
      await this.ensureBrowser(browserType, launchArgs);

      let viewport = command.viewport || { width: 1280, height: 720 };

      // Viewport mismatch: lock to recording size or warn
      if (command.recordingViewport) {
        const recVp = command.recordingViewport;
        if (recVp.width !== viewport.width || recVp.height !== viewport.height) {
          if (command.lockViewportToRecording) {
            viewport = { width: recVp.width, height: recVp.height };
            logFn('info', `Viewport locked to recording size: ${recVp.width}x${recVp.height}`);
          } else {
            // Only warn for tests that use coordinate-based actions
            const usesCoords = /page\.mouse\.click\(|page\.mouse\.move\(|replayCursorPath\(/.test(command.code);
            if (usesCoords) {
              softErrors.push(
                `Viewport mismatch: recorded at ${recVp.width}x${recVp.height}, playing back at ${viewport.width}x${viewport.height}. Coordinate-based actions may click wrong positions.`
              );
            }
          }
        }
      }

      // Detect persistent-context marker from runSetup — format: "persistent:<setupId>".
      // When present, reuse the setup's live BrowserContext instead of serializing
      // storageState (which drops sessionStorage / IndexedDB / in-memory auth).
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
      const needsStabilizedContext = command.stabilization?.crossOsConsistency || command.stabilization?.freezeAnimations;

      // Set up video recording directory if requested
      let videoDir: string | undefined;
      if (command.forceVideoRecording) {
        videoDir = path.join(os.tmpdir(), 'lastest-runner-videos', command.testRunId);
        if (!fs.existsSync(videoDir)) {
          fs.mkdirSync(videoDir, { recursive: true });
        }
        logFn('info', 'Video recording enabled');
      }

      // Persistent-context branch: reuse setup's live context, create a fresh page in it.
      // Limitations: per-test video recording and context-level stabilization overrides
      // cannot be applied (context already exists). Per-page stabilization still applies below.
      if (persistentSetupId) {
        const entry = this.setupContexts.get(persistentSetupId);
        if (entry) {
          if (videoDir) {
            logFn('warn', 'Per-test video recording not supported in persistent-context mode — disabled for this test');
          }
          context = entry.context;
          reusedPersistentContext = true;
          logFn('info', `Reusing persistent setup context (setupId=${persistentSetupId})`);
        } else {
          logFn('warn', `persistent setup context ${persistentSetupId} not found — falling back to fresh context (auth state will be missing)`);
        }
      }

      if (!context) {
        context = await this.browser!.newContext({
          viewport,
          ...(parsedStorageState ? { storageState: parsedStorageState } : {}),
          ...(needsStabilizedContext ? { deviceScaleFactor: 1 } : {}),
          ...(needsStabilizedContext ? { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' as const } : {}),
          ...(command.stabilization?.freezeAnimations ? { reducedMotion: 'reduce' as const } : {}),
          ...(videoDir ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
        });
      }
      page = await context.newPage();
      // Persistent contexts may have a different viewport than this test; sync it.
      if (reusedPersistentContext) {
        try { await page.setViewportSize(viewport); } catch { /* best-effort */ }
      }

      // Set explicit timeouts to prevent indefinite hangs
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      // Setup freeze scripts (timestamps, random, animations) BEFORE any navigation
      if (command.stabilization) {
        await setupFreezeScripts(page, command.stabilization);
        logFn('info', `Stabilization: freeze timestamps=${command.stabilization.freezeTimestamps}, random=${command.stabilization.freezeRandomValues}, animations=${command.stabilization.freezeAnimations}, crossOS=${command.stabilization.crossOsConsistency}`);
      }

      // Log page-level events for visibility during test execution
      page.on('console', msg => {
        if (msg.type() === 'error') {
          logFn('warn', `[browser] ${msg.text()}`);
        }
      });
      page.on('pageerror', error => {
        logFn('warn', `[page error] ${error.message}`);
      });
      page.on('requestfailed', request => {
        const failure = request.failure();
        if (failure) {
          logFn('warn', `[request failed] ${request.url()} — ${failure.errorText}`);
        }
      });

      logFn('info', `Browser launched, viewport: ${viewport.width}x${viewport.height}`);
      onProgress?.('Running test', 30);

      // Save the raw screenshot method BEFORE executeTestCode overrides page.screenshot.
      // captureScreenshot must use this to avoid infinite recursion:
      //   override → captureScreenshot → page.screenshot (overridden) → captureScreenshot → ...
      rawScreenshot = page.screenshot.bind(page);
      const captureScreenshot = async (label: string) => {
        if (!page) return;
        try {
          // Apply pre-screenshot stabilization (network idle, images, fonts, DOM)
          await applyPreScreenshotStabilization(page, command.stabilization);
          const buffer = await rawScreenshot!({ fullPage: true });
          const filename = `${command.testRunId}-${command.testId}-${label.replace(/ /g, '_')}.png`;
          const base64 = buffer.toString('base64');
          const { width, height } = viewport;
          screenshots.push({ filename, data: base64, width, height, capturedAt: Date.now() });
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

      // Check abort before executing test
      if (testAbort.signal.aborted) {
        throw new Error('Test cancelled');
      }

      // Execute test code with timeout enforcement.
      // When timeout/cancel fires, close the context to kill in-flight Playwright
      // operations — otherwise test code keeps running on the page after timeout.
      logFn('info', 'Executing test code...');

      // Heartbeat timer — logs every 15s so the user knows the test is still running
      const heartbeatStart = Date.now();
      const heartbeat = setInterval(() => {
        const elapsed = Math.round((Date.now() - heartbeatStart) / 1000);
        logFn('info', `Test still running... (${elapsed}s elapsed)`);
      }, 15000);

      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.executeTestCode(page, command.code, command.targetUrl, captureScreenshot, logFn, softErrors, command.cursorPlaybackSpeed, command.stabilization, command, assertionResults)
            .then(r => { clearTimeout(timeoutTimer); return r; })
            .catch(e => { clearTimeout(timeoutTimer); throw e; }),
          new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(() => {
              // For a reused persistent context, close only the page (not the
              // context — other tests in this run still need it).
              if (reusedPersistentContext) {
                logFn('warn', `Timeout fired (${testTimeout}ms) — closing page (keeping persistent context)`);
                page?.close().catch(() => {});
              } else {
                logFn('warn', `Timeout fired (${testTimeout}ms) — closing context to kill in-flight operations`);
                context?.close().catch(() => {});
                context = null;
              }
              page = null;
              reject(new Error(`Test execution timed out after ${testTimeout}ms`));
            }, testTimeout);
            testAbort.signal.addEventListener('abort', () => {
              clearTimeout(timeoutTimer);
              if (reusedPersistentContext) {
                logFn('info', 'Abort signal received — closing page (keeping persistent context)');
                page?.close().catch(() => {});
              } else {
                logFn('info', 'Abort signal received — closing context');
                context?.close().catch(() => {});
                context = null;
              }
              page = null;
              reject(new Error('Test cancelled'));
            });
          }),
        ]);
      } finally {
        clearTimeout(timeoutTimer);
        clearInterval(heartbeat);
      }
      logFn('info', 'Test code execution completed');

      // Check abort after test
      if (testAbort.signal.aborted) {
        throw new Error('Test cancelled');
      }

      onProgress?.('Test completed', 90);

      // If no screenshots were captured, take a success screenshot
      if (screenshots.length === 0) {
        await captureScreenshot('success');
      }

      // Capture DOM snapshot after test body ran, aligned with the final screenshot.
      let domSnapshot: DomSnapshotPayload | undefined;
      if (page && !page.isClosed()) {
        try { domSnapshot = await captureDomSnapshotForRunner(page); }
        catch (err) { logFn('warn', `DOM snapshot capture failed: ${err instanceof Error ? err.message : String(err)}`); }
      }

      const durationMs = Date.now() - startTime;
      logFn('info', `Test passed in ${durationMs}ms (${screenshots.length} screenshots)`);

      result = {
        status: 'passed',
        durationMs,
        logs,
        screenshots,
        softErrors: softErrors.length > 0 ? softErrors : undefined,
        assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
        lastReachedStep: lastReachedStep >= 0 ? lastReachedStep : undefined,
        totalSteps: stepCount > 0 ? stepCount : undefined,
        domSnapshot,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Check if this was a cancellation
      const isCancelled = errorMessage.includes('cancelled') || testAbort.signal.aborted;
      if (isCancelled) {
        logFn('info', 'Test cancelled');
        result = {
          status: 'cancelled',
          durationMs,
          error: {
            message: 'Test cancelled by user',
          },
          logs,
          screenshots,
          assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
          lastReachedStep: lastReachedStep >= 0 ? lastReachedStep : undefined,
          totalSteps: stepCount > 0 ? stepCount : undefined,
        };
      } else {
        // Check if timeout
        const isTimeout = errorMessage.includes('timed out');
        logFn('error', `Test ${isTimeout ? 'timed out' : 'failed'}: ${errorMessage}`);

        // Capture failure screenshot — but NOT on timeout because the test code
        // is still running on the page and Playwright can't screenshot while
        // operations are in-flight (it would hang).
        let errorScreenshot: string | undefined;
        let failureDomSnapshot: DomSnapshotPayload | undefined;
        if (page && rawScreenshot && !isTimeout) {
          try {
            const buffer = await rawScreenshot({ fullPage: true });
            errorScreenshot = buffer.toString('base64');
            const filename = `${command.testRunId}-${command.testId}-failure.png`;
            const viewport = command.viewport || { width: 1280, height: 720 };
            screenshots.push({
              filename,
              data: errorScreenshot,
              width: viewport.width,
              height: viewport.height,
            });
          } catch {
            logFn('warn', 'Failed to capture error screenshot');
          }
          if (!page.isClosed()) {
            try { failureDomSnapshot = await captureDomSnapshotForRunner(page); }
            catch { /* best-effort */ }
          }
        }

        result = {
          status: isTimeout ? 'timeout' : 'failed',
          durationMs,
          error: {
            message: errorMessage,
            stack: errorStack,
            screenshot: errorScreenshot,
          },
          logs,
          screenshots,
          softErrors: softErrors.length > 0 ? softErrors : undefined,
          assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
          lastReachedStep: lastReachedStep >= 0 ? lastReachedStep : undefined,
          totalSteps: stepCount > 0 ? stepCount : undefined,
          domSnapshot: failureDomSnapshot,
        };
      }
    } finally {
      this.activeTests.delete(command.testId);
      // Clear legacy tracking if this was the tracked test
      if (this.currentTestRunId === command.testRunId) {
        this.abortController = null;
        this.currentTestRunId = null;
      }
      // Capture video before closing context (video is finalized on close).
      // For persistent (reused) contexts, close only the page — keep the context
      // alive for sibling tests in this run. Sweeper/cleanup command evicts it later.
      const video = page?.video();
      if (page) await page.close().catch(() => {});
      if (context && !reusedPersistentContext) await context.close().catch(() => {});
      // After context close, video file is finalized — read and base64-encode
      if (video && command.forceVideoRecording && result) {
        try {
          const videoPath = await video.path();
          if (videoPath && fs.existsSync(videoPath)) {
            await watermarkVideo(videoPath);
            const videoBuffer = fs.readFileSync(videoPath);
            result.videoData = videoBuffer.toString('base64');
            result.videoFilename = `${command.testRunId}-${command.testId}.webm`;
            logFn('info', `Video captured: ${result.videoFilename} (${Math.round(videoBuffer.length / 1024)}KB)`);
            // Clean up temp file
            fs.unlinkSync(videoPath);
          }
        } catch {
          logFn('warn', 'Failed to capture video recording');
        }
      }
      // Close browser only when no tests are running
      await this.closeBrowserIfIdle();
    }

    return result!;
  }

  async runSetup(
    command: RunSetupCommandPayload
  ): Promise<{ status: 'passed' | 'failed' | 'error' | 'timeout'; storageState?: string; variables?: Record<string, unknown>; durationMs: number; error?: string; logs: LogEntry[] }> {
    const logs: LogEntry[] = [];
    const logFn = (level: 'info' | 'warn' | 'error', message: string) => {
      logs.push({ timestamp: Date.now(), level, message });
      const prefix = level === 'error' ? '  [ERROR]' : level === 'warn' ? '  [WARN]' : '  [INFO]';
      console.log(`${prefix} [setup:${command.setupId}] ${message}`);
    };

    const startTime = Date.now();
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    const setupTimeout = Math.max(command.timeout || 120000, 30000);

    try {
      // Verify code integrity
      if (!verifyCodeIntegrity(command.code, command.codeHash)) {
        throw new Error('Code integrity check failed - hash mismatch');
      }

      logFn('info', 'Launching browser for setup...');
      const setupBrowserType = command.browser || 'chromium';
      const needsDeterministicRendering = command.stabilization?.crossOsConsistency || command.stabilization?.freezeAnimations;
      const setupLaunchArgs = needsDeterministicRendering && setupBrowserType === 'chromium' ? CROSS_OS_CHROMIUM_ARGS : [];
      await this.ensureBrowser(setupBrowserType, setupLaunchArgs);

      const viewport = command.viewport || { width: 1280, height: 720 };
      // No storageState injection — this IS the setup that creates the session
      const needsStabilizedSetupCtx = command.stabilization?.crossOsConsistency || command.stabilization?.freezeAnimations;
      context = await this.browser!.newContext({
        viewport,
        ...(needsStabilizedSetupCtx ? { deviceScaleFactor: 1 } : {}),
        ...(needsStabilizedSetupCtx ? { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' as const } : {}),
        ...(command.stabilization?.freezeAnimations ? { reducedMotion: 'reduce' as const } : {}),
      });
      page = await context.newPage();
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      // Setup freeze scripts (timestamps, random, animations) BEFORE navigation
      if (command.stabilization) {
        await setupFreezeScripts(page, command.stabilization);
      }

      logFn('info', `Browser launched, viewport: ${viewport.width}x${viewport.height}`);

      // Execute setup code with timeout
      logFn('info', 'Executing setup code...');
      const noopScreenshot = async () => {};
      await Promise.race([
        this.executeTestCode(page, command.code, command.targetUrl, noopScreenshot, logFn, undefined, undefined, command.stabilization),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            logFn('warn', `Setup timeout fired (${setupTimeout}ms)`);
            context?.close().catch(() => {});
            context = null;
            page = null;
            reject(new Error(`Setup timed out after ${setupTimeout}ms`));
          }, setupTimeout);
        }),
      ]);

      logFn('info', 'Setup code executed successfully');

      // Wait for page to settle after setup (e.g., login click + redirect)
      if (page) {
        const setupPageUrl = page.url();
        try {
          await page.waitForURL(
            url => url.toString() !== setupPageUrl,
            { timeout: 10000, waitUntil: 'networkidle' }
          );
          logFn('info', `Post-setup navigation: ${setupPageUrl} → ${page.url()}`);
        } catch {
          logFn('info', 'No post-setup navigation detected (URL unchanged)');
        }

        // Poll for session cookies — the redirect may have completed but
        // Set-Cookie hasn't been processed by the browser yet
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
      }

      // Capture storageState (cookies/localStorage) for logging + as a fallback marker.
      // The authoritative state carrier is the persistent BrowserContext kept alive below —
      // storageState alone drops sessionStorage, IndexedDB, service workers, and in-memory
      // auth tokens, which is why setup-based builds were losing login state across tests.
      let storageState: string | undefined;
      if (context) {
        try {
          const state = await context.storageState();
          logFn('info', `Captured storageState snapshot: ${state.cookies.length} cookies, ${state.origins.length} origins`);
        } catch (e) {
          logFn('warn', `Failed to capture storageState snapshot: ${e}`);
        }
      }

      // Persist the context for reuse by tests in this run. Close the setup page
      // (we don't want setup's page open during tests) but keep the context alive.
      if (context) {
        if (page) await page.close().catch(() => {});
        page = null;
        this.setupContexts.set(command.setupId, { context, createdAt: Date.now() });
        this.ensureSetupContextSweeper();
        logFn('info', `Persistent setup context retained (setupId=${command.setupId}) — tests in this run will reuse it`);
        storageState = `persistent:${command.setupId}`;
        context = null; // prevent finally from closing it
      }

      return {
        status: 'passed',
        storageState,
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
      if (page) await page.close().catch(() => {});
      // Only close context if we didn't hand it off to setupContexts (nulled above on success).
      if (context) await context.close().catch(() => {});
      await this.closeBrowserIfIdle();
    }
  }

  private async executeTestCode(
    page: Page,
    code: string,
    targetUrl: string,
    captureScreenshot: (label: string) => Promise<void>,
    logFn?: (level: 'info' | 'warn' | 'error', message: string) => void,
    softErrors?: string[],
    cursorPlaybackSpeed?: number,
    stabilization?: StabilizationPayload,
    payload?: RunTestCommandPayload,
    assertionResults?: NonNullable<TestRunResult['assertionResults']>,
  ): Promise<void> {
    const log = logFn ?? this.log.bind(this);
    // Extract function body from: export async function test/setup(page, ...) { ... }
    const setupMatch = code.match(
      /export\s+async\s+function\s+setup\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
    );
    const testMatch = code.match(
      /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
    );
    const funcMatch = setupMatch || testMatch;

    let body: string;
    if (funcMatch) {
      body = stripTypeAnnotations(funcMatch[1]);
    } else {
      // Fallback: treat entire code as the function body (unwrapped test code)
      log('info', 'No export async function test(...) wrapper found — using code as body');
      body = stripTypeAnnotations(code);
    }
    log('info', `Extracted test body: ${body.length} chars`);

    // Remove the test's local locateWithFallback function if present
    if (body.includes('async function locateWithFallback(')) {
      const startMatch = body.match(/async function locateWithFallback\s*\([^)]*\)\s*\{/);
      if (startMatch && startMatch.index !== undefined) {
        const startIdx = startMatch.index;
        const braceStart = body.indexOf('{', startIdx);
        let depth = 1;
        let endIdx = braceStart + 1;
        while (depth > 0 && endIdx < body.length) {
          if (body[endIdx] === '{') depth++;
          else if (body[endIdx] === '}') depth--;
          endIdx++;
        }
        body = body.slice(0, startIdx) + '/* locateWithFallback provided by runner */' + body.slice(endIdx);
        log('info', 'Removed test-local locateWithFallback (using runner-provided version)');
      }
    }

    // Remove the test's local replayCursorPath function if present (runner provides speed-aware version)
    if (body.includes('async function replayCursorPath(')) {
      const rcpMatch = body.match(/async function replayCursorPath\s*\([^)]*\)\s*\{/);
      if (rcpMatch && rcpMatch.index !== undefined) {
        const rcpStart = rcpMatch.index;
        const rcpBraceStart = body.indexOf('{', rcpStart);
        let rcpDepth = 1;
        let rcpEnd = rcpBraceStart + 1;
        while (rcpDepth > 0 && rcpEnd < body.length) {
          if (body[rcpEnd] === '{') rcpDepth++;
          else if (body[rcpEnd] === '}') rcpDepth--;
          rcpEnd++;
        }
        body = body.slice(0, rcpStart) + '/* replayCursorPath provided by runner */' + body.slice(rcpEnd);
        log('info', 'Removed test-local replayCursorPath (using runner-provided version)');
      }
    }

    // Fix legacy page.keyboard.selectAll() → keyboard.press('Control+a')
    body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

    // Instrument assertions BEFORE step tracking + soft-wrap. Each
    // `expect(...)` line gets wrapped with `await __assertion(id, async () => { ... })`
    // so the runner can record structured AssertionResult[] keyed to the
    // host's parsed assertion ids. Order-paired with `payload.assertions`.
    const assertionPayload = payload?.assertions ?? [];
    if (assertionPayload.length > 0) {
      const ar = instrumentAssertionTracking(body, assertionPayload);
      body = ar.instrumentedBody;
      if (ar.wrappedCount !== assertionPayload.length) {
        log('warn', `Assertion instrumentation wrapped ${ar.wrappedCount}/${assertionPayload.length} assertions — runtime/parser drift`);
      }
    }

    // Instrument step tracking
    const { instrumentedBody } = instrumentStepTracking(body);
    body = instrumentedBody;
    let lastReachedStep = -1;
    const __stepReached = async (n: number) => { lastReachedStep = Math.max(lastReachedStep, n); };

    // Wrap standalone await statements (except screenshots/navigation) in try/catch
    // for soft error handling. This matches the local runner behavior so tests
    // continue past failures to reach screenshots.
    // Hard assertion errors (.__hardAssertion) are re-thrown to fail the test immediately.
    // When `failOnRuntimeError` is set (driven by the test's `all_steps_executed`
    // Criteria rule), a TypeError / ReferenceError / SyntaxError also re-throws —
    // these indicate broken test code, not a flaky assertion, and shouldn't be
    // swallowed as a soft warning.
    // `page.goto` is NOT soft-wrapped: if navigation fails, subsequent steps would
    // run on about:blank and produce blank screenshots recorded as passes.
    const failOnRuntime = payload?.failOnRuntimeError === true;
    const runtimeReThrow = failOnRuntime
      ? 'if (__softErr && (__softErr instanceof TypeError || __softErr instanceof ReferenceError || __softErr instanceof SyntaxError)) throw __softErr;'
      : '';
    body = body.replace(/^(\s*)(await\s+.+;)\s*$/gm, (_match: string, indent: string, stmt: string) => {
      if (stmt.includes('.screenshot(')) return `${indent}${stmt}`;
      if (stmt.includes('.goto(')) return `${indent}${stmt}`;
      // `__assertion(...)` already records pass/fail and re-pushes to
      // softErrors itself — wrapping it again would double-report.
      if (stmt.includes('__assertion(')) return `${indent}${stmt}`;
      return `${indent}try { ${stmt} } catch(__softErr) { if (__softErr && __softErr.__hardAssertion) throw __softErr; ${runtimeReThrow} stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
    });

    // Use caller-provided softErrors array, or create local one as fallback
    const errors = softErrors ?? [];
    const aResults = assertionResults ?? [];

    // Per-assertion bookkeeping invoked by lines wrapped by
    // `instrumentAssertionTracking`. Mirror in `softErrors` so the legacy
    // steps tab still surfaces the message; the structured row is what the
    // criteria evaluator keys on.
    const __assertion = async (id: string, fn: () => Promise<void>) => {
      const start = Date.now();
      try {
        await fn();
        aResults.push({ assertionId: id, status: 'passed', durationMs: Date.now() - start });
      } catch (e: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (e && (e as any).__hardAssertion) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        aResults.push({
          assertionId: id, status: 'failed', errorMessage: msg, durationMs: Date.now() - start,
        });
        errors.push(msg);
        log('warn', `[ASSERTION FAIL] ${msg}`);
      }
    };

    // Create stepLogger (matches local runner signature)
    const stepLogger = {
      log: (msg: string) => {
        log('info', `Step: ${msg}`);
      },
      warn: (msg: string) => {
        errors.push(msg);
        log('warn', `[WARN] ${msg}`);
      },
      softExpect: async (fn: () => Promise<void>, label?: string) => {
        try {
          await fn();
        } catch (e: unknown) {
          const msg = label || (e instanceof Error ? e.message : String(e));
          errors.push(msg);
          log('warn', `[SOFT FAIL] ${msg}`);
        }
      },
      softAction: async (fn: () => Promise<void>, label?: string) => {
        try {
          await fn();
        } catch (e: unknown) {
          const msg = label || (e instanceof Error ? e.message : String(e));
          errors.push(msg);
          log('warn', `[SOFT FAIL] ${msg}`);
        }
      },
    };

    // Create locateWithFallback helper (matches local runner signature)
    const locateWithFallback = async (
      pg: Page,
      selectors: Array<{ type: string; value: string }>,
      action: string,
      value?: string | null,
      coords?: { x: number; y: number } | null,
      options?: Record<string, unknown> | null
    ) => {
      const validSelectors = selectors.filter(
        (s) => s.value && s.value.trim() && !s.value.includes('undefined')
      );

      log('info', `[action] ${action}${value ? ` "${value}"` : ''} (${validSelectors.length} selectors)`);

      for (const sel of validSelectors) {
        try {
          let locator;
          if (sel.type === 'ocr-text') {
            const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
            locator = pg.getByText(text, { exact: false });
          } else if (sel.type === 'label') {
            const labelText = sel.value.replace(/^label="/, '').replace(/"$/, '');
            locator = pg.getByLabel(labelText);
          } else if (sel.type === 'alt-text') {
            const altText = sel.value.replace(/^alt-text="/, '').replace(/"$/, '');
            locator = pg.getByAltText(altText);
          } else if (sel.type === 'title') {
            const titleText = sel.value.replace(/^title="/, '').replace(/"$/, '');
            locator = pg.getByTitle(titleText);
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

          log('info', `[action] ${action} matched via ${sel.type}`);
          if (action === 'locate') return target;
          if (action === 'click') await target.click(options || {});
          else if (action === 'fill') await target.fill(value || '');
          else if (action === 'selectOption') await target.selectOption(value || '');

          return target;
        } catch {
          continue;
        }
      }

      // Coordinate fallback for clicks
      if (action === 'click' && coords) {
        log('info', `Falling back to coordinate click at (${coords.x}, ${coords.y})`);
        await pg.mouse.click(coords.x, coords.y, options || {});
        return;
      }

      // Coordinate fallback for fill - click to focus then type
      if (action === 'fill' && coords) {
        log('info', `Falling back to coordinate fill at (${coords.x}, ${coords.y})`);
        await pg.mouse.click(coords.x, coords.y);
        await pg.waitForTimeout(100);
        await pg.keyboard.press('Control+a');
        await pg.keyboard.type(value || '');
        return;
      }

      throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
    };

    // Create simple expect implementation
    const expect = this.createExpect();

    // Create screenshotPath generator (start from 1 to match local runner)
    let screenshotStep = 1;

    // Override page.screenshot to capture screenshots
    const originalScreenshot = page.screenshot.bind(page);
    const pageWithScreenshot = page as Page & { screenshot: typeof originalScreenshot };
    pageWithScreenshot.screenshot = async (options?: Parameters<typeof originalScreenshot>[0]) => {
      const label = `Step ${screenshotStep++}`;
      await captureScreenshot(label);
      const result = await originalScreenshot(options);
      return result;
    };

    // Intercept page.goto to log navigation attempts
    const originalGoto = page.goto.bind(page);
    (page as Page & { goto: typeof originalGoto }).goto = async (url: string, options?: Parameters<typeof originalGoto>[1]) => {
      log('info', `Navigating to ${url}...`);
      const response = await originalGoto(url, options);
      log('info', `Navigation complete: ${response?.status() ?? 'no response'}`);
      // addInitScript already resets mathState on each navigation — no explicit reset needed
      return response;
    };

    // Speed-aware replayCursorPath — respects cursorPlaybackSpeed setting
    const speed = cursorPlaybackSpeed ?? 1;
    const replayCursorPathFn = async (pg: Page, moves: [number, number, number][]) => {
      for (const [x, y, delay] of moves) {
        await pg.mouse.move(x, y);
        if (delay > 0 && speed > 0) {
          await pg.waitForTimeout(Math.round(delay / speed));
        }
      }
    };

    // Wrap key Playwright action methods with pre+post RAF flushing.
    // Pre-action: flush pending callbacks from unwrapped actions (mouse.move).
    // Post-action: wait one browser frame for the page to process the action's
    // effects (React state → RAF-driven canvas re-render), then flush again.
    if (stabilization?.freezeAnimations) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const wrapAction = (obj: any, method: string) => {
        const orig = obj[method].bind(obj);
        obj[method] = async (...args: any[]) => {
          // Pre-action: flush pending callbacks from unwrapped actions (mouse.move)
          await page.evaluate(() => {
            (window as any).__enableRAFGating?.();
            (window as any).__flushAnimationFrames?.(10);
            (window as any).__disableRAFGating?.();
          }).catch(() => {});
          // Execute action (gating disabled — page reacts normally)
          const result = await orig(...args);
          // Post-action: wait one browser frame for page to process, then flush
          await page.evaluate(() => new Promise<void>(resolve => {
            requestAnimationFrame(() => {
              (window as any).__enableRAFGating?.();
              (window as any).__flushAnimationFrames?.(10);
              (window as any).__disableRAFGating?.();
              resolve();
            });
          })).catch(() => {});
          return result;
        };
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
      wrapAction(page.mouse, 'click');
      wrapAction(page.mouse, 'down');
      wrapAction(page.mouse, 'up');
      wrapAction(page.keyboard, 'press');
      wrapAction(page, 'click');
    }

    // Execute the test
    log('info', 'Compiling test function...');

    // Build helper objects matching local runner's 12-arg signature
    const fileUploadHelper = async (selector: string, filePaths: string | string[]) => {
      const locator = page.locator(selector);
      await locator.setInputFiles(Array.isArray(filePaths) ? filePaths : [filePaths]);
    };

    const clipboardHelper = payload?.grantClipboardAccess ? {
      copy: async (text: string) => {
        await page.evaluate((t) => navigator.clipboard.writeText(t), text);
      },
      paste: async () => {
        return await page.evaluate(() => navigator.clipboard.readText());
      },
      pasteInto: async (selector: string) => {
        await page.locator(selector).focus();
        await page.keyboard.press('Control+V');
      },
    } : null;

    const dlDir = payload?.acceptDownloads ? path.join(os.tmpdir(), `lastest-dl-${payload.testRunId}`) : '';
    if (dlDir) fs.mkdirSync(dlDir, { recursive: true });
    const dlList: Array<{ suggestedFilename: string; path: string }> = [];
    const downloadsHelper = payload?.acceptDownloads ? {
      waitForDownload: async (triggerAction: () => Promise<void>) => {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          triggerAction(),
        ]);
        const safeName = path.basename(download.suggestedFilename()).replace(/\.\./g, '_');
        const savePath = path.join(dlDir, safeName);
        await download.saveAs(savePath);
        dlList.push({ suggestedFilename: safeName, path: savePath });
        return { filename: safeName, path: savePath };
      },
      list: () => dlList,
      waitForAny: async (timeoutMs = 5000) => {
        const start = Date.now();
        while (dlList.length === 0 && Date.now() - start < timeoutMs) {
          await page.waitForTimeout(250);
        }
      },
    } : {
      waitForDownload: async () => { throw new Error('Downloads not enabled — enable "Accept Downloads" in Playwright settings'); },
      list: () => [] as Array<{ suggestedFilename: string; path: string }>,
      waitForAny: async () => {},
    };

    const networkHelper = {
      mock: async (urlPattern: string, response: { status?: number; body?: string; contentType?: string; json?: unknown }) => {
        await page.route(urlPattern, async (route) => {
          await route.fulfill({
            status: response.status ?? 200,
            contentType: response.contentType ?? (response.json ? 'application/json' : 'text/plain'),
            body: response.json ? JSON.stringify(response.json) : (response.body ?? ''),
          });
        });
      },
      block: async (urlPattern: string) => {
        await page.route(urlPattern, (route) => route.abort());
      },
      passthrough: async (urlPattern: string) => {
        await page.unroute(urlPattern);
      },
      capture: (urlPattern: string) => {
        const captured: Array<{ url: string; method: string; postData?: string }> = [];
        page.on('request', (req) => {
          if (new RegExp(urlPattern).test(req.url())) {
            captured.push({ url: req.url(), method: req.method(), postData: req.postData() ?? undefined });
          }
        });
        return { requests: captured };
      },
    };

    // Decode base64 fixtures from payload to temp dir
    const fixturesMap: Record<string, string> = {};
    if (payload?.fixtures && payload.fixtures.length > 0) {
      const fixtureDir = path.join(os.tmpdir(), `lastest-fixtures-${payload.testRunId}`);
      fs.mkdirSync(fixtureDir, { recursive: true });
      for (const fixture of payload.fixtures) {
        const safeName = path.basename(fixture.filename).replace(/\.\./g, '_');
        const fixturePath = path.join(fixtureDir, safeName);
        fs.writeFileSync(fixturePath, Buffer.from(fixture.data, 'base64'));
        fixturesMap[fixture.filename] = fixturePath;
      }
    }

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const testFn = new AsyncFunction(
      'page',
      'baseUrl',
      'screenshotPath',
      'stepLogger',
      'expect',
      'appState',
      'locateWithFallback',
      'fileUpload',
      'clipboard',
      'downloads',
      'network',
      'replayCursorPath',
      'fixtures',
      '__stepReached',
      '__assertion',
      body
    );

    log('info', `Running test against ${targetUrl}...`);
    try {
      await testFn(
        page, targetUrl.replace(/\/+$/, ''), 'screenshot.png', stepLogger, expect,
        null, locateWithFallback,
        fileUploadHelper, clipboardHelper, downloadsHelper, networkHelper, replayCursorPathFn,
        fixturesMap, __stepReached, __assertion
      );
      log('info', 'Test function returned successfully');
    } finally {
      // Clean up fixture temp files
      if (payload?.fixtures && payload.fixtures.length > 0) {
        const fixtureDir = path.join(os.tmpdir(), `lastest-fixtures-${payload.testRunId}`);
        try { fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch {}
      }
      if (dlDir) {
        try { fs.rmSync(dlDir, { recursive: true, force: true }); } catch {}
      }
    }
  }

  private createExpect(timeout = 5000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (target: any, message?: string) => {
      const isPage = typeof target?.goto === 'function';
      const isLocator = typeof target?.click === 'function' && typeof target?.fill === 'function';

      // Generic value matchers (arrays, primitives, objects)
      if (!isPage && !isLocator) {
        const msgPrefix = message ? `${message}: ` : '';
        return {
          toHaveLength(expected: number) {
            const actual = target?.length;
            if (actual !== expected) {
              const details = Array.isArray(target) ? `\nReceived: ${JSON.stringify(target.slice(0, 10))}` : '';
              throw new Error(`${msgPrefix}Expected length ${expected} but got ${actual}${details}`);
            }
          },
          toBe(expected: unknown) {
            if (target !== expected) {
              throw new Error(`${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`);
            }
          },
          toEqual(expected: unknown) {
            if (JSON.stringify(target) !== JSON.stringify(expected)) {
              throw new Error(`${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`);
            }
          },
          toBeTruthy() {
            if (!target) {
              throw new Error(`${msgPrefix}Expected value to be truthy but got ${target}`);
            }
          },
          toBeFalsy() {
            if (target) {
              throw new Error(`${msgPrefix}Expected value to be falsy but got ${target}`);
            }
          },
          toContain(expected: unknown) {
            if (Array.isArray(target)) {
              if (!target.includes(expected)) {
                throw new Error(`${msgPrefix}Expected array to contain ${JSON.stringify(expected)}`);
              }
            } else if (typeof target === 'string') {
              if (!target.includes(expected as string)) {
                throw new Error(`${msgPrefix}Expected string to contain "${expected}"`);
              }
            } else {
              throw new Error(`${msgPrefix}toContain only works on arrays and strings`);
            }
          },
          toBeGreaterThan(expected: number) {
            if (typeof target !== 'number' || target <= expected) {
              throw new Error(`${msgPrefix}Expected ${target} to be greater than ${expected}`);
            }
          },
          toBeLessThan(expected: number) {
            if (typeof target !== 'number' || target >= expected) {
              throw new Error(`${msgPrefix}Expected ${target} to be less than ${expected}`);
            }
          },
          toMatch(expected: string | RegExp) {
            const str = typeof target === 'string' ? target : String(target);
            const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
            if (!regex.test(str)) {
              throw new Error(`${msgPrefix}Expected "${str}" to match ${regex}`);
            }
          },
          not: {
            toHaveLength(expected: number) {
              if (target?.length === expected) {
                throw new Error(`${msgPrefix}Expected length not to be ${expected}`);
              }
            },
            toBe(expected: unknown) {
              if (target === expected) {
                throw new Error(`${msgPrefix}Expected not to be ${JSON.stringify(expected)}`);
              }
            },
            toEqual(expected: unknown) {
              if (JSON.stringify(target) === JSON.stringify(expected)) {
                throw new Error(`${msgPrefix}Expected not to equal ${JSON.stringify(expected)}`);
              }
            },
            toBeTruthy() {
              if (target) {
                throw new Error(`${msgPrefix}Expected value not to be truthy`);
              }
            },
            toBeFalsy() {
              if (!target) {
                throw new Error(`${msgPrefix}Expected value not to be falsy`);
              }
            },
            toContain(expected: unknown) {
              if (Array.isArray(target) && target.includes(expected)) {
                throw new Error(`${msgPrefix}Expected array not to contain ${JSON.stringify(expected)}`);
              } else if (typeof target === 'string' && target.includes(expected as string)) {
                throw new Error(`${msgPrefix}Expected string not to contain "${expected}"`);
              }
            },
          },
        };
      }

      if (isPage) {
        return {
          async toHaveURL(expected: string | RegExp, options?: { timeout?: number }) {
            const t = options?.timeout ?? timeout;
            const start = Date.now();
            while (Date.now() - start < t) {
              const url = target.url();
              if (typeof expected === 'string' && url === expected) return;
              if (expected instanceof RegExp && expected.test(url)) return;
              await new Promise((r) => setTimeout(r, 100));
            }
            throw new Error(`Expected URL "${expected}" but got "${target.url()}"`);
          },
          async toHaveTitle(expected: string | RegExp, options?: { timeout?: number }) {
            const t = options?.timeout ?? timeout;
            const start = Date.now();
            while (Date.now() - start < t) {
              const title = await target.title();
              if (typeof expected === 'string' && title === expected) return;
              if (expected instanceof RegExp && expected.test(title)) return;
              await new Promise((r) => setTimeout(r, 100));
            }
            throw new Error(`Expected title "${expected}" but got "${await target.title()}"`);
          },
        };
      }

      // Locator assertions
      return {
        async toBeVisible(options?: { timeout?: number }) {
          await target.waitFor({ state: 'visible', timeout: options?.timeout ?? timeout });
        },
        async toBeHidden(options?: { timeout?: number }) {
          await target.waitFor({ state: 'hidden', timeout: options?.timeout ?? timeout });
        },
        async toHaveText(expected: string | RegExp, options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            const text = await target.textContent();
            if (typeof expected === 'string' && text === expected) return;
            if (expected instanceof RegExp && text && expected.test(text)) return;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error(`Expected text "${expected}" but got "${await target.textContent()}"`);
        },
        async toContainText(expected: string | RegExp, options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            const text = await target.textContent();
            if (typeof expected === 'string' && text?.includes(expected)) return;
            if (expected instanceof RegExp && text && expected.test(text)) return;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error(`Expected text to contain "${expected}"`);
        },
      };
    };
  }
}
