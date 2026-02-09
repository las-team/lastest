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
}

export class TestRunner {
  private browser: Browser | null = null;
  private logs: LogEntry[] = [];
  private abortController: AbortController | null = null;
  private currentTestRunId: string | null = null;

  /**
   * Abort the currently running test
   */
  abort(testRunId?: string): boolean {
    if (testRunId && this.currentTestRunId !== testRunId) {
      return false; // Not the current test
    }
    if (this.abortController) {
      this.abortController.abort();
      return true;
    }
    return false;
  }

  isRunning(): boolean {
    return this.abortController !== null;
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
    this.logs = [];
    this.abortController = new AbortController();
    this.currentTestRunId = command.testRunId;
    const startTime = Date.now();
    const screenshots: Array<{ filename: string; data: string; width: number; height: number }> = [];

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      // Check if already aborted
      if (this.abortController.signal.aborted) {
        throw new Error('Test cancelled before starting');
      }

      // Verify code integrity before execution (prevents MITM code injection)
      if (!verifyCodeIntegrity(command.code, command.codeHash)) {
        throw new Error('Code integrity check failed - hash mismatch');
      }

      this.log('info', 'Launching browser...');
      onProgress?.('Launching browser', 10);

      // TODO: Support browser selection
      this.browser = await chromium.launch({ headless: true });

      const viewport = command.viewport || { width: 1280, height: 720 };
      // Inject storageState from setup scripts (e.g. login session cookies/localStorage)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsedStorageState: any;
      if (command.storageState) {
        try {
          parsedStorageState = JSON.parse(command.storageState);
          this.log('info', `Injecting storageState: ${parsedStorageState.cookies?.length ?? 0} cookies, ${parsedStorageState.origins?.length ?? 0} origins`);
        } catch (e) {
          this.log('warn', `Failed to parse storageState: ${e}`);
        }
      }
      context = await this.browser.newContext({ viewport, ...(parsedStorageState ? { storageState: parsedStorageState } : {}) });
      page = await context.newPage();

      this.log('info', `Browser launched, viewport: ${viewport.width}x${viewport.height}`);
      onProgress?.('Running test', 30);

      // Create screenshot capture function
      const captureScreenshot = async (label: string) => {
        if (!page) return;
        try {
          const buffer = await page.screenshot({ fullPage: true });
          const filename = `${command.testRunId}-${command.testId}-${label}.png`;
          const base64 = buffer.toString('base64');
          const { width, height } = viewport;
          screenshots.push({ filename, data: base64, width, height });
          this.log('info', `Captured screenshot: ${filename}`);
        } catch (err) {
          this.log('warn', `Failed to capture screenshot: ${err}`);
        }
      };

      // Check abort before executing test
      if (this.abortController?.signal.aborted) {
        throw new Error('Test cancelled');
      }

      // Execute test code
      await this.executeTestCode(page, command.code, command.targetUrl, captureScreenshot);

      // Check abort after test
      if (this.abortController?.signal.aborted) {
        throw new Error('Test cancelled');
      }

      onProgress?.('Test completed', 90);

      // If no screenshots were captured, take a success screenshot
      if (screenshots.length === 0) {
        await captureScreenshot('success');
      }

      const durationMs = Date.now() - startTime;
      this.log('info', `Test passed in ${durationMs}ms`);

      return {
        status: 'passed',
        durationMs,
        logs: this.logs,
        screenshots,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Check if this was a cancellation
      const isCancelled = errorMessage.includes('cancelled') || this.abortController?.signal.aborted;
      if (isCancelled) {
        this.log('info', 'Test cancelled');
        return {
          status: 'cancelled',
          durationMs,
          error: {
            message: 'Test cancelled by user',
          },
          logs: this.logs,
          screenshots,
        };
      }

      this.log('error', `Test failed: ${errorMessage}`);

      // Capture failure screenshot
      let errorScreenshot: string | undefined;
      if (page) {
        try {
          const buffer = await page.screenshot({ fullPage: true });
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
          this.log('warn', 'Failed to capture error screenshot');
        }
      }

      return {
        status: 'failed',
        durationMs,
        error: {
          message: errorMessage,
          stack: errorStack,
          screenshot: errorScreenshot,
        },
        logs: this.logs,
        screenshots,
      };
    } finally {
      this.abortController = null;
      this.currentTestRunId = null;
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    }
  }

  private async executeTestCode(
    page: Page,
    code: string,
    targetUrl: string,
    captureScreenshot: (label: string) => Promise<void>
  ): Promise<void> {
    // Extract function body from: export async function test(page, baseUrl, screenshotPath, stepLogger) { ... }
    const funcMatch = code.match(
      /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
    );

    if (!funcMatch) {
      throw new Error('Invalid test code format: expected export async function test(page, ...)');
    }

    // Strip TypeScript annotations
    let body = this.stripTypeAnnotations(funcMatch[1]);

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
      }
    }

    // Create stepLogger
    const stepLogger = {
      log: (msg: string) => {
        this.log('info', `Step: ${msg}`);
      },
    };

    // Create locateWithFallback helper
    const locateWithFallback = async (
      pg: Page,
      selectors: Array<{ type: string; value: string }>,
      action: string,
      value?: string | null,
      coords?: { x: number; y: number } | null
    ) => {
      const validSelectors = selectors.filter(
        (s) => s.value && s.value.trim() && !s.value.includes('undefined')
      );

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

          if (action === 'locate') return target;
          if (action === 'click') await target.click();
          else if (action === 'fill') await target.fill(value || '');
          else if (action === 'selectOption') await target.selectOption(value || '');

          return target;
        } catch {
          continue;
        }
      }

      // Coordinate fallback for clicks
      if (action === 'click' && coords) {
        this.log('info', `Falling back to coordinate click at (${coords.x}, ${coords.y})`);
        await pg.mouse.click(coords.x, coords.y);
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
      if (options?.path) {
        const label = `step${screenshotStep++}`;
        await captureScreenshot(label);
      }
      return result;
    };

    // Execute the test
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

    await testFn(page, targetUrl, 'screenshot.png', stepLogger, expect, locateWithFallback);
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
