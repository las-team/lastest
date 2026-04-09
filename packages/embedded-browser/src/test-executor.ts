/**
 * Test Executor for Embedded Browser
 *
 * Executes test code against the live shared page (no new browser launch).
 * Uses the same `new Function()` pattern as `packages/runner/src/runner.ts`
 * but adapted for the embedded context.
 *
 * Features mirrored from the standard runner:
 * - Stabilization (freeze timestamps/random/animations, wait for network idle/DOM/canvas)
 * - StorageState injection
 * - Timeout handling with context.close to kill in-flight ops
 * - Heartbeat logging
 * - RAF flush wrapping for actions
 * - locateWithFallback with { type, value } selectors, ocr-text, role-name, coordinate fallback
 * - Speed-aware replayCursorPath
 * - stepLogger with softExpect/softAction
 * - Robust stripTypeAnnotations
 * - Removal of test-local function definitions
 */

import type { Browser, Page } from 'playwright';
import type { StabilizationPayload } from './protocol.js';
import { setupFreezeScripts, applyPreScreenshotStabilization } from './stabilization.js';

export interface EmbeddedNetworkRequest {
  url: string;
  method: string;
  status: number;
  duration: number;
  resourceType: string;
  failed?: boolean;
  errorText?: string;
  startTime?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
  responseBody?: string;
  responseSize?: number;
}

export interface EmbeddedTestResult {
  status: 'passed' | 'failed' | 'error' | 'timeout' | 'cancelled';
  durationMs: number;
  error?: { message: string; stack?: string; screenshot?: string };
  logs: Array<{ timestamp: number; level: string; message: string }>;
  screenshots: Array<{ filename: string; data: string; width: number; height: number }>;
  consoleErrors?: string[];
  networkRequests?: EmbeddedNetworkRequest[];
  softErrors?: string[];
}

export interface EmbeddedSetupResult {
  status: 'passed' | 'failed' | 'error' | 'timeout';
  storageState?: string;
  variables?: Record<string, unknown>;
  durationMs: number;
  error?: string;
  logs: Array<{ timestamp: number; level: string; message: string }>;
}

export interface RunSetupPayload {
  setupId: string;
  code: string;
  codeHash: string;
  targetUrl: string;
  timeout?: number;
  viewport?: { width: number; height: number };
  stabilization?: StabilizationPayload;
  browser?: string;
}

export interface RunTestPayload {
  testId: string;
  testRunId: string;
  code: string;
  codeHash: string;
  targetUrl: string;
  timeout?: number;
  viewport?: { width: number; height: number };
  repositoryId?: string;
  storageState?: string;
  setupVariables?: Record<string, unknown>;
  cursorPlaybackSpeed?: number;
  stabilization?: StabilizationPayload;
  consoleErrorMode?: 'fail' | 'warn' | 'ignore';
  networkErrorMode?: 'fail' | 'warn' | 'ignore';
  ignoreExternalNetworkErrors?: boolean;
}

/**
 * Strip TypeScript type annotations from test code so it can run as plain JS.
 * Matches the runner's more robust version that handles destructured types,
 * `as` casts, and generic type params.
 */
function stripTypeAnnotations(code: string): string {
  let result = code;
  // Variable type annotations: const x: Type = / let x: Type =
  result = result.replace(/\b(const|let|var)\s+(\w+)\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
  // Destructured type annotations: const { a, b }: Type = / const [a, b]: Type =
  result = result.replace(/\b(const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
  // `as` casts: ) as Type / value as Type
  result = result.replace(/\)\s+as\s+\w[\w<>\[\],\s|]*/g, ')');
  result = result.replace(/(\w)\s+as\s+\w[\w<>\[\],\s|]*/g, '$1');
  // Generic type params: <Type>( / <Type>identifier
  result = result.replace(/<\w[\w<>\[\],\s|]*>\s*(?=\(|[\w])/g, '');
  return result;
}

/**
 * Remove a named async function definition from a code body by brace-matching.
 */
function removeFunctionDefinition(body: string, funcName: string): { body: string; removed: boolean } {
  const pattern = `async function ${funcName}`;
  if (!body.includes(pattern)) return { body, removed: false };

  const regex = new RegExp(`async function ${funcName}\\s*\\([^)]*\\)\\s*\\{`);
  const startMatch = body.match(regex);
  if (!startMatch || startMatch.index === undefined) return { body, removed: false };

  const startIdx = startMatch.index;
  const braceStart = body.indexOf('{', startIdx);
  let depth = 1;
  let endIdx = braceStart + 1;
  while (depth > 0 && endIdx < body.length) {
    if (body[endIdx] === '{') depth++;
    else if (body[endIdx] === '}') depth--;
    endIdx++;
  }
  return {
    body: body.slice(0, startIdx) + `/* ${funcName} provided by runner */` + body.slice(endIdx),
    removed: true,
  };
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

  async runTest(
    browser: Browser,
    command: RunTestPayload,
    callbacks?: {
      onPageCreated?: (page: Page) => Promise<void> | void;
      onBeforePageClose?: () => Promise<void> | void;
    },
  ): Promise<EmbeddedTestResult> {
    const abortCtrl = new AbortController();
    this.abortController = abortCtrl;

    const startTime = Date.now();
    const logs: Array<{ timestamp: number; level: string; message: string }> = [];
    const screenshots: Array<{ filename: string; data: string; width: number; height: number }> = [];
    const softErrors: string[] = [];
    const consoleErrors: string[] = [];
    let allNetworkRequests: EmbeddedNetworkRequest[] = [];
    const testTimeout = Math.max(command.timeout || 120000, 30000);

    const logFn = (level: string, message: string) => {
      logs.push({ timestamp: Date.now(), level, message });
      console.log(`  [${level.toUpperCase()}] [embedded:${command.testId}] ${message}`);
    };

    const viewport = command.viewport || { width: 1280, height: 720 };

    // Determine context options based on stabilization settings
    const needsStabilizedContext = command.stabilization?.crossOsConsistency || command.stabilization?.freezeAnimations;

    // Parse storageState if provided
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

    // Create a fresh context + page per test (mirrors standard runner)
    const testContext = await browser.newContext({
      viewport,
      ...(parsedStorageState ? { storageState: parsedStorageState } : {}),
      ...(needsStabilizedContext ? { deviceScaleFactor: 1 } : {}),
      ...(needsStabilizedContext ? { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' as const } : {}),
      ...(command.stabilization?.freezeAnimations ? { reducedMotion: 'reduce' as const } : {}),
    });
    const page = await testContext.newPage();
    if (callbacks?.onPageCreated) {
      await callbacks.onPageCreated(page);
    }

    try {
      if (abortCtrl.signal.aborted) {
        throw new Error('Test cancelled before starting');
      }

      // Set default timeouts (mirrors standard runner)
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      // Setup freeze scripts (timestamps, random, animations) BEFORE any navigation
      if (command.stabilization) {
        await setupFreezeScripts(page, command.stabilization);
        logFn('info', `Stabilization: freeze timestamps=${command.stabilization.freezeTimestamps}, random=${command.stabilization.freezeRandomValues}, animations=${command.stabilization.freezeAnimations}, crossOS=${command.stabilization.crossOsConsistency}`);
      }

      // Page event listeners — capture console errors and network requests
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          consoleErrors.push(text);
          logFn('warn', `Console error: ${text}`);
        }
      });
      page.on('pageerror', (err) => logFn('warn', `Page error: ${err.message}`));

      // Network request capture (all requests, not just failures)
      page.on('request', (req) => {
        allNetworkRequests.push({
          url: req.url(),
          method: req.method(),
          status: 0,
          duration: 0,
          resourceType: req.resourceType(),
          startTime: Date.now(),
          failed: false,
          requestHeaders: req.headers(),
          postData: req.postData() ?? undefined,
        });
        if (allNetworkRequests.length > 500) {
          allNetworkRequests = allNetworkRequests.slice(-500);
        }
      });
      page.on('response', (resp) => {
        const entry = allNetworkRequests.findLast(
          e => e.url === resp.url() && e.status === 0 && !e.failed
        );
        if (entry) {
          entry.status = resp.status();
          entry.duration = entry.startTime ? Date.now() - entry.startTime : 0;
          entry.responseHeaders = resp.headers();
          const contentLength = resp.headers()['content-length'];
          if (contentLength) entry.responseSize = parseInt(contentLength, 10);
          // Capture response body for API calls (fetch/xhr) — cap at 16KB
          const rt = entry.resourceType;
          if (rt === 'fetch' || rt === 'xhr' || rt === 'document') {
            resp.text().then(body => {
              entry.responseBody = body.length > 16384 ? body.slice(0, 16384) + '… (truncated)' : body;
              if (!entry.responseSize) entry.responseSize = body.length;
            }).catch(() => {});
          }
        }
      });
      page.on('requestfailed', (req) => {
        const entry = allNetworkRequests.findLast(
          e => e.url === req.url() && e.status === 0 && !e.failed
        );
        if (entry) {
          entry.failed = true;
          entry.errorText = req.failure()?.errorText;
          entry.duration = entry.startTime ? Date.now() - entry.startTime : 0;
        }
        logFn('warn', `Request failed: ${req.url()} ${req.failure()?.errorText ?? ''}`);
      });

      // Save raw screenshot method BEFORE overriding page.screenshot (prevents infinite recursion)
      const rawScreenshot = page.screenshot.bind(page);
      let screenshotStep = 1;

      // Screenshot helper with stabilization
      const captureScreenshot = async (label: string) => {
        try {
          // Apply pre-screenshot stabilization (network idle, images, fonts, DOM)
          await applyPreScreenshotStabilization(page, command.stabilization);
          const buffer = await rawScreenshot({ fullPage: true });
          const filename = `${command.testRunId}-${command.testId}-${label.replace(/ /g, '_')}.png`;
          const base64 = buffer.toString('base64');
          screenshots.push({ filename, data: base64, width: viewport.width, height: viewport.height });
          logFn('info', `Captured screenshot: ${filename}`);
          // Disable RAF gating + unfreeze performance.now after screenshot
          /* eslint-disable @typescript-eslint/no-explicit-any */
          await page.evaluate(() => {
            if (typeof (window as any).__disableRAFGating === 'function') {
              (window as any).__disableRAFGating();
            }
            (window as any).__perfNowFrozen = false;
          }).catch(() => {});
          /* eslint-enable @typescript-eslint/no-explicit-any */
        } catch (err) {
          logFn('warn', `Failed to capture screenshot: ${err}`);
        }
      };

      // Override page.screenshot to intercept screenshot calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (page as any).screenshot = async (options?: any) => {
        const label = `Step ${screenshotStep++}`;
        await captureScreenshot(label);
        return rawScreenshot(options);
      };

      // Intercept page.goto with logging + random seed reset
      const originalGoto = page.goto.bind(page);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (page as any).goto = async (url: string, options?: any) => {
        logFn('info', `Navigating to ${url}...`);
        const response = await originalGoto(url, options);
        logFn('info', `Navigation complete: ${response?.status() ?? 'no response'}`);
        // addInitScript already resets mathState on each navigation — no explicit reset needed
        return response;
      };

      // Extract function body
      const funcMatch = command.code.match(
        /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
      );

      let body: string;
      if (funcMatch) {
        body = stripTypeAnnotations(funcMatch[1]);
      } else {
        logFn('info', 'No export async function test(...) wrapper found — using code as body');
        body = stripTypeAnnotations(command.code);
      }
      logFn('info', `Extracted test body: ${body.length} chars`);

      // Remove test-local locateWithFallback (using runner-provided version)
      const lwfResult = removeFunctionDefinition(body, 'locateWithFallback');
      if (lwfResult.removed) {
        body = lwfResult.body;
        logFn('info', 'Removed test-local locateWithFallback (using runner-provided version)');
      }

      // Remove test-local replayCursorPath (using runner-provided speed-aware version)
      const rcpResult = removeFunctionDefinition(body, 'replayCursorPath');
      if (rcpResult.removed) {
        body = rcpResult.body;
        logFn('info', 'Removed test-local replayCursorPath (using runner-provided version)');
      }

      // Patch selectAll (mirrors runner.ts)
      body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

      // Soft error wrapping — skip screenshot lines (mirrors runner.ts)
      body = body.replace(/^(\s*)(await\s+.+;)\s*$/gm, (_match, indent, stmt) => {
        if (stmt.includes('.screenshot(')) return `${indent}${stmt}`;
        return `${indent}try { ${stmt} } catch(__softErr) { if (__softErr && __softErr.__hardAssertion) throw __softErr; stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
      });

      // Step logger with softExpect/softAction (matches runner)
      const stepLogger = {
        log: (msg: string) => logFn('info', `Step: ${msg}`),
        warn: (msg: string) => {
          softErrors.push(msg);
          logFn('warn', `[WARN] ${msg}`);
        },
        error: (msg: string) => logFn('error', `Step error: ${msg}`),
        softExpect: async (fn: () => Promise<void>, label?: string) => {
          try {
            await fn();
          } catch (e: unknown) {
            const msg = label || (e instanceof Error ? e.message : String(e));
            softErrors.push(msg);
            logFn('warn', `[SOFT FAIL] ${msg}`);
          }
        },
        softAction: async (fn: () => Promise<void>, label?: string) => {
          try {
            await fn();
          } catch (e: unknown) {
            const msg = label || (e instanceof Error ? e.message : String(e));
            softErrors.push(msg);
            logFn('warn', `[SOFT FAIL] ${msg}`);
          }
        },
      };

      // Basic expect implementation (mirrors runner.ts createExpect)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // locateWithFallback — supports { type, value } format, ocr-text, role-name, coordinate fallback
      const locateWithFallback = async (
        pg: Page,
        selectors: Array<{ type: string; value: string } | string | { selector?: string; css?: string; text?: string }>,
        action: string,
        value?: string | null,
        coords?: { x: number; y: number } | null,
        options?: Record<string, unknown> | null
      ) => {
        // Normalize selectors to { type, value } format
        const validSelectors = selectors
          .map((sel) => {
            if (typeof sel === 'string') return { type: 'css', value: sel };
            if ('type' in sel && 'value' in sel) return sel as { type: string; value: string };
            // Legacy format: { selector, css, text }
            const legacy = sel as { selector?: string; css?: string; text?: string };
            return { type: 'css', value: legacy.selector || legacy.css || legacy.text || '' };
          })
          .filter((s) => s.value && s.value.trim() && !s.value.includes('undefined'));

        logFn('info', `[action] ${action}${value ? ` "${value}"` : ''} (${validSelectors.length} selectors)`);

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

            logFn('info', `[action] ${action} matched via ${sel.type}`);
            if (action === 'locate') return target;
            if (action === 'click') await target.click(options || {});
            else if (action === 'fill') await target.fill(value || '');
            else if (action === 'selectOption') await target.selectOption(value || '');
            else if (action === 'check') await target.check();
            else if (action === 'uncheck') await target.uncheck();

            return target;
          } catch {
            continue;
          }
        }

        // Coordinate fallback for clicks
        if (action === 'click' && coords) {
          logFn('info', `Falling back to coordinate click at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y, options || {});
          return;
        }

        // Coordinate fallback for fill - click to focus then type
        if (action === 'fill' && coords) {
          logFn('info', `Falling back to coordinate fill at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y);
          await pg.keyboard.press('Control+a');
          await pg.keyboard.type(value || '');
          return;
        }

        throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
      };

      // Speed-aware replayCursorPath — respects cursorPlaybackSpeed setting
      const speed = command.cursorPlaybackSpeed ?? 1;
      const replayCursorPathFn = async (pg: Page, moves: [number, number, number][]) => {
        for (const [x, y, delay] of moves) {
          await pg.mouse.move(x, y);
          if (delay > 0 && speed > 0) {
            await pg.waitForTimeout(Math.round(delay / speed));
          }
        }
      };

      logFn('info', 'Executing test code...');

      // Heartbeat timer — logs every 15s so the user knows the test is still running
      const heartbeatStart = Date.now();
      const heartbeat = setInterval(() => {
        const elapsed = Math.round((Date.now() - heartbeatStart) / 1000);
        logFn('info', `Test still running... (${elapsed}s elapsed)`);
      }, 15000);

      // Execute with timeout — close context to kill in-flight Playwright ops on timeout
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
            const testFn = new AsyncFunction(
              'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'locateWithFallback', 'replayCursorPath',
              body
            );
            await testFn(page, command.targetUrl.replace(/\/+$/, ''), 'screenshot.png', stepLogger, expect, locateWithFallback, replayCursorPathFn);
          })().then(r => { clearTimeout(timeoutTimer); return r; }),
          new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(() => {
              logFn('warn', `Timeout fired (${testTimeout}ms) — closing context to kill in-flight operations`);
              testContext.close().catch(() => {});
              reject(new Error(`Test execution timed out after ${testTimeout}ms`));
            }, testTimeout);
            abortCtrl.signal.addEventListener('abort', () => {
              clearTimeout(timeoutTimer);
              logFn('info', 'Abort signal received — closing context');
              testContext.close().catch(() => {});
              reject(new Error('Test cancelled'));
            });
          }),
        ]);
      } finally {
        clearTimeout(timeoutTimer);
        clearInterval(heartbeat);
      }

      logFn('info', 'Test code execution completed');

      // Check console/network error modes (mirrors runner.ts logic)
      const consoleErrorMode = command.consoleErrorMode || 'fail';
      const networkErrorMode = command.networkErrorMode || 'fail';
      const ignoreExternal = command.ignoreExternalNetworkErrors ?? false;
      let targetOrigin: string | undefined;
      try { targetOrigin = new URL(command.targetUrl).origin; } catch { /* ignore */ }
      const errorParts: string[] = [];

      if (consoleErrors.length > 0 && consoleErrorMode !== 'ignore') {
        const msg = `Console errors detected: ${consoleErrors.join('; ')}`;
        if (consoleErrorMode === 'warn') {
          logFn('warn', msg);
        } else {
          errorParts.push(msg);
        }
      }

      const networkFailures = allNetworkRequests.filter(r => {
        if (r.status < 400 && !r.failed) return false;
        if (ignoreExternal && targetOrigin) {
          try { if (new URL(r.url).origin !== targetOrigin) return false; } catch { /* keep */ }
        }
        return true;
      });
      if (networkFailures.length > 0 && networkErrorMode !== 'ignore') {
        const failureDetails = networkFailures.map(f => `${f.method} ${f.url} (${f.status})`).join('; ');
        const msg = `Network failures detected: ${failureDetails}`;
        if (networkErrorMode === 'warn') {
          logFn('warn', msg);
        } else {
          errorParts.push(msg);
        }
      }

      if (errorParts.length > 0) {
        throw new Error(errorParts.join(' | '));
      }

      // Take success screenshot if none captured
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
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
        networkRequests: allNetworkRequests.length > 0 ? allNetworkRequests : undefined,
        softErrors: softErrors.length > 0 ? softErrors : undefined,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const isCancelled = errorMessage.includes('cancelled') || abortCtrl.signal.aborted;

      if (isCancelled) {
        logFn('info', 'Test cancelled');
        return {
          status: 'cancelled', durationMs, logs, screenshots,
          consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
          networkRequests: allNetworkRequests.length > 0 ? allNetworkRequests : undefined,
          softErrors: softErrors.length > 0 ? softErrors : undefined,
        };
      }

      const isTimeout = errorMessage.includes('timed out');
      logFn('error', `Test ${isTimeout ? 'timed out' : 'failed'}: ${errorMessage}`);

      // Try to capture error screenshot (skip on timeout — context is closed)
      let errorScreenshot: string | undefined;
      if (!isTimeout) {
        try {
          const buffer = await page.screenshot();
          errorScreenshot = buffer.toString('base64');
        } catch { /* ignore */ }
      }

      return {
        status: isTimeout ? 'timeout' : 'failed',
        durationMs,
        error: { message: errorMessage, stack: errorStack, screenshot: errorScreenshot },
        logs,
        screenshots,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
        networkRequests: allNetworkRequests.length > 0 ? allNetworkRequests : undefined,
        softErrors: softErrors.length > 0 ? softErrors : undefined,
      };
    } finally {
      this.abortController = null;
      // Stop screencast before closing page so CDP session doesn't die unexpectedly
      if (callbacks?.onBeforePageClose) {
        try { await callbacks.onBeforePageClose(); } catch { /* ignore */ }
      }
      // Close the per-test page + context (no state leaks between tests)
      // context.close() may have already been called by timeout/cancel handler — that's fine
      await page.close().catch(() => {});
      await testContext.close().catch(() => {});
    }
  }

  async runSetup(browser: Browser, command: RunSetupPayload): Promise<EmbeddedSetupResult> {
    const startTime = Date.now();
    const logs: Array<{ timestamp: number; level: string; message: string }> = [];
    const setupTimeout = Math.max(command.timeout || 120000, 30000);

    const logFn = (level: string, message: string) => {
      logs.push({ timestamp: Date.now(), level, message });
      console.log(`  [${level.toUpperCase()}] [setup:${command.setupId}] ${message}`);
    };

    const viewport = command.viewport || { width: 1280, height: 720 };
    const needsStabilizedContext = command.stabilization?.crossOsConsistency || command.stabilization?.freezeAnimations;

    // No storageState injection — this IS the setup that creates the session
    const setupContext = await browser.newContext({
      viewport,
      ...(needsStabilizedContext ? { deviceScaleFactor: 1 } : {}),
      ...(needsStabilizedContext ? { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' as const } : {}),
      ...(command.stabilization?.freezeAnimations ? { reducedMotion: 'reduce' as const } : {}),
    });
    const page = await setupContext.newPage();

    try {
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      // Setup freeze scripts BEFORE navigation
      if (command.stabilization) {
        await setupFreezeScripts(page, command.stabilization);
        logFn('info', `Stabilization applied`);
      }

      // Extract function body (same pattern as runTest)
      const funcMatch = command.code.match(
        /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
      );

      let body: string;
      if (funcMatch) {
        body = stripTypeAnnotations(funcMatch[1]);
      } else {
        body = stripTypeAnnotations(command.code);
      }

      // Remove test-local function definitions
      const lwfResult = removeFunctionDefinition(body, 'locateWithFallback');
      if (lwfResult.removed) body = lwfResult.body;
      const rcpResult = removeFunctionDefinition(body, 'replayCursorPath');
      if (rcpResult.removed) body = rcpResult.body;

      // Patch selectAll
      body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

      // Noop screenshot/stepLogger for setup
      const _noopScreenshot = async () => {};
      const stepLogger = {
        log: (msg: string) => logFn('info', `Step: ${msg}`),
        warn: (msg: string) => logFn('warn', `[WARN] ${msg}`),
        error: (msg: string) => logFn('error', `Step error: ${msg}`),
        softExpect: async (fn: () => Promise<void>) => { try { await fn(); } catch { /* soft */ } },
        softAction: async (fn: () => Promise<void>) => { try { await fn(); } catch { /* soft */ } },
      };

      // Create helpers matching the test execution path so setup code can use them
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expect = (target: any, message?: string) => {
        const msgPrefix = message ? `${message}: ` : '';
        const isPage = typeof target?.goto === 'function';
        const isLocator = typeof target?.click === 'function' && typeof target?.fill === 'function';
        if (isPage) {
          return {
            async toHaveTitle(expected: string | RegExp) { const title = await target.title(); const regex = typeof expected === 'string' ? new RegExp(expected) : expected; if (!regex.test(title)) throw new Error(`${msgPrefix}Expected title "${title}" to match ${regex}`); },
            async toHaveURL(expected: string | RegExp) { const url = target.url(); const regex = typeof expected === 'string' ? new RegExp(expected) : expected; if (!regex.test(url)) throw new Error(`${msgPrefix}Expected URL "${url}" to match ${regex}`); },
          };
        }
        if (isLocator) {
          return {
            async toBeVisible() { if (!await target.isVisible()) throw new Error(`${msgPrefix}Expected element to be visible`); },
            async toBeHidden() { if (await target.isVisible()) throw new Error(`${msgPrefix}Expected element to be hidden`); },
            async toHaveText(expected: string | RegExp) { const text = await target.textContent() || ''; const regex = typeof expected === 'string' ? new RegExp(expected) : expected; if (!regex.test(text)) throw new Error(`${msgPrefix}Expected text "${text}" to match ${regex}`); },
            async toContainText(expected: string) { const text = await target.textContent() || ''; if (!text.includes(expected)) throw new Error(`${msgPrefix}Expected text to contain "${expected}"`); },
            not: { async toBeVisible() { if (await target.isVisible()) throw new Error(`${msgPrefix}Expected element not to be visible`); } },
          };
        }
        return {
          toBe(expected: unknown) { if (target !== expected) throw new Error(`${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`); },
          toBeTruthy() { if (!target) throw new Error(`${msgPrefix}Expected value to be truthy but got ${target}`); },
          not: { toBe(expected: unknown) { if (target === expected) throw new Error(`${msgPrefix}Expected not to be ${JSON.stringify(expected)}`); } },
        };
      };

      const locateWithFallback = async (
        pg: Page,
        selectors: Array<{ type: string; value: string } | string | { selector?: string; css?: string; text?: string }>,
        action: string,
        value?: string | null,
        coords?: { x: number; y: number } | null,
        options?: Record<string, unknown> | null
      ) => {
        const validSelectors = selectors
          .map((sel) => {
            if (typeof sel === 'string') return { type: 'css', value: sel };
            if ('type' in sel && 'value' in sel) return sel as { type: string; value: string };
            const legacy = sel as { selector?: string; css?: string; text?: string };
            return { type: 'css', value: legacy.selector || legacy.css || legacy.text || '' };
          })
          .filter((s) => s.value && s.value.trim() && !s.value.includes('undefined'));

        logFn('info', `[setup action] ${action}${value ? ` "${value}"` : ''} (${validSelectors.length} selectors)`);

        for (const sel of validSelectors) {
          try {
            let locator;
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
            logFn('info', `[setup action] ${action} matched via ${sel.type}`);
            if (action === 'locate') return target;
            if (action === 'click') await target.click(options || {});
            else if (action === 'fill') await target.fill(value || '');
            else if (action === 'selectOption') await target.selectOption(value || '');
            else if (action === 'check') await target.check();
            else if (action === 'uncheck') await target.uncheck();
            return target;
          } catch {
            continue;
          }
        }
        if (action === 'click' && coords) {
          logFn('info', `Falling back to coordinate click at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y, options || {});
          return;
        }
        if (action === 'fill' && coords) {
          logFn('info', `Falling back to coordinate fill at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y);
          await pg.keyboard.press('Control+a');
          await pg.keyboard.type(value || '');
          return;
        }
        throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
      };

      const replayCursorPathFn = async (_pg: Page, moves: [number, number, number][]) => {
        for (const [x, y, delay] of moves) {
          await page.mouse.move(x, y);
          if (delay > 0) await page.waitForTimeout(delay);
        }
      };

      logFn('info', 'Executing setup code...');

      // Execute with timeout
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        (async () => {
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          const setupFn = new AsyncFunction(
            'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'appState', 'locateWithFallback', 'replayCursorPath',
            body
          );
          await setupFn(page, command.targetUrl.replace(/\/+$/, ''), 'screenshot.png', stepLogger, expect, null, locateWithFallback, replayCursorPathFn);
        })().then(r => { clearTimeout(timeoutTimer); return r; }),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            logFn('warn', `Setup timeout fired (${setupTimeout}ms)`);
            setupContext.close().catch(() => {});
            reject(new Error(`Setup timed out after ${setupTimeout}ms`));
          }, setupTimeout);
        }),
      ]);

      logFn('info', 'Setup code executed successfully');

      // Wait for post-setup navigation (e.g., login redirect)
      const setupPageUrl = page.url();
      try {
        await page.waitForURL(
          (url: URL) => url.toString() !== setupPageUrl,
          { timeout: 10000, waitUntil: 'networkidle' }
        );
        logFn('info', `Post-setup navigation: ${setupPageUrl} → ${page.url()}`);
      } catch {
        logFn('info', 'No post-setup navigation detected (URL unchanged)');
      }

      // Poll for session cookies
      try {
        const ctx = page.context();
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const cookies = await ctx.cookies();
          const hasSession = cookies.some(c =>
            c.name.includes('session') || c.name.includes('auth') || c.name.includes('token')
          );
          if (hasSession) {
            logFn('info', `Session cookie found after setup (${cookies.length} total cookies)`);
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        }
      } catch {
        // Cookie polling failed — continue anyway
      }

      // Capture storageState
      let storageState: string | undefined;
      try {
        const state = await setupContext.storageState();
        storageState = JSON.stringify(state);
        logFn('info', `Captured storageState: ${state.cookies.length} cookies, ${state.origins.length} origins`);
      } catch (e) {
        logFn('warn', `Failed to capture storageState: ${e}`);
      }

      return {
        status: 'passed',
        storageState,
        durationMs: Date.now() - startTime,
        logs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('timed out');
      logFn('error', `Setup ${isTimeout ? 'timed out' : 'failed'}: ${errorMessage}`);

      return {
        status: isTimeout ? 'timeout' : 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        logs,
      };
    } finally {
      await page.close().catch(() => {});
      await setupContext.close().catch(() => {});
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
