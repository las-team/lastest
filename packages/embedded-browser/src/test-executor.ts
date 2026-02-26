/**
 * Test Executor for Embedded Browser
 *
 * Executes test code against the live shared page (no new browser launch).
 * Uses the same `new Function()` pattern as `packages/runner/src/runner.ts`
 * but adapted for the embedded context.
 */

import type { Browser, Page } from 'playwright';

export interface EmbeddedTestResult {
  status: 'passed' | 'failed' | 'error' | 'timeout' | 'cancelled';
  durationMs: number;
  error?: { message: string; stack?: string; screenshot?: string };
  logs: Array<{ timestamp: number; level: string; message: string }>;
  screenshots: Array<{ filename: string; data: string; width: number; height: number }>;
}

interface RunTestPayload {
  testId: string;
  testRunId: string;
  code: string;
  codeHash: string;
  targetUrl: string;
  timeout?: number;
  viewport?: { width: number; height: number };
}

/**
 * Strip TypeScript type annotations from test code so it can run as plain JS.
 */
function stripTypeAnnotations(code: string): string {
  // Remove `: Type` annotations after parameters and variables
  let result = code;
  // Parameter type annotations: (param: Type)
  result = result.replace(/:\s*(string|number|boolean|void|any|object|Page|BrowserContext|Record<[^>]+>|Array<[^>]+>|\{[^}]*\})\s*([,)=])/g, '$2');
  // Return type annotations: ): Type {
  result = result.replace(/\)\s*:\s*Promise<[^>]+>\s*\{/g, ') {');
  result = result.replace(/\)\s*:\s*\w+\s*\{/g, ') {');
  // Variable type annotations: const x: Type =
  result = result.replace(/(const|let|var)\s+(\w+)\s*:\s*[^=;]+\s*=/g, '$1 $2 =');
  return result;
}

export class EmbeddedTestExecutor {
  private abortController: AbortController | null = null;

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

  async runTest(browser: Browser, command: RunTestPayload): Promise<EmbeddedTestResult> {
    const abortCtrl = new AbortController();
    this.abortController = abortCtrl;

    const startTime = Date.now();
    const logs: Array<{ timestamp: number; level: string; message: string }> = [];
    const screenshots: Array<{ filename: string; data: string; width: number; height: number }> = [];
    const testTimeout = Math.max(command.timeout || 120000, 30000);

    const logFn = (level: string, message: string) => {
      logs.push({ timestamp: Date.now(), level, message });
      console.log(`  [${level.toUpperCase()}] [embedded:${command.testId}] ${message}`);
    };

    const viewport = command.viewport || { width: 1280, height: 720 };

    // Create a fresh context + page per test (mirrors standard runner)
    const testContext = await browser.newContext({ viewport });
    const page = await testContext.newPage();

    try {
      if (abortCtrl.signal.aborted) {
        throw new Error('Test cancelled before starting');
      }

      // Navigate to target URL on the fresh page
      logFn('info', `Navigating to ${command.targetUrl}`);
      await page.goto(command.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Override page.screenshot to intercept screenshot calls (mirrors runner.ts)
      let screenshotStep = 1;
      const originalScreenshot = page.screenshot.bind(page);

      // Screenshot helper
      const captureScreenshot = async (label: string) => {
        try {
          const buffer = await originalScreenshot({ fullPage: true });
          const filename = `${command.testRunId}-${command.testId}-${label.replace(/ /g, '_')}.png`;
          const base64 = buffer.toString('base64');
          screenshots.push({ filename, data: base64, width: viewport.width, height: viewport.height });
          logFn('info', `Captured screenshot: ${filename}`);
        } catch (err) {
          logFn('warn', `Failed to capture screenshot: ${err}`);
        }
      };

      (page as any).screenshot = async (options?: any) => {
        const label = `Step ${screenshotStep++}`;
        await captureScreenshot(label);
        return originalScreenshot(options);
      };

      // Extract function body
      const funcMatch = command.code.match(
        /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
      );

      let body: string;
      if (funcMatch) {
        body = stripTypeAnnotations(funcMatch[1]);
      } else {
        body = stripTypeAnnotations(command.code);
      }

      // Patch selectAll (mirrors runner.ts)
      body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

      // Soft error wrapping — skip screenshot lines (mirrors runner.ts)
      body = body.replace(/^(\s*)(await\s+.+;)\s*$/gm, (_match, indent, stmt) => {
        if (stmt.includes('.screenshot(')) return `${indent}${stmt}`;
        return `${indent}try { ${stmt} } catch(__softErr) { stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
      });

      // Step logger
      const stepLogger = {
        log: (msg: string) => logFn('info', `Step: ${msg}`),
        warn: (msg: string) => logFn('warn', `Step warning: ${msg}`),
        error: (msg: string) => logFn('error', `Step error: ${msg}`),
      };

      // Basic expect implementation (mirrors runner.ts createExpect)
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

      // Basic locateWithFallback — tries selectors in order
      const locateWithFallback = async (pg: Page, selectors: any[], action: string, value?: string) => {
        for (const sel of selectors) {
          try {
            const locator = typeof sel === 'string' ? pg.locator(sel) : pg.locator(sel.selector || sel.css || sel.text || '');
            if (await locator.count() > 0) {
              if (action === 'click') { await locator.first().click(); return; }
              if (action === 'fill') { await locator.first().fill(value || ''); return; }
              if (action === 'check') { await locator.first().check(); return; }
              if (action === 'uncheck') { await locator.first().uncheck(); return; }
            }
          } catch { /* try next selector */ }
        }
        throw new Error(`No selector matched for action "${action}": ${JSON.stringify(selectors)}`);
      };

      // Basic replayCursorPath
      const replayCursorPathFn = async (pg: Page, moves: [number, number, number][]) => {
        for (const [x, y, delay] of moves) {
          await pg.mouse.move(x, y);
          if (delay > 0) await pg.waitForTimeout(delay);
        }
      };

      logFn('info', 'Executing test code...');

      // Execute with timeout
      await Promise.race([
        (async () => {
          const testFn = new Function(
            'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'locateWithFallback', 'replayCursorPath',
            `return (async () => { ${body} })();`
          );
          await testFn(page, command.targetUrl, 'screenshot.png', stepLogger, expect, locateWithFallback, replayCursorPathFn);
        })(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`Test execution timed out after ${testTimeout}ms`));
          }, testTimeout);
          abortCtrl.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Test cancelled'));
          });
        }),
      ]);

      logFn('info', 'Test code execution completed');

      // Take success screenshot if none captured
      if (screenshots.length === 0) {
        await captureScreenshot('success');
      }

      const durationMs = Date.now() - startTime;
      logFn('info', `Test passed in ${durationMs}ms (${screenshots.length} screenshots)`);

      return { status: 'passed', durationMs, logs, screenshots };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const isCancelled = errorMessage.includes('cancelled') || abortCtrl.signal.aborted;

      if (isCancelled) {
        logFn('info', 'Test cancelled');
        return { status: 'cancelled', durationMs, logs, screenshots };
      }

      const isTimeout = errorMessage.includes('timed out');
      logFn('error', `Test ${isTimeout ? 'timed out' : 'failed'}: ${errorMessage}`);

      // Try to capture error screenshot
      let errorScreenshot: string | undefined;
      try {
        const buffer = await page.screenshot();
        errorScreenshot = buffer.toString('base64');
      } catch { /* ignore */ }

      return {
        status: isTimeout ? 'timeout' : 'failed',
        durationMs,
        error: { message: errorMessage, stack: errorStack, screenshot: errorScreenshot },
        logs,
        screenshots,
      };
    } finally {
      this.abortController = null;
      // Close the per-test page + context (no state leaks between tests)
      await page.close().catch(() => {});
      await testContext.close().catch(() => {});
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
