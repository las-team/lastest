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

export interface CapturedScreenshot {
  path: string;
  label: string;
}

export interface TestRunResult {
  testId: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  screenshotPath?: string;
  screenshots: CapturedScreenshot[];
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
    onResult?: (result: TestRunResult) => void | Promise<void>,
    headlessOverride?: boolean
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
      const headlessMode = this.settings?.headlessMode ?? 'true';
      // Support headlessOverride for backward compatibility
      // 'shell' uses new headless mode that better avoids bot detection
      const headless = headlessOverride !== undefined
        ? headlessOverride
        : headlessMode === 'shell'
          ? 'shell'
          : headlessMode === 'true';
      // Cast needed as Playwright types may not include 'shell' yet
      this.browser = await launcher.launch({ headless: headless as boolean | undefined });

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
        await onResult?.(result);

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
        screenshots: [],
        errorMessage: 'Browser not initialized',
      };
    }

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    // Track errors during test execution
    const consoleErrors: string[] = [];
    const networkFailures: NetworkRequest[] = [];

    // Track captured screenshots from within test code (outside try so catch can access)
    const capturedScreenshots: CapturedScreenshot[] = [];
    let currentStepLabel = 'initial';

    try {
      context = await this.browser.newContext({
        viewport: this.getViewport(),
      });
      page = await context.newPage();

      // Patterns for console errors that should be ignored (React dev warnings, hydration, etc.)
      const ignoredErrorPatterns = [
        /hydrat(ion|ed)/i,
        /server rendered HTML/i,
        /This won't be patched up/i,
        /react\.dev\/link\/hydration-mismatch/i,
        /Warning: .* did not match/i,
        /Text content does not match/i,
      ];

      // Capture console errors before navigation (filtered)
      page.on('console', msg => {
        if (msg.type() === 'error') {
          const text = msg.text();
          const isIgnored = ignoredErrorPatterns.some(p => p.test(text));
          if (!isIgnored) {
            consoleErrors.push(text);
          }
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

      // Create a proxy that intercepts page.screenshot() calls
      const screenshotProxy = new Proxy(page, {
        get: (target, prop) => {
          if (prop === 'screenshot') {
            return async (options?: Record<string, unknown>) => {
              const result = await target.screenshot(options as any);
              if (options?.path) {
                const filename = path.basename(options.path as string);
                const publicPath = this.repositoryId
                  ? `/screenshots/${this.repositoryId}/${filename}`
                  : `/screenshots/${filename}`;
                capturedScreenshots.push({ path: publicPath, label: currentStepLabel });
              }
              return result;
            };
          }
          const value = (target as any)[prop];
          if (typeof value === 'function') {
            return value.bind(target);
          }
          return value;
        }
      });

      // Execute the test code with the proxy page
      await this.executeTestCode(screenshotProxy, test, runId, testScreenshotPath, (label: string) => {
        currentStepLabel = label;
      });

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

      let screenshotPublicPath: string | undefined;

      // Only take a fallback success screenshot if no screenshots were captured during the test
      if (capturedScreenshots.length === 0) {
        const screenshotFilename = `${runId}-${test.id}-success.png`;
        const screenshotPath = path.join(this.screenshotDir, screenshotFilename);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshotPublicPath = this.repositoryId
          ? `/screenshots/${this.repositoryId}/${screenshotFilename}`
          : `/screenshots/${screenshotFilename}`;
      }

      const durationMs = Date.now() - startTime;

      this.emit('event', {
        type: 'test_passed',
        testId: test.id,
        testName: test.name,
        durationMs,
        screenshotPath: screenshotPublicPath || capturedScreenshots[0]?.path,
        timestamp: Date.now(),
      } as RunEvent);

      return {
        testId: test.id,
        status: 'passed',
        durationMs,
        // Use first captured screenshot if any, otherwise fallback screenshot
        screenshotPath: capturedScreenshots[0]?.path || screenshotPublicPath,
        screenshots: capturedScreenshots,
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
          await page.screenshot({ path: fullPath, fullPage: true });
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

      // Combine any screenshots captured before the error with the failure screenshot
      const allScreenshots = [...capturedScreenshots];
      if (screenshotPath) {
        allScreenshots.push({ path: screenshotPath, label: 'failure' });
      }

      return {
        testId: test.id,
        status: 'failed',
        durationMs,
        screenshotPath,
        screenshots: allScreenshots,
        errorMessage,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
        networkRequests: networkFailures.length > 0 ? networkFailures : undefined,
      };

    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }

  /**
   * Strip TypeScript type annotations from code so it can execute as plain JavaScript.
   */
  private stripTypeAnnotations(code: string): string {
    let result = code;
    // Remove variable type annotations: `const x: Type = ...` → `const x = ...`
    // Handles generics like Array<string>, Record<string, number>, etc.
    result = result.replace(
      /\b(const|let|var)\s+(\w+)\s*:\s*[^=\n;]+(\s*=)/g,
      '$1 $2$3'
    );
    // Remove type annotations on destructured assignments: `const { a, b }: Type = ...`
    result = result.replace(
      /\b(const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*:\s*[^=\n;]+(\s*=)/g,
      '$1 $2$3'
    );
    // Remove `as Type` assertions (but not 'as' in other contexts like aliases)
    result = result.replace(/\)\s+as\s+\w[\w<>\[\],\s|]*/g, ')');
    result = result.replace(/(\w)\s+as\s+\w[\w<>\[\],\s|]*/g, '$1');
    // Remove angle-bracket type assertions: `<Type>expr`
    result = result.replace(/<\w[\w<>\[\],\s|]*>\s*(?=\(|[\w])/g, '');
    return result;
  }

  private async executeTestCode(page: Page, test: Test, runId: string, screenshotPath: string, onStepLabel?: (label: string) => void): Promise<void> {
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
          onStepLabel?.(msg);
          this.emit('event', {
            type: 'test_started',
            testId: test.id,
            testName: `${test.name}: ${msg}`,
            timestamp: Date.now(),
          } as RunEvent);
        },
      };

      // Strip import statements and the function wrapper, execute the body
      // Also strip TypeScript annotations since code runs as plain JavaScript
      const body = this.stripTypeAnnotations(funcMatch[1]);

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
      // Use bracket-balanced extraction instead of regex to handle selectors with brackets like `div[data-test]`
      const startIdx = line.indexOf('[');
      if (startIdx === -1) return;

      let depth = 0;
      let endIdx = -1;
      for (let i = startIdx; i < line.length; i++) {
        if (line[i] === '[') depth++;
        else if (line[i] === ']') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }

      if (endIdx === -1) return;

      const jsonStr = line.slice(startIdx, endIdx + 1);
      const remainder = line.slice(endIdx + 1);
      const argsMatch = remainder.match(/,\s*'(\w+)'(?:,\s*'([^']*)')?/);

      if (argsMatch) {
        const selectors: ActionSelector[] = JSON.parse(jsonStr);
        const action = argsMatch[1];
        const value = argsMatch[2];

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
        const rawPath = pathMatch[1];
        // Resolve public URL paths (e.g. /screenshots/...) to filesystem paths
        const screenshotPath = rawPath.startsWith('/screenshots/')
          ? path.join('./public', rawPath)
          : rawPath;
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
