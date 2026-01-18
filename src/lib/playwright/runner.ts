import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import type { Test, TestResult } from '@/lib/db/schema';

export interface RunEvent {
  type: 'started' | 'test_started' | 'test_passed' | 'test_failed' | 'completed';
  testId?: string;
  testName?: string;
  error?: string;
  durationMs?: number;
  screenshotPath?: string;
  timestamp: number;
}

export interface TestRunResult {
  testId: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  screenshotPath?: string;
  errorMessage?: string;
}

export class PlaywrightRunner extends EventEmitter {
  private browser: Browser | null = null;
  private screenshotDir: string;
  private isRunning = false;
  private aborted = false;

  constructor(screenshotDir: string = './public/screenshots') {
    super();
    this.screenshotDir = screenshotDir;
  }

  async runTests(tests: Test[], runId: string): Promise<TestRunResult[]> {
    if (this.isRunning) {
      throw new Error('Already running tests');
    }

    this.isRunning = true;
    this.aborted = false;
    const results: TestRunResult[] = [];

    // Ensure screenshot directory exists
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }

    try {
      this.browser = await chromium.launch({ headless: true });

      this.emit('event', {
        type: 'started',
        timestamp: Date.now(),
      } as RunEvent);

      for (const test of tests) {
        if (this.aborted) break;

        const result = await this.runSingleTest(test, runId);
        results.push(result);
      }

      this.emit('event', {
        type: 'completed',
        timestamp: Date.now(),
      } as RunEvent);

    } finally {
      await this.cleanup();
      this.isRunning = false;
    }

    return results;
  }

  private async runSingleTest(test: Test, runId: string): Promise<TestRunResult> {
    const startTime = Date.now();

    this.emit('event', {
      type: 'test_started',
      testId: test.id,
      testName: test.name,
      timestamp: startTime,
    } as RunEvent);

    if (!this.browser) {
      return {
        testId: test.id,
        status: 'failed',
        durationMs: 0,
        errorMessage: 'Browser not initialized',
      };
    }

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      page = await context.newPage();

      // Execute the test code
      await this.executeTestCode(page, test);

      // Take screenshot on success
      const screenshotFilename = `${runId}-${test.id}-success.png`;
      const screenshotPath = path.join(this.screenshotDir, screenshotFilename);
      await page.screenshot({ path: screenshotPath });

      const durationMs = Date.now() - startTime;

      this.emit('event', {
        type: 'test_passed',
        testId: test.id,
        testName: test.name,
        durationMs,
        screenshotPath: `/screenshots/${screenshotFilename}`,
        timestamp: Date.now(),
      } as RunEvent);

      return {
        testId: test.id,
        status: 'passed',
        durationMs,
        screenshotPath: `/screenshots/${screenshotFilename}`,
      };

    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Take screenshot on failure
      let screenshotPath: string | undefined;
      if (page) {
        try {
          const screenshotFilename = `${runId}-${test.id}-failure.png`;
          const fullPath = path.join(this.screenshotDir, screenshotFilename);
          await page.screenshot({ path: fullPath });
          screenshotPath = `/screenshots/${screenshotFilename}`;
        } catch {
          // Ignore screenshot errors
        }
      }

      this.emit('event', {
        type: 'test_failed',
        testId: test.id,
        testName: test.name,
        durationMs,
        error: errorMessage,
        screenshotPath,
        timestamp: Date.now(),
      } as RunEvent);

      return {
        testId: test.id,
        status: 'failed',
        durationMs,
        screenshotPath,
        errorMessage,
      };

    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }

  private async executeTestCode(page: Page, test: Test): Promise<void> {
    // Parse and execute the generated Playwright code
    // This is a simplified execution - in production, you'd use a proper sandbox

    const code = test.code;
    if (!code) {
      throw new Error('No test code');
    }

    // Extract the test body (everything between test('...', async ({ page }) => { and });)
    const bodyMatch = code.match(/test\([^,]+,\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{([\s\S]*)\}\);?\s*$/);

    if (!bodyMatch) {
      // Try to run it as direct commands
      const lines = code.split('\n').filter(line =>
        line.trim().startsWith('await page.')
      );

      for (const line of lines) {
        await this.executeLine(page, line.trim());
      }
      return;
    }

    const body = bodyMatch[1];
    const lines = body.split('\n').filter(line => line.trim() && !line.trim().startsWith('//'));

    for (const line of lines) {
      await this.executeLine(page, line.trim());
    }
  }

  private async executeLine(page: Page, line: string): Promise<void> {
    // Parse and execute individual Playwright commands
    if (line.startsWith('await page.goto(')) {
      const urlMatch = line.match(/goto\(['"]([^'"]+)['"]\)/);
      if (urlMatch) {
        await page.goto(urlMatch[1]);
      }
    } else if (line.startsWith('await page.locator(')) {
      const locatorMatch = line.match(/locator\(['"]([^'"]+)['"]\)/);
      const actionMatch = line.match(/\.(click|fill|selectOption)\(['"]?([^'")]*)?['"]?\)/);

      if (locatorMatch && actionMatch) {
        const selector = locatorMatch[1];
        const action = actionMatch[1];
        const value = actionMatch[2];

        const locator = page.locator(selector);

        switch (action) {
          case 'click':
            await locator.click();
            break;
          case 'fill':
            await locator.fill(value || '');
            break;
          case 'selectOption':
            await locator.selectOption(value || '');
            break;
        }
      }
    } else if (line.startsWith('await page.screenshot(')) {
      // Skip screenshot commands during test execution
    }
  }

  abort(): void {
    this.aborted = true;
  }

  private async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
let runnerInstance: PlaywrightRunner | null = null;

export function getRunner(): PlaywrightRunner {
  if (!runnerInstance) {
    runnerInstance = new PlaywrightRunner();
  }
  return runnerInstance;
}
