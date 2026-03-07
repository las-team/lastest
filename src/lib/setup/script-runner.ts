import type { Page, Locator } from 'playwright';
import type { SetupScript, SetupContext, SetupResult } from './types';

/**
 * Simple expect implementation for setup scripts.
 * Provides common assertion matchers.
 */
function createExpect(timeout = 5000) {
  return function expect(target: Page | Locator) {
    const isPage = typeof (target as unknown as { goto?: unknown }).goto === 'function';

    if (isPage) {
      const page = target as Page;
      return {
        async toHaveURL(expected: string | RegExp, options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            const url = page.url();
            if (typeof expected === 'string' ? url === expected : expected.test(url)) {
              return;
            }
            await new Promise(r => setTimeout(r, 100));
          }
          throw new Error(`Expected URL to match ${expected}, but got ${page.url()}`);
        },
        async toHaveTitle(expected: string | RegExp, options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            const title = await page.title();
            if (typeof expected === 'string' ? title === expected : expected.test(title)) {
              return;
            }
            await new Promise(r => setTimeout(r, 100));
          }
          const title = await page.title();
          throw new Error(`Expected title to match ${expected}, but got ${title}`);
        },
      };
    }

    const locator = target as Locator;
    return {
      async toBeVisible(options?: { timeout?: number }) {
        await locator.waitFor({ state: 'visible', timeout: options?.timeout ?? timeout });
      },
      async toBeHidden(options?: { timeout?: number }) {
        await locator.waitFor({ state: 'hidden', timeout: options?.timeout ?? timeout });
      },
      async toHaveText(expected: string | RegExp, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const text = await locator.textContent();
          if (typeof expected === 'string' ? text === expected : expected.test(text || '')) {
            return;
          }
          await new Promise(r => setTimeout(r, 100));
        }
        const text = await locator.textContent();
        throw new Error(`Expected text to match ${expected}, but got ${text}`);
      },
      async toContainText(expected: string, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const text = await locator.textContent();
          if (text?.includes(expected)) {
            return;
          }
          await new Promise(r => setTimeout(r, 100));
        }
        const text = await locator.textContent();
        throw new Error(`Expected text to contain "${expected}", but got "${text}"`);
      },
      async toHaveValue(expected: string, options?: { timeout?: number }) {
        const t = options?.timeout ?? timeout;
        const start = Date.now();
        while (Date.now() - start < t) {
          const value = await locator.inputValue();
          if (value === expected) {
            return;
          }
          await new Promise(r => setTimeout(r, 100));
        }
        const value = await locator.inputValue();
        throw new Error(`Expected value "${expected}", but got "${value}"`);
      },
    };
  };
}

/**
 * Create appState helper for internal state inspection (stub for setup)
 */
function createAppState(page: Page) {
  return {
    get: async (path: string): Promise<unknown> => {
      return page.evaluate((p) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const state = (window as any).__APP_STATE__ ||
                      (window as any).store?.getState?.() ||
                      (window as any).__EXCALIDRAW_STATE__ ||
                      (window as any).app?.state;
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (!state) return undefined;
        return p.split('.').reduce((obj: Record<string, unknown>, key: string) => obj?.[key] as Record<string, unknown>, state);
      }, path);
    },
    getHistoryLength: async (): Promise<number> => -1,
    getAll: async (): Promise<unknown> => null,
    evaluate: async <T>(accessor: string): Promise<T> => {
      return page.evaluate((fn) => {
        const func = new Function('window', `return ${fn}`);
        return func(window);
      }, accessor);
    },
  };
}

/**
 * Create a simple locateWithFallback function for setup scripts
 */
function createLocateWithFallback(_page: Page) {
  return async (
    pg: Page,
    selectors: { type: string; value: string }[],
    action: string,
    value?: string | null,
    coords?: { x: number; y: number } | null
  ) => {
    const validSelectors = selectors.filter(s => s.value && s.value.trim() && !s.value.includes('undefined'));

    for (const sel of validSelectors) {
      try {
        let locator: Locator;
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
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return;
      } catch {
        continue;
      }
    }
    // Coordinate fallback
    if (action === 'click' && coords) {
      await pg.mouse.click(coords.x, coords.y);
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  };
}

/**
 * Run a Playwright setup script.
 * Similar to test runner but:
 * - Does NOT capture screenshots
 * - Returns variables that can be passed to tests
 * - Browser state is preserved for subsequent tests
 */
export async function runPlaywrightSetup(
  page: Page,
  script: SetupScript,
  context: SetupContext
): Promise<SetupResult> {
  const startTime = Date.now();

  try {
    if (script.type !== 'playwright') {
      return {
        success: false,
        error: `Expected playwright script but got ${script.type}`,
        duration: Date.now() - startTime,
      };
    }

    const code = script.code;
    if (!code) {
      return {
        success: false,
        error: 'No setup code',
        duration: Date.now() - startTime,
      };
    }

    // Execute the setup code
    const extractedVariables = await executeSetupCode(page, code, context, false);

    return {
      success: true,
      variables: extractedVariables,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Run a test as setup (reuse existing test code but skip screenshots)
 */
export async function runTestAsSetup(
  page: Page,
  testCode: string,
  context: SetupContext
): Promise<SetupResult> {
  const startTime = Date.now();

  try {
    if (!testCode) {
      return {
        success: false,
        error: 'No test code',
        duration: Date.now() - startTime,
      };
    }

    // Execute the test code but intercept screenshot calls
    const extractedVariables = await executeSetupCode(page, testCode, context, true);

    return {
      success: true,
      variables: extractedVariables,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Execute setup code and extract variables
 */
async function executeSetupCode(
  page: Page,
  code: string,
  context: SetupContext,
  _isTestAsSetup = false
): Promise<Record<string, unknown>> {
  // Strip TypeScript type annotations
  const processedCode = stripTypeAnnotations(code);

  // Check for setup function format
  const setupMatch = processedCode.match(
    /export\s+async\s+function\s+setup\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
  );

  // Also support test function format (when using test as setup)
  const testMatch = processedCode.match(
    /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
  );

  const funcMatch = setupMatch || testMatch;

  if (funcMatch) {
    let body = funcMatch[1];

    // Create page proxy that handles screenshots and relative URLs
    const pageProxy = createSetupPageProxy(page, context.baseUrl);

    // Create helper functions that tests expect
    const expectFn = createExpect(5000);
    const appStateFn = createAppState(page);
    const locateWithFallbackFn = createLocateWithFallback(page);

    // Create a stepLogger that logs to console for debugging
    const stepLogger = {
      log: (msg: string) => {
        console.log(`[Setup] ${msg}`);
      },
    };

    // Create a dummy screenshot path (won't be used since we skip screenshots)
    const screenshotPath = '/tmp/setup-screenshot.png';

    // Remove the test's local locateWithFallback function declaration so the parameter is used
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

    // Fix legacy page.keyboard.selectAll() → keyboard.press('Control+a')
    body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

    // File upload helper — always available (mirrors runner.ts)
    const fileUploadHelper = async (selector: string, filePaths: string | string[]) => {
      const locator = page.locator(selector);
      await locator.setInputFiles(Array.isArray(filePaths) ? filePaths : [filePaths]);
    };

    // Clipboard helper — stub (setup runs without clipboard permissions by default)
    const clipboardHelper = null;

    // Downloads helper — stub (setup skips downloads by default)
    const downloadsHelper = null;

    // Network helper — stub (setup skips network interception by default)
    const networkHelper = null;

    // Build and execute the function with all expected parameters
    // Must match the runner's 11-parameter signature so test-as-setup works
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const setupFn = new AsyncFunction(
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
      body
    );

    const result = await setupFn(
      pageProxy,
      context.baseUrl,
      screenshotPath,
      stepLogger,
      expectFn,
      appStateFn,
      locateWithFallbackFn,
      fileUploadHelper,
      clipboardHelper,
      downloadsHelper,
      networkHelper
    );

    // If the setup returns an object, treat it as extracted variables
    if (result && typeof result === 'object') {
      return result;
    }

    return {};
  }

  // Try to execute as raw commands (legacy format)
  const lines = processedCode.split('\n').filter(line =>
    line.trim().startsWith('await page.')
  );

  const pageProxy = createSetupPageProxy(page, context.baseUrl);

  for (const line of lines) {
    await executeLine(pageProxy, line.trim(), context.baseUrl);
  }

  return {};
}

/**
 * Create a proxy that intercepts screenshot calls and handles relative URLs
 */
function createSetupPageProxy(page: Page, baseUrl: string): Page {
  return new Proxy(page, {
    get: (target, prop) => {
      if (prop === 'screenshot') {
        // Return a no-op function for screenshots
        return async () => Buffer.alloc(0);
      }
      if (prop === 'goto') {
        // Intercept goto to handle relative URLs
        return async (url: string | URL, options?: Parameters<Page['goto']>[1]) => {
          const urlStr = typeof url === 'string' ? url : url.toString();
          let resolvedUrl = urlStr;
          // Handle relative URLs
          if (urlStr.startsWith('/')) {
            resolvedUrl = `${baseUrl.replace(/\/$/, '')}${urlStr}`;
          } else if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
            resolvedUrl = `${baseUrl.replace(/\/$/, '')}/${urlStr}`;
          }
          return target.goto(resolvedUrl, options);
        };
      }
      if (prop === 'waitForURL') {
        // Wrap predicates so scripts using url.includes() work
        // (Playwright passes a URL object, not a string)
        return (predicate: string | RegExp | ((url: URL) => boolean), options?: { timeout?: number }) => {
          if (typeof predicate === 'function') {
            const origFn = predicate;
            const wrappedFn = (url: URL) => {
              // Monkey-patch .includes on the URL object so legacy scripts work
              const patched = url as URL & { includes?: (s: string) => boolean };
              if (!patched.includes) {
                patched.includes = (s: string) => url.href.includes(s);
              }
              return origFn(url);
            };
            return target.waitForURL(wrappedFn, options);
          }
          return target.waitForURL(predicate, options);
        };
      }
      const value = target[prop as keyof Page];
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return value;
    }
  });
}

/**
 * Strip TypeScript type annotations from code
 */
function stripTypeAnnotations(code: string): string {
  let result = code;
  // Remove variable type annotations
  result = result.replace(
    /\b(const|let|var)\s+(\w+)\s*:\s*[^=\n;]+(\s*=)/g,
    '$1 $2$3'
  );
  // Remove type annotations on destructured assignments
  result = result.replace(
    /\b(const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*:\s*[^=\n;]+(\s*=)/g,
    '$1 $2$3'
  );
  // Remove `as Type` assertions
  result = result.replace(/\)\s+as\s+\w[\w<>\[\],\s|]*/g, ')');
  result = result.replace(/(\w)\s+as\s+\w[\w<>\[\],\s|]*/g, '$1');
  return result;
}

/**
 * Execute a single line of Playwright code
 */
async function executeLine(page: Page, line: string, baseUrl: string): Promise<void> {
  if (line.startsWith('await page.goto(')) {
    const urlMatch = line.match(/goto\(['"]([^'"]+)['"]\)/);
    if (urlMatch) {
      let url = urlMatch[1];
      // Handle relative URLs
      if (url.startsWith('/')) {
        url = `${baseUrl}${url}`;
      }
      await page.goto(url, { timeout: 30000 });
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
  } else if (line.startsWith('await page.fill(')) {
    const match = line.match(/fill\(['"]([^'"]+)['"],\s*['"]([^'"]*)['"]\)/);
    if (match) {
      await page.fill(match[1], match[2]);
    }
  } else if (line.startsWith('await page.click(')) {
    const match = line.match(/click\(['"]([^'"]+)['"]\)/);
    if (match) {
      await page.click(match[1]);
    }
  } else if (line.startsWith('await page.waitForSelector(')) {
    const match = line.match(/waitForSelector\(['"]([^'"]+)['"]\)/);
    if (match) {
      await page.waitForSelector(match[1]);
    }
  } else if (line.startsWith('await page.waitForTimeout(')) {
    const match = line.match(/waitForTimeout\((\d+)\)/);
    if (match) {
      await page.waitForTimeout(parseInt(match[1], 10));
    }
  }
  // Skip screenshot commands when running as setup
  // (they're already filtered by the proxy, but ignore them here too)
}
