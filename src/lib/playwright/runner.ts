import { chromium, firefox, webkit, Browser, Page, BrowserContext, Locator } from 'playwright';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { DEFAULT_SELECTOR_PRIORITY } from '@/lib/db/schema';
import type { Test, TestResult, ActionSelector, SelectorConfig, PlaywrightSettings, NetworkRequest, EnvironmentConfig } from '@/lib/db/schema';
import { getServerManager } from './server-manager';

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
  consoleErrors?: string[];
  networkRequests?: NetworkRequest[];
}

export interface ProgressCallback {
  completed: number;
  total: number;
  currentTestName?: string;
}

export class PlaywrightRunner extends EventEmitter {
  private browser: Browser | null = null;
  private screenshotDir: string;
  private isRunning = false;
  private aborted = false;
  private settings: PlaywrightSettings | null = null;
  private environmentConfig: EnvironmentConfig | null = null;
  private repositoryId: string | null;

  constructor(repositoryId?: string | null, screenshotDir?: string) {
    super();
    this.repositoryId = repositoryId ?? null;
    // Build screenshot directory path: include repositoryId if provided
    const baseDir = screenshotDir ?? './public/screenshots';
    this.screenshotDir = this.repositoryId
      ? path.join(baseDir, this.repositoryId)
      : baseDir;
  }

  setSettings(settings: PlaywrightSettings) {
    this.settings = settings;
  }

  setEnvironmentConfig(config: EnvironmentConfig) {
    this.environmentConfig = config;
    // Also configure the server manager
    const serverManager = getServerManager();
    serverManager.setConfig(config);
  }

  getEnvironmentConfig(): EnvironmentConfig | null {
    return this.environmentConfig;
  }

  /**
   * Resolve URL using environment config base URL substitution
   */
  private resolveUrl(url: string): string {
    const serverManager = getServerManager();
    return serverManager.resolveUrl(url);
  }

  private getBrowserLauncher() {
    const browserType = this.settings?.browser || 'chromium';
    switch (browserType) {
      case 'firefox': return firefox;
      case 'webkit': return webkit;
      default: return chromium;
    }
  }

  private getViewport() {
    return {
      width: this.settings?.viewportWidth || 1280,
      height: this.settings?.viewportHeight || 720,
    };
  }

  private getSelectorPriority(): SelectorConfig[] {
    return this.settings?.selectorPriority || DEFAULT_SELECTOR_PRIORITY;
  }

  private getActionTimeout() {
    return this.settings?.actionTimeout || 5000;
  }

  async runTests(
    tests: Test[],
    runId: string,
    onProgress?: (progress: ProgressCallback) => void,
    onResult?: (result: TestRunResult) => void
  ): Promise<TestRunResult[]> {
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

    // Ensure server is running (managed mode)
    const serverManager = getServerManager();
    const serverStatus = await serverManager.ensureServerRunning();
    if (!serverStatus.ready) {
      this.isRunning = false;
      throw new Error(serverStatus.error || 'Server not ready');
    }

    try {
      const launcher = this.getBrowserLauncher();
      const headless = this.settings?.headless ?? true;
      this.browser = await launcher.launch({ headless });

      this.emit('event', {
        type: 'started',
        timestamp: Date.now(),
      } as RunEvent);

      for (let i = 0; i < tests.length; i++) {
        const test = tests[i];
        if (this.aborted) break;

        onProgress?.({
          completed: i,
          total: tests.length,
          currentTestName: test.name,
        });

        const result = await this.runSingleTest(test, runId);
        results.push(result);
        onResult?.(result);

        onProgress?.({
          completed: i + 1,
          total: tests.length,
          currentTestName: test.name,
        });
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

    // Track errors during test execution
    const consoleErrors: string[] = [];
    const networkFailures: NetworkRequest[] = [];

    try {
      context = await this.browser.newContext({
        viewport: this.getViewport(),
      });
      page = await context.newPage();

      // Capture console errors before navigation
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // Capture network failures before navigation
      page.on('response', response => {
        if (response.status() >= 400) {
          networkFailures.push({
            url: response.url(),
            method: response.request().method(),
            status: response.status(),
            duration: 0,
            resourceType: response.request().resourceType(),
          });
        }
      });

      // Compute screenshotPath for the test function
      const testScreenshotPath = path.join(this.screenshotDir, `${runId}-${test.id}.png`);

      // Execute the test code
      await this.executeTestCode(page, test, runId, testScreenshotPath);

      // Check for console errors or network failures after test execution
      if (consoleErrors.length > 0 || networkFailures.length > 0) {
        const errorParts: string[] = [];
        if (consoleErrors.length > 0) {
          errorParts.push(`Console errors detected: ${consoleErrors.join('; ')}`);
        }
        if (networkFailures.length > 0) {
          const failureDetails = networkFailures.map(f => `${f.method} ${f.url} (${f.status})`).join('; ');
          errorParts.push(`Network failures detected: ${failureDetails}`);
        }
        throw new Error(errorParts.join(' | '));
      }

      // Take screenshot on success
      const screenshotFilename = `${runId}-${test.id}-success.png`;
      const screenshotPath = path.join(this.screenshotDir, screenshotFilename);
      await page.screenshot({ path: screenshotPath });

      const durationMs = Date.now() - startTime;

      // Build public path with repositoryId if present
      const publicPath = this.repositoryId
        ? `/screenshots/${this.repositoryId}/${screenshotFilename}`
        : `/screenshots/${screenshotFilename}`;

      this.emit('event', {
        type: 'test_passed',
        testId: test.id,
        testName: test.name,
        durationMs,
        screenshotPath: publicPath,
        timestamp: Date.now(),
      } as RunEvent);

      return {
        testId: test.id,
        status: 'passed',
        durationMs,
        screenshotPath: publicPath,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
        networkRequests: networkFailures.length > 0 ? networkFailures : undefined,
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
          // Build public path with repositoryId if present
          screenshotPath = this.repositoryId
            ? `/screenshots/${this.repositoryId}/${screenshotFilename}`
            : `/screenshots/${screenshotFilename}`;
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
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
        networkRequests: networkFailures.length > 0 ? networkFailures : undefined,
      };

    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }

  private async executeTestCode(page: Page, test: Test, runId: string, screenshotPath: string): Promise<void> {
    const code = test.code;
    if (!code) {
      throw new Error('No test code');
    }

    // Try to execute as a proper function with signature:
    // export async function test(page, baseUrl, screenshotPath, stepLogger)
    const funcMatch = code.match(
      /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
    );

    if (funcMatch) {
      const serverManager = getServerManager();
      const baseUrl = this.environmentConfig?.baseUrl || serverManager.resolveUrl('http://localhost:3000').replace(/\/$/, '') || 'http://localhost:3000';

      const stepLogger = {
        log: (msg: string) => {
          this.emit('event', {
            type: 'test_started',
            testId: test.id,
            testName: `${test.name}: ${msg}`,
            timestamp: Date.now(),
          } as RunEvent);
        },
      };

      // Strip import statements and the function wrapper, execute the body
      const body = funcMatch[1];

      // Build an async function from the body
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const testFn = new AsyncFunction('page', 'baseUrl', 'screenshotPath', 'stepLogger', body);
      await testFn(page, baseUrl, screenshotPath, stepLogger);
      return;
    }

    // Legacy: try Playwright test format
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

  // Locate element using fallback selector strategy
  private async locateWithFallback(
    page: Page,
    selectors: ActionSelector[],
  ): Promise<Locator> {
    const priority = this.getSelectorPriority();
    const timeout = this.getActionTimeout();

    // Sort selectors by user-defined priority
    const sorted = selectors
      .filter(s => priority.find(p => p.type === s.type && p.enabled))
      .sort((a, b) => {
        const aPriority = priority.find(p => p.type === a.type)?.priority ?? 999;
        const bPriority = priority.find(p => p.type === b.type)?.priority ?? 999;
        return aPriority - bPriority;
      });

    // Try each selector in priority order
    const perSelectorTimeout = Math.max(Math.floor(timeout / sorted.length), 1000);

    for (const sel of sorted) {
      try {
        const locator = page.locator(sel.value);
        await locator.waitFor({ timeout: perSelectorTimeout, state: 'visible' });
        return locator;
      } catch {
        continue;
      }
    }

    // If no prioritized selectors worked, try all selectors as fallback
    for (const sel of selectors) {
      try {
        const locator = page.locator(sel.value);
        await locator.waitFor({ timeout: 1000, state: 'visible' });
        return locator;
      } catch {
        continue;
      }
    }

    throw new Error(`No selector matched: ${JSON.stringify(selectors)}`);
  }

  private async executeLine(page: Page, line: string): Promise<void> {
    // Parse and execute individual Playwright commands
    if (line.startsWith('await page.goto(')) {
      const urlMatch = line.match(/goto\(['"]([^'"]+)['"]\)/);
      if (urlMatch) {
        const timeout = this.settings?.navigationTimeout || 30000;
        // Resolve URL using environment config for base URL substitution
        const resolvedUrl = this.resolveUrl(urlMatch[1]);
        await page.goto(resolvedUrl, { timeout });
      }
    } else if (line.startsWith('await locateWithFallback(')) {
      // Parse multi-selector format: await locateWithFallback(page, [...], 'action', 'value');
      const match = line.match(/locateWithFallback\(page,\s*(\[.*?\]),\s*'(\w+)'(?:,\s*'([^']*)')?\)/);
      if (match) {
        const selectors: ActionSelector[] = JSON.parse(match[1]);
        const action = match[2];
        const value = match[3];

        const locator = await this.locateWithFallback(page, selectors);

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
    } else if (line.startsWith('await page.locator(')) {
      // Legacy single selector format
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
      // Execute screenshot commands from AI-generated tests
      const pathMatch = line.match(/path:\s*['"]([^'"]+)['"]/);
      const fullPageMatch = line.match(/fullPage:\s*(true|false)/);

      if (pathMatch) {
        const screenshotPath = pathMatch[1];
        const fullPage = fullPageMatch ? fullPageMatch[1] === 'true' : false;
        await page.screenshot({ path: screenshotPath, fullPage });
      }
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

// Singleton instance for the runner (keyed by repositoryId)
let runnerInstance: PlaywrightRunner | null = null;
let currentRepositoryId: string | null = null;

export function getRunner(repositoryId?: string | null): PlaywrightRunner {
  const repoId = repositoryId ?? null;

  // If repositoryId changed, create a new runner instance
  if (!runnerInstance || currentRepositoryId !== repoId) {
    // Only create new instance if not currently running tests
    if (runnerInstance?.isActive()) {
      return runnerInstance;
    }
    currentRepositoryId = repoId;
    runnerInstance = new PlaywrightRunner(repoId);
  }

  return runnerInstance;
}
