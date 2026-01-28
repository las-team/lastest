import { chromium, firefox, webkit, Browser, Page, BrowserContext, Locator } from 'playwright';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { DEFAULT_SELECTOR_PRIORITY } from '@/lib/db/schema';

/**
 * Create appState helper for internal state inspection.
 * Allows tests to access app state like undo/redo stack length, Redux store, etc.
 * Requires target app to expose state on window (e.g., window.__APP_STATE__).
 */
function createAppState(page: Page) {
  return {
    /**
     * Get a value from the app's exposed state by dot-notation path.
     * Looks for state in common locations: window.__APP_STATE__, window.store, window.__EXCALIDRAW_STATE__
     * @param path - Dot-notation path like 'history.length' or 'selectedElements.0.id'
     */
    get: async (path: string): Promise<unknown> => {
      return page.evaluate((p) => {
        const state = (window as any).__APP_STATE__ ||
                      (window as any).store?.getState?.() ||
                      (window as any).__EXCALIDRAW_STATE__ ||
                      (window as any).app?.state;
        if (!state) return undefined;
        return p.split('.').reduce((obj, key) => obj?.[key], state);
      }, path);
    },

    /**
     * Get Excalidraw-specific history length (undo/redo stack).
     * Returns -1 if Excalidraw API is not available.
     */
    getHistoryLength: async (): Promise<number> => {
      return page.evaluate(() => {
        const api = (window as any).excalidrawAPI;
        if (api?.getAppState) {
          const appState = api.getAppState();
          // History can be accessed differently depending on Excalidraw version
          return appState?.history?.length ??
                 (window as any).excalidrawHistory?.length ??
                 -1;
        }
        // Fallback: check common state patterns
        const state = (window as any).__EXCALIDRAW_STATE__ || (window as any).__APP_STATE__;
        return state?.history?.length ?? -1;
      });
    },

    /**
     * Get the entire app state object.
     * Useful for debugging or complex assertions.
     */
    getAll: async (): Promise<unknown> => {
      return page.evaluate(() => {
        return (window as any).__APP_STATE__ ||
               (window as any).store?.getState?.() ||
               (window as any).__EXCALIDRAW_STATE__ ||
               (window as any).app?.state ||
               null;
      });
    },

    /**
     * Execute a custom state accessor function in the page context.
     * @param accessor - Function that receives window and returns the desired value
     */
    evaluate: async <T>(accessor: string): Promise<T> => {
      return page.evaluate((fn) => {
        // Create function from string and execute it
        const func = new Function('window', `return ${fn}`);
        return func(window);
      }, accessor);
    },
  };
}

/**
 * Simple expect implementation for Playwright Inspector-generated tests.
 * Provides common assertion matchers that wrap Playwright's built-in locator assertions.
 * Supports both Page-level assertions (toHaveURL, toHaveTitle) and Locator assertions.
 */
function createExpect(timeout = 5000) {
  return function expect(target: Page | Locator) {
    // Check if target is a Page (has 'goto' method) vs Locator
    const isPage = typeof (target as any).goto === 'function';

    if (isPage) {
      const page = target as Page;
      return {
        async toHaveURL(expected: string | RegExp, options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            const url = page.url();
            if (typeof expected === 'string' && url === expected) return;
            if (expected instanceof RegExp && expected.test(url)) return;
            await new Promise(r => setTimeout(r, 100));
          }
          const actual = page.url();
          throw new Error(`Expected URL "${expected}" but got "${actual}"`);
        },
        async toHaveTitle(expected: string | RegExp, options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            const title = await page.title();
            if (typeof expected === 'string' && title === expected) return;
            if (expected instanceof RegExp && expected.test(title)) return;
            await new Promise(r => setTimeout(r, 100));
          }
          const actual = await page.title();
          throw new Error(`Expected title "${expected}" but got "${actual}"`);
        },
        not: {
          async toHaveURL(expected: string | RegExp, options?: { timeout?: number }) {
            const t = options?.timeout ?? timeout;
            const start = Date.now();
            while (Date.now() - start < t) {
              const url = page.url();
              if (typeof expected === 'string' && url !== expected) return;
              if (expected instanceof RegExp && !expected.test(url)) return;
              await new Promise(r => setTimeout(r, 100));
            }
            throw new Error(`Expected URL not to match "${expected}"`);
          },
          async toHaveTitle(expected: string | RegExp, options?: { timeout?: number }) {
            const t = options?.timeout ?? timeout;
            const start = Date.now();
            while (Date.now() - start < t) {
              const title = await page.title();
              if (typeof expected === 'string' && title !== expected) return;
              if (expected instanceof RegExp && !expected.test(title)) return;
              await new Promise(r => setTimeout(r, 100));
            }
            throw new Error(`Expected title not to match "${expected}"`);
          },
        },
      };
    }

    // Locator matchers
    const locator = target as Locator;
    return {
      async toBeVisible(options?: { timeout?: number }) {
        await locator.waitFor({ state: 'visible', timeout: options?.timeout ?? timeout });
      },
      async toBeHidden(options?: { timeout?: number }) {
        await locator.waitFor({ state: 'hidden', timeout: options?.timeout ?? timeout });
      },
      async toBeAttached(options?: { timeout?: number }) {
        await locator.waitFor({ state: 'attached', timeout: options?.timeout ?? timeout });
      },
      async toBeDetached(options?: { timeout?: number }) {
        await locator.waitFor({ state: 'detached', timeout: options?.timeout ?? timeout });
      },
      async toHaveText(expected: string | RegExp, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const text = await locator.textContent();
          if (typeof expected === 'string' && text === expected) return;
          if (expected instanceof RegExp && text && expected.test(text)) return;
          await new Promise(r => setTimeout(r, 100));
        }
        const actual = await locator.textContent();
        throw new Error(`Expected text "${expected}" but got "${actual}"`);
      },
      async toContainText(expected: string | RegExp, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const text = await locator.textContent();
          if (typeof expected === 'string' && text?.includes(expected)) return;
          if (expected instanceof RegExp && text && expected.test(text)) return;
          await new Promise(r => setTimeout(r, 100));
        }
        const actual = await locator.textContent();
        throw new Error(`Expected text to contain "${expected}" but got "${actual}"`);
      },
      async toHaveValue(expected: string | RegExp, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const value = await locator.inputValue();
          if (typeof expected === 'string' && value === expected) return;
          if (expected instanceof RegExp && expected.test(value)) return;
          await new Promise(r => setTimeout(r, 100));
        }
        const actual = await locator.inputValue();
        throw new Error(`Expected value "${expected}" but got "${actual}"`);
      },
      async toBeEnabled(options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          if (await locator.isEnabled()) return;
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Expected element to be enabled');
      },
      async toBeDisabled(options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          if (await locator.isDisabled()) return;
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Expected element to be disabled');
      },
      async toBeChecked(options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          if (await locator.isChecked()) return;
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Expected element to be checked');
      },
      async toHaveAttribute(name: string, value?: string | RegExp, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const attr = await locator.getAttribute(name);
          if (value === undefined && attr !== null) return;
          if (typeof value === 'string' && attr === value) return;
          if (value instanceof RegExp && attr && value.test(attr)) return;
          await new Promise(r => setTimeout(r, 100));
        }
        const actual = await locator.getAttribute(name);
        throw new Error(`Expected attribute "${name}" to be "${value}" but got "${actual}"`);
      },
      async toHaveCount(count: number, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const actual = await locator.count();
          if (actual === count) return;
          await new Promise(r => setTimeout(r, 100));
        }
        const actual = await locator.count();
        throw new Error(`Expected count ${count} but got ${actual}`);
      },
      // Coordinate assertion: verify element is at expected position
      async toBeAtPosition(x: number, y: number, tolerance = 5, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const box = await locator.boundingBox();
          if (box) {
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            if (Math.abs(centerX - x) <= tolerance && Math.abs(centerY - y) <= tolerance) {
              return;
            }
          }
          await new Promise(r => setTimeout(r, 100));
        }
        const box = await locator.boundingBox();
        const centerX = box ? box.x + box.width / 2 : 'N/A';
        const centerY = box ? box.y + box.height / 2 : 'N/A';
        throw new Error(`Expected position (${x}, ${y}) but got (${centerX}, ${centerY})`);
      },
      // Bounding box assertion: verify element dimensions and position
      async toHaveBoundingBox(expected: { x?: number; y?: number; width?: number; height?: number }, tolerance = 5, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const box = await locator.boundingBox();
          if (box) {
            const matches =
              (expected.x === undefined || Math.abs(box.x - expected.x) <= tolerance) &&
              (expected.y === undefined || Math.abs(box.y - expected.y) <= tolerance) &&
              (expected.width === undefined || Math.abs(box.width - expected.width) <= tolerance) &&
              (expected.height === undefined || Math.abs(box.height - expected.height) <= tolerance);
            if (matches) return;
          }
          await new Promise(r => setTimeout(r, 100));
        }
        const box = await locator.boundingBox();
        throw new Error(`Expected bounding box ${JSON.stringify(expected)} but got ${JSON.stringify(box)}`);
      },
      // CSS style assertion: verify computed style property
      async toHaveStyle(property: string, expected: string | RegExp, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const value = await locator.evaluate((el, prop) => {
            return window.getComputedStyle(el).getPropertyValue(prop);
          }, property);
          if (typeof expected === 'string' && value === expected) return;
          if (expected instanceof RegExp && expected.test(value)) return;
          await new Promise(r => setTimeout(r, 100));
        }
        const actual = await locator.evaluate((el, prop) => {
          return window.getComputedStyle(el).getPropertyValue(prop);
        }, property);
        throw new Error(`Expected style "${property}" to be "${expected}" but got "${actual}"`);
      },
      // Transform assertion: verify CSS transform matrix
      async toHaveTransform(expected?: string | RegExp, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const value = await locator.evaluate((el) => {
            return window.getComputedStyle(el).transform;
          });
          // If no expected value, just check that transform is not 'none'
          if (expected === undefined && value !== 'none') return;
          if (typeof expected === 'string' && value === expected) return;
          if (expected instanceof RegExp && expected.test(value)) return;
          await new Promise(r => setTimeout(r, 100));
        }
        const actual = await locator.evaluate((el) => {
          return window.getComputedStyle(el).transform;
        });
        throw new Error(`Expected transform "${expected ?? 'not none'}" but got "${actual}"`);
      },
      // Add 'not' modifier for negative assertions
      not: {
        async toBeVisible(options?: { timeout?: number }) {
          await locator.waitFor({ state: 'hidden', timeout: options?.timeout ?? timeout });
        },
        async toBeHidden(options?: { timeout?: number }) {
          await locator.waitFor({ state: 'visible', timeout: options?.timeout ?? timeout });
        },
        async toHaveText(expected: string | RegExp, options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            const text = await locator.textContent();
            if (typeof expected === 'string' && text !== expected) return;
            if (expected instanceof RegExp && (!text || !expected.test(text))) return;
            await new Promise(r => setTimeout(r, 100));
          }
          throw new Error(`Expected text not to be "${expected}"`);
        },
        async toBeEnabled(options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            if (await locator.isDisabled()) return;
            await new Promise(r => setTimeout(r, 100));
          }
          throw new Error('Expected element not to be enabled');
        },
        async toBeChecked(options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            if (!(await locator.isChecked())) return;
            await new Promise(r => setTimeout(r, 100));
          }
          throw new Error('Expected element not to be checked');
        },
      },
    };
  };
}
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
      // Include 'expect' for Playwright Inspector-generated tests that use assertions
      // Include 'appState' for internal state inspection (Excalidraw undo/redo, etc.)
      const expectFn = createExpect(this.getActionTimeout());
      const appStateFn = createAppState(page);
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const testFn = new AsyncFunction('page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'appState', body);
      await testFn(page, baseUrl, screenshotPath, stepLogger, expectFn, appStateFn);
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
