/**
 * Standalone setup code executor for the embedded browser.
 *
 * Mirrors the logic in src/lib/setup/script-runner.ts but is fully
 * self-contained so the embedded-browser package has no cross-package imports.
 */

import type { Page, Locator } from 'playwright';

// ---------------------------------------------------------------------------
// Strip TypeScript annotations
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Page proxy – intercepts screenshots + handles relative URLs
// ---------------------------------------------------------------------------

function createSetupPageProxy(page: Page, baseUrl: string): Page {
  return new Proxy(page, {
    get: (target, prop) => {
      if (prop === 'screenshot') {
        return async () => Buffer.alloc(0);
      }
      if (prop === 'goto') {
        return async (url: string, options?: Parameters<Page['goto']>[1]) => {
          let resolvedUrl = url;
          if (url.startsWith('/')) {
            resolvedUrl = `${baseUrl.replace(/\/$/, '')}${url}`;
          } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
            resolvedUrl = `${baseUrl.replace(/\/$/, '')}/${url}`;
          }
          return target.goto(resolvedUrl, options);
        };
      }
      const value = target[prop as keyof Page];
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return value;
    },
  });
}

// ---------------------------------------------------------------------------
// Simple expect implementation
// ---------------------------------------------------------------------------

function createExpect(timeout = 5000) {
  return function expect(target: Page | Locator) {
    const isPage = typeof (target as unknown as { goto?: unknown }).goto === 'function';

    if (isPage) {
      const pg = target as Page;
      return {
        async toHaveURL(expected: string | RegExp, options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            const url = pg.url();
            if (typeof expected === 'string' ? url === expected : expected.test(url)) return;
            await new Promise(r => setTimeout(r, 100));
          }
          throw new Error(`Expected URL to match ${expected}, but got ${pg.url()}`);
        },
        async toHaveTitle(expected: string | RegExp, options?: { timeout?: number }) {
          const t = options?.timeout ?? timeout;
          const start = Date.now();
          while (Date.now() - start < t) {
            const title = await pg.title();
            if (typeof expected === 'string' ? title === expected : expected.test(title)) return;
            await new Promise(r => setTimeout(r, 100));
          }
          const title = await pg.title();
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
          if (typeof expected === 'string' ? text === expected : expected.test(text || '')) return;
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
          if (text?.includes(expected)) return;
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
          if (value === expected) return;
          await new Promise(r => setTimeout(r, 100));
        }
        const value = await locator.inputValue();
        throw new Error(`Expected value "${expected}", but got "${value}"`);
      },
    };
  };
}

// ---------------------------------------------------------------------------
// appState helper (stub)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// locateWithFallback
// ---------------------------------------------------------------------------

function createLocateWithFallback() {
  return async (
    pg: Page,
    selectors: { type: string; value: string }[],
    action: string,
    value?: string | null,
    coords?: { x: number; y: number } | null,
  ) => {
    const valid = selectors.filter(s => s.value && s.value.trim() && !s.value.includes('undefined'));

    for (const sel of valid) {
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
    if (action === 'click' && coords) {
      await pg.mouse.click(coords.x, coords.y);
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(valid));
  };
}

// ---------------------------------------------------------------------------
// Legacy line executor
// ---------------------------------------------------------------------------

async function executeLine(page: Page, line: string, baseUrl: string): Promise<void> {
  if (line.startsWith('await page.goto(')) {
    const urlMatch = line.match(/goto\(['"]([^'"]+)['"]\)/);
    if (urlMatch) {
      let url = urlMatch[1];
      if (url.startsWith('/')) url = `${baseUrl}${url}`;
      await page.goto(url, { timeout: 30000 });
    }
  } else if (line.startsWith('await page.locator(')) {
    const locatorMatch = line.match(/locator\(['"]([^'"]+)['"]\)/);
    const actionMatch = line.match(/\.(click|fill|selectOption)\(['"]?([^'")]*)?['"]?\)/);
    if (locatorMatch && actionMatch) {
      const selector = locatorMatch[1];
      const action = actionMatch[1];
      const value = actionMatch[2];
      const loc = page.locator(selector);
      if (action === 'click') await loc.click();
      else if (action === 'fill') await loc.fill(value || '');
      else if (action === 'selectOption') await loc.selectOption(value || '');
    }
  } else if (line.startsWith('await page.fill(')) {
    const match = line.match(/fill\(['"]([^'"]+)['"],\s*['"]([^'"]*)['"]\)/);
    if (match) await page.fill(match[1], match[2]);
  } else if (line.startsWith('await page.click(')) {
    const match = line.match(/click\(['"]([^'"]+)['"]\)/);
    if (match) await page.click(match[1]);
  } else if (line.startsWith('await page.waitForSelector(')) {
    const match = line.match(/waitForSelector\(['"]([^'"]+)['"]\)/);
    if (match) await page.waitForSelector(match[1]);
  } else if (line.startsWith('await page.waitForTimeout(')) {
    const match = line.match(/waitForTimeout\((\d+)\)/);
    if (match) await page.waitForTimeout(parseInt(match[1], 10));
  }
}

// ---------------------------------------------------------------------------
// Main: executeSetupCode
// ---------------------------------------------------------------------------

export async function executeSetupCode(
  page: Page,
  code: string,
  baseUrl: string,
): Promise<Record<string, unknown>> {
  const processedCode = stripTypeAnnotations(code);

  // Match export async function setup(...) or test(...)
  const setupMatch = processedCode.match(
    /export\s+async\s+function\s+setup\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/,
  );
  const testMatch = processedCode.match(
    /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/,
  );
  const funcMatch = setupMatch || testMatch;

  if (funcMatch) {
    let body = funcMatch[1];

    const pageProxy = createSetupPageProxy(page, baseUrl);
    const expectFn = createExpect(5000);
    const appStateFn = createAppState(page);
    const locateWithFallbackFn = createLocateWithFallback();

    const stepLogger = {
      log: (msg: string) => console.log(`[Setup] ${msg}`),
      error: (msg: string) => console.error(`[Setup] ${msg}`),
    };
    const screenshotPath = '/tmp/setup-screenshot.png';

    // Remove local locateWithFallback declarations so the parameter is used
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

    // Fix legacy page.keyboard.selectAll()
    body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

    // File upload helper
    const fileUploadHelper = async (selector: string, filePaths: string | string[]) => {
      const locator = page.locator(selector);
      await locator.setInputFiles(Array.isArray(filePaths) ? filePaths : [filePaths]);
    };

    // Stubs
    const clipboardHelper = null;
    const downloadsHelper = null;
    const networkHelper = null;

    // Build async function with 11-parameter signature matching the runner
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
      body,
    );

    const result = await setupFn(
      pageProxy,
      baseUrl,
      screenshotPath,
      stepLogger,
      expectFn,
      appStateFn,
      locateWithFallbackFn,
      fileUploadHelper,
      clipboardHelper,
      downloadsHelper,
      networkHelper,
    );

    if (result && typeof result === 'object') {
      return result;
    }
    return {};
  }

  // Legacy format: raw `await page.*` lines
  const lines = processedCode.split('\n').filter(line => line.trim().startsWith('await page.'));
  const pageProxy = createSetupPageProxy(page, baseUrl);
  for (const line of lines) {
    await executeLine(pageProxy, line.trim(), baseUrl);
  }
  return {};
}
