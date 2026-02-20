/**
 * Test Runner for Agent
 * Executes Playwright tests and returns results.
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { createHash } from 'crypto';
import type { RunTestCommandPayload, LogEntry } from './protocol.js';

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
  screenshots: Array<{ filename: string; data: string; width: number; height: number }>;
  softErrors?: string[];
}

export class TestRunner {
  private browser: Browser | null = null;
  private browserLaunchPromise: Promise<Browser> | null = null;
  private activeTests = new Map<string, { abort: AbortController; testRunId: string }>();
  private logs: LogEntry[] = [];
  // Legacy single-test tracking (for backward compat with abort/isRunning)
  private abortController: AbortController | null = null;
  private currentTestRunId: string | null = null;

  /**
   * Ensure a shared browser instance is running.
   * Concurrent calls share the same launch promise.
   */
  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    if (this.browserLaunchPromise) {
      return this.browserLaunchPromise;
    }
    this.browserLaunchPromise = chromium.launch({ headless: true }).then(b => {
      this.browser = b;
      this.browserLaunchPromise = null;
      return b;
    });
    return this.browserLaunchPromise;
  }

  /**
   * Close the shared browser if no tests are running.
   * Nulls the reference BEFORE closing so concurrent ensureBrowser()
   * calls see null and launch a fresh browser instead of getting the
   * dying one.
   */
  async closeBrowserIfIdle(): Promise<void> {
    if (this.activeTests.size === 0 && this.browser) {
      const b = this.browser;
      this.browser = null;
      await b.close().catch(() => {});
    }
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
    const logFn = (level: 'info' | 'warn' | 'error', message: string) => {
      logs.push({ timestamp: Date.now(), level, message });
      const prefix = level === 'error' ? '  [ERROR]' : level === 'warn' ? '  [WARN]' : '  [INFO]';
      console.log(`${prefix} [${command.testId}] ${message}`);
    };

    const startTime = Date.now();
    const screenshots: Array<{ filename: string; data: string; width: number; height: number }> = [];

    let context: BrowserContext | null = null;
    let page: Page | null = null;
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

      // Use shared browser instance
      await this.ensureBrowser();

      const viewport = command.viewport || { width: 1280, height: 720 };
      // Inject storageState from setup scripts (e.g. login session cookies/localStorage)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsedStorageState: any;
      if (command.storageState) {
        try {
          parsedStorageState = JSON.parse(command.storageState);
          logFn('info', `Injecting storageState: ${parsedStorageState.cookies?.length ?? 0} cookies, ${parsedStorageState.origins?.length ?? 0} origins`);
        } catch (e) {
          logFn('warn', `Failed to parse storageState: ${e}`);
        }
      }
      context = await this.browser!.newContext({ viewport, ...(parsedStorageState ? { storageState: parsedStorageState } : {}) });
      page = await context.newPage();

      // Set explicit timeouts to prevent indefinite hangs
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

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
          const buffer = await rawScreenshot!({ fullPage: true });
          const filename = `${command.testRunId}-${command.testId}-${label.replace(/ /g, '_')}.png`;
          const base64 = buffer.toString('base64');
          const { width, height } = viewport;
          screenshots.push({ filename, data: base64, width, height });
          logFn('info', `Captured screenshot: ${filename}`);
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

      try {
        await Promise.race([
          this.executeTestCode(page, command.code, command.targetUrl, captureScreenshot, logFn).catch(e => { throw e; }),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(() => {
              logFn('warn', `Timeout fired (${testTimeout}ms) — closing context to kill in-flight operations`);
              context?.close().catch(() => {});
              context = null;
              page = null;
              reject(new Error(`Test execution timed out after ${testTimeout}ms`));
            }, testTimeout);
            testAbort.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              logFn('info', 'Abort signal received — closing context');
              context?.close().catch(() => {});
              context = null;
              page = null;
              reject(new Error('Test cancelled'));
            });
          }),
        ]);
      } finally {
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

      const durationMs = Date.now() - startTime;
      logFn('info', `Test passed in ${durationMs}ms (${screenshots.length} screenshots)`);

      return {
        status: 'passed',
        durationMs,
        logs,
        screenshots,
        softErrors: softErrors.length > 0 ? softErrors : undefined,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Check if this was a cancellation
      const isCancelled = errorMessage.includes('cancelled') || testAbort.signal.aborted;
      if (isCancelled) {
        logFn('info', 'Test cancelled');
        return {
          status: 'cancelled',
          durationMs,
          error: {
            message: 'Test cancelled by user',
          },
          logs,
          screenshots,
        };
      }

      // Check if timeout
      const isTimeout = errorMessage.includes('timed out');
      logFn('error', `Test ${isTimeout ? 'timed out' : 'failed'}: ${errorMessage}`);

      // Capture failure screenshot — but NOT on timeout because the test code
      // is still running on the page and Playwright can't screenshot while
      // operations are in-flight (it would hang).
      let errorScreenshot: string | undefined;
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
      }

      return {
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
      };
    } finally {
      this.activeTests.delete(command.testId);
      // Clear legacy tracking if this was the tracked test
      if (this.currentTestRunId === command.testRunId) {
        this.abortController = null;
        this.currentTestRunId = null;
      }
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      // Close browser only when no tests are running
      await this.closeBrowserIfIdle();
    }
  }

  private async executeTestCode(
    page: Page,
    code: string,
    targetUrl: string,
    captureScreenshot: (label: string) => Promise<void>,
    logFn?: (level: 'info' | 'warn' | 'error', message: string) => void,
    softErrors?: string[]
  ): Promise<void> {
    const log = logFn ?? this.log.bind(this);
    // Extract function body from: export async function test(page, baseUrl, screenshotPath, stepLogger) { ... }
    const funcMatch = code.match(
      /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
    );

    if (!funcMatch) {
      throw new Error('Invalid test code format: expected export async function test(page, ...)');
    }

    // Strip TypeScript annotations
    let body = this.stripTypeAnnotations(funcMatch[1]);
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

    // Fix legacy page.keyboard.selectAll() → keyboard.press('Control+a')
    body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

    // Wrap standalone await statements (except screenshots) in try/catch for soft error handling
    // This matches the local runner behavior so tests continue past failures to reach screenshots
    body = body.replace(/^(\s*)(await\s+.+;)\s*$/gm, (_match: string, indent: string, stmt: string) => {
      if (stmt.includes('.screenshot(')) return `${indent}${stmt}`;
      return `${indent}try { ${stmt} } catch(__softErr) { stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
    });

    // Use caller-provided softErrors array, or create local one as fallback
    const errors = softErrors ?? [];

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
      const result = await originalScreenshot(options);
      const label = `Step ${screenshotStep++}`;
      await captureScreenshot(label);
      return result;
    };

    // Intercept page.goto to log navigation attempts
    const originalGoto = page.goto.bind(page);
    (page as Page & { goto: typeof originalGoto }).goto = async (url: string, options?: Parameters<typeof originalGoto>[1]) => {
      log('info', `Navigating to ${url}...`);
      const response = await originalGoto(url, options);
      log('info', `Navigation complete: ${response?.status() ?? 'no response'}`);
      return response;
    };

    // Execute the test
    log('info', 'Compiling test function...');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const testFn = new AsyncFunction(
      'page',
      'baseUrl',
      'screenshotPath',
      'stepLogger',
      'expect',
      'locateWithFallback',
      body
    );

    log('info', `Running test against ${targetUrl}...`);
    await testFn(page, targetUrl.replace(/\/+$/, ''), 'screenshot.png', stepLogger, expect, locateWithFallback);
    log('info', 'Test function returned successfully');
  }

  private stripTypeAnnotations(code: string): string {
    let result = code;
    result = result.replace(/\b(const|let|var)\s+(\w+)\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
    result = result.replace(/\b(const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
    result = result.replace(/\)\s+as\s+\w[\w<>\[\],\s|]*/g, ')');
    result = result.replace(/(\w)\s+as\s+\w[\w<>\[\],\s|]*/g, '$1');
    result = result.replace(/<\w[\w<>\[\],\s|]*>\s*(?=\(|[\w])/g, '');
    return result;
  }

  private createExpect(timeout = 5000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (target: any) => {
      const isPage = typeof target?.goto === 'function';

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
