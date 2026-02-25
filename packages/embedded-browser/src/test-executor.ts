/**
 * Test Executor for Embedded Browser
 *
 * Executes test code against the live shared page (no new browser launch).
 * Uses the same `new Function()` pattern as `packages/runner/src/runner.ts`
 * but adapted for the embedded context.
 */

import type { Page } from 'playwright';

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

  async runTest(page: Page, command: RunTestPayload): Promise<EmbeddedTestResult> {
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

    try {
      if (abortCtrl.signal.aborted) {
        throw new Error('Test cancelled before starting');
      }

      // Navigate to target URL on the shared page
      logFn('info', `Navigating to ${command.targetUrl}`);
      await page.goto(command.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const viewport = command.viewport || { width: 1280, height: 720 };

      // Screenshot helper
      const captureScreenshot = async (label: string) => {
        try {
          const buffer = await page.screenshot({ fullPage: true });
          const filename = `${command.testRunId}-${command.testId}-${label.replace(/ /g, '_')}.png`;
          const base64 = buffer.toString('base64');
          screenshots.push({ filename, data: base64, width: viewport.width, height: viewport.height });
          logFn('info', `Captured screenshot: ${filename}`);
        } catch (err) {
          logFn('warn', `Failed to capture screenshot: ${err}`);
        }
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

      // Step logger
      const stepLogger = {
        log: (msg: string) => logFn('info', `Step: ${msg}`),
        warn: (msg: string) => logFn('warn', `Step warning: ${msg}`),
        error: (msg: string) => logFn('error', `Step error: ${msg}`),
      };

      logFn('info', 'Executing test code...');

      // Execute with timeout
      await Promise.race([
        (async () => {
          const testFn = new Function(
            'page', 'baseUrl', 'screenshotPath', 'stepLogger',
            `return (async () => { ${body} })();`
          );
          await testFn(page, command.targetUrl, captureScreenshot, stepLogger);
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
      // Navigate back to blank to reset state for next test
      await page.goto('about:blank').catch(() => {});
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
