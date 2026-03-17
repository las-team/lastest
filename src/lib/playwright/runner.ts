import { chromium, firefox, webkit, Browser, Page, BrowserContext, Locator } from 'playwright';
import { FREEZE_ANIMATIONS_CSS, FREEZE_ANIMATIONS_SCRIPT, CROSS_OS_CHROMIUM_ARGS } from './constants';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import AxeBuilder from '@axe-core/playwright';
import { DEFAULT_SELECTOR_PRIORITY, DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';
import type { A11yViolation, StabilizationSettings, StabilityMetadata } from '@/lib/db/schema';
import { getSelectorStats, recordSelectorSuccess, recordSelectorFailure, getDefaultSetupSteps, getTestFixtures } from '@/lib/db/queries';
import { setupFreezeScripts, setupThirdPartyBlocking, applyStabilization } from './stabilization';
import { captureWithBurst } from './burst-capture';
import { applyDynamicMasking } from './dynamic-masking';
import { STORAGE_DIRS, toRelativePath } from '@/lib/storage/paths';

/**
 * Create appState helper for internal state inspection.
 * Allows tests to access app state like undo/redo stack length, Redux store, etc.
 * Requires target app to expose state on window (e.g., window.__APP_STATE__).
 */
export function createAppState(page: Page) {
  return {
    /**
     * Get a value from the app's exposed state by dot-notation path.
     * Looks for state in common locations: window.__APP_STATE__, window.store, window.__EXCALIDRAW_STATE__
     * @param path - Dot-notation path like 'history.length' or 'selectedElements.0.id'
     */
    get: async (path: string): Promise<unknown> => {
      return page.evaluate((p) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const state = (window as any).__APP_STATE__ ||
                      (window as any).store?.getState?.() ||
                      (window as any).__EXCALIDRAW_STATE__ ||
                      (window as any).app?.state;
        /* eslint-enable @typescript-eslint/no-explicit-any */
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
        /* eslint-disable @typescript-eslint/no-explicit-any */
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
        /* eslint-enable @typescript-eslint/no-explicit-any */
        return state?.history?.length ?? -1;
      });
    },

    /**
     * Get the entire app state object.
     * Useful for debugging or complex assertions.
     */
    getAll: async (): Promise<unknown> => {
      return page.evaluate(() => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        return (window as any).__APP_STATE__ ||
               (window as any).store?.getState?.() ||
               (window as any).__EXCALIDRAW_STATE__ ||
               (window as any).app?.state ||
               null;
        /* eslint-enable @typescript-eslint/no-explicit-any */
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
 * Validate test code for dangerous patterns before execution.
 * Strips comments and string literals before scanning to reduce false positives.
 */
export function validateTestCode(code: string): void {
  const stripped = code
    .replace(/\/\/.*$/gm, '')           // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')   // multi-line comments
    .replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, '""'); // string literals

  const dangerous: [RegExp, string][] = [
    [/\brequire\s*\(/, 'require() is not allowed in test code'],
    [/\bimport\s*\(/, 'dynamic import() is not allowed in test code'],
    [/\bprocess\./, 'process access is not allowed in test code'],
    [/\bchild_process\b/, 'child_process is not allowed in test code'],
    [/\beval\s*\(/, 'eval() is not allowed in test code'],
    [/\bFunction\s*\(/, 'Function() constructor is not allowed in test code'],
    [/\bfs\.\w+/, 'fs module access is not allowed in test code'],
    [/\bglobal\./, 'global access is not allowed in test code'],
    [/\bglobalThis\./, 'globalThis access is not allowed in test code'],
    [/\b__dirname\b/, '__dirname is not allowed in test code'],
    [/\b__filename\b/, '__filename is not allowed in test code'],
    [/\bexecSync\b/, 'execSync is not allowed in test code'],
    [/\bspawnSync\b/, 'spawnSync is not allowed in test code'],
  ];

  for (const [pattern, message] of dangerous) {
    if (pattern.test(stripped)) {
      throw new Error(`Dangerous test code blocked: ${message}`);
    }
  }
}

/**
 * Wrap matcher objects so assertion failures push to softErrors instead of throwing.
 * Handles both sync and async matchers, and recursively wraps nested objects (e.g. `not`).
 */
function wrapMatchersForSoftErrors(matchers: Record<string, unknown>, softErrors: string[]): unknown {
  return new Proxy(matchers, {
    get(target, prop) {
      const value = target[prop as string];
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          try {
            const result = (value as (...a: unknown[]) => unknown)(...args);
            if (result && typeof (result as Promise<unknown>).then === 'function') {
              return (result as Promise<unknown>).catch((e: unknown) => {
                softErrors.push(e instanceof Error ? e.message : String(e));
              });
            }
            return result;
          } catch (e) {
            softErrors.push(e instanceof Error ? e.message : String(e));
          }
        };
      }
      if (typeof value === 'object' && value !== null) {
        return wrapMatchersForSoftErrors(value as Record<string, unknown>, softErrors);
      }
      return value;
    }
  });
}

/**
 * Simple expect implementation for Playwright Inspector-generated tests.
 * Provides common assertion matchers that wrap Playwright's built-in locator assertions.
 * Supports Page-level assertions (toHaveURL, toHaveTitle), Locator assertions,
 * and generic value assertions (toHaveLength, toBe, toEqual, etc.)
 *
 * When softErrors is provided, assertion failures are logged instead of thrown,
 * allowing test execution to continue past failed assertions.
 */
export function createExpect(timeout = 5000, softErrors?: string[]) {
  return function expect(target: unknown, message?: string) {
    // Check if target is a Page (has 'goto' method) vs Locator
    const isPage = typeof (target as { goto?: unknown })?.goto === 'function';
    const isLocator = typeof (target as { click?: unknown })?.click === 'function' &&
                      typeof (target as { fill?: unknown })?.fill === 'function';

    // Generic value matchers (arrays, primitives, objects)
    if (!isPage && !isLocator) {
      const msgPrefix = message ? `${message}: ` : '';
      const matchers = {
        toHaveLength(expected: number) {
          const actual = (target as { length?: number })?.length;
          if (actual !== expected) {
            const details = Array.isArray(target) ? `\nReceived: ${JSON.stringify(target.slice(0, 10))}` : '';
            throw new Error(`${msgPrefix}Expected length ${expected} but got ${actual}${details}`);
          }
        },
        toBe(expected: unknown) {
          if (target !== expected) {
            throw new Error(`${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`);
          }
        },
        toEqual(expected: unknown) {
          const isEqual = JSON.stringify(target) === JSON.stringify(expected);
          if (!isEqual) {
            throw new Error(`${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`);
          }
        },
        toBeTruthy() {
          if (!target) {
            throw new Error(`${msgPrefix}Expected value to be truthy but got ${target}`);
          }
        },
        toBeFalsy() {
          if (target) {
            throw new Error(`${msgPrefix}Expected value to be falsy but got ${target}`);
          }
        },
        toBeNull() {
          if (target !== null) {
            throw new Error(`${msgPrefix}Expected null but got ${JSON.stringify(target)}`);
          }
        },
        toBeUndefined() {
          if (target !== undefined) {
            throw new Error(`${msgPrefix}Expected undefined but got ${JSON.stringify(target)}`);
          }
        },
        toBeDefined() {
          if (target === undefined) {
            throw new Error(`${msgPrefix}Expected value to be defined`);
          }
        },
        toContain(expected: unknown) {
          if (Array.isArray(target)) {
            if (!target.includes(expected)) {
              throw new Error(`${msgPrefix}Expected array to contain ${JSON.stringify(expected)}`);
            }
          } else if (typeof target === 'string') {
            if (!target.includes(expected as string)) {
              throw new Error(`${msgPrefix}Expected string to contain "${expected}"`);
            }
          } else {
            throw new Error(`${msgPrefix}toContain only works on arrays and strings`);
          }
        },
        toBeGreaterThan(expected: number) {
          if (typeof target !== 'number' || target <= expected) {
            throw new Error(`${msgPrefix}Expected ${target} to be greater than ${expected}`);
          }
        },
        toBeLessThan(expected: number) {
          if (typeof target !== 'number' || target >= expected) {
            throw new Error(`${msgPrefix}Expected ${target} to be less than ${expected}`);
          }
        },
        toBeGreaterThanOrEqual(expected: number) {
          if (typeof target !== 'number' || target < expected) {
            throw new Error(`${msgPrefix}Expected ${target} to be greater than or equal to ${expected}`);
          }
        },
        toBeLessThanOrEqual(expected: number) {
          if (typeof target !== 'number' || target > expected) {
            throw new Error(`${msgPrefix}Expected ${target} to be less than or equal to ${expected}`);
          }
        },
        toMatch(expected: string | RegExp) {
          const str = typeof target === 'string' ? target : String(target);
          const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
          if (!regex.test(str)) {
            throw new Error(`${msgPrefix}Expected "${str}" to match ${regex}`);
          }
        },
        toMatchObject(expected: Record<string, unknown>) {
          if (typeof target !== 'object' || target === null) {
            throw new Error(`${msgPrefix}Expected an object but got ${typeof target}`);
          }
          for (const key of Object.keys(expected)) {
            const actualVal = (target as Record<string, unknown>)[key];
            const expectedVal = expected[key];
            if (JSON.stringify(actualVal) !== JSON.stringify(expectedVal)) {
              throw new Error(`${msgPrefix}Expected key "${key}" to be ${JSON.stringify(expectedVal)} but got ${JSON.stringify(actualVal)}`);
            }
          }
        },
        not: {
          toHaveLength(expected: number) {
            const actual = (target as { length?: number })?.length;
            if (actual === expected) {
              throw new Error(`${msgPrefix}Expected length not to be ${expected}`);
            }
          },
          toBe(expected: unknown) {
            if (target === expected) {
              throw new Error(`${msgPrefix}Expected not to be ${JSON.stringify(expected)}`);
            }
          },
          toEqual(expected: unknown) {
            const isEqual = JSON.stringify(target) === JSON.stringify(expected);
            if (isEqual) {
              throw new Error(`${msgPrefix}Expected not to equal ${JSON.stringify(expected)}`);
            }
          },
          toContain(expected: unknown) {
            if (Array.isArray(target) && target.includes(expected)) {
              throw new Error(`${msgPrefix}Expected array not to contain ${JSON.stringify(expected)}`);
            } else if (typeof target === 'string' && target.includes(expected as string)) {
              throw new Error(`${msgPrefix}Expected string not to contain "${expected}"`);
            }
          },
          toMatch(expected: string | RegExp) {
            const str = typeof target === 'string' ? target : String(target);
            const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
            if (regex.test(str)) {
              throw new Error(`${msgPrefix}Expected "${str}" not to match ${regex}`);
            }
          },
          toBeGreaterThanOrEqual(expected: number) {
            if (typeof target === 'number' && target >= expected) {
              throw new Error(`${msgPrefix}Expected ${target} not to be greater than or equal to ${expected}`);
            }
          },
          toBeLessThanOrEqual(expected: number) {
            if (typeof target === 'number' && target <= expected) {
              throw new Error(`${msgPrefix}Expected ${target} not to be less than or equal to ${expected}`);
            }
          },
        },
      };
      return softErrors ? wrapMatchersForSoftErrors(matchers as Record<string, unknown>, softErrors) : matchers;
    }

    if (isPage) {
      const page = target as Page;
      const matchers = {
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
      return softErrors ? wrapMatchersForSoftErrors(matchers as Record<string, unknown>, softErrors) : matchers;
    }

    // Locator matchers
    const locator = target as Locator;
    const matchers = {
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
    return softErrors ? wrapMatchersForSoftErrors(matchers as Record<string, unknown>, softErrors) : matchers;
  };
}
import type { Test, TestResult, ActionSelector, SelectorConfig, PlaywrightSettings, NetworkRequest, EnvironmentConfig } from '@/lib/db/schema';

/**
 * Strip TypeScript type annotations from code so it can execute as plain JavaScript.
 */
export function stripTypeAnnotations(code: string): string {
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
import { getServerManager } from './server-manager';
import { getSetupOrchestrator, testNeedsSetup } from '@/lib/setup/setup-orchestrator';
import { getTeardownOrchestrator, testNeedsTeardown } from '@/lib/setup/teardown-orchestrator';
import type { SetupContext, SetupResult } from '@/lib/setup/types';

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
  label?: string;
}

export interface TestRunResult {
  testId: string;
  status: 'passed' | 'failed' | 'skipped' | 'setup_failed';
  durationMs: number;
  screenshotPath?: string;
  screenshots: CapturedScreenshot[];
  errorMessage?: string;
  consoleErrors?: string[];
  networkRequests?: NetworkRequest[];
  a11yViolations?: A11yViolation[];
  setupDurationMs?: number;
  teardownDurationMs?: number;
  teardownError?: string;
  stabilityMetadata?: StabilityMetadata;
  videoPath?: string;
  softErrors?: string[];
}

export interface ProgressCallback {
  completed: number;
  total: number;
  currentTestName?: string;
  activeCount?: number;
  activeTests?: string[];
}

export class PlaywrightRunner extends EventEmitter {
  private browser: Browser | null = null;
  private screenshotDir: string;
  private isRunning = false;
  private aborted = false;
  private settings: PlaywrightSettings | null = null;
  private forceVideoRecording = false;
  private environmentConfig: EnvironmentConfig | null = null;
  private repositoryId: string | null;
  // Setup context: variables passed from build/suite setup to tests
  private setupContext: SetupContext | null = null;

  constructor(repositoryId?: string | null, screenshotDir?: string) {
    super();
    this.repositoryId = repositoryId ?? null;
    // Build screenshot directory path: include repositoryId if provided
    const baseDir = screenshotDir ?? STORAGE_DIRS.screenshots;
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
   * Set the setup context with variables from build/suite setup
   * These variables will be available to all tests
   */
  setSetupContext(context: SetupContext) {
    this.setupContext = context;
  }

  /**
   * Get the current setup context
   */
  getSetupContext(): SetupContext | null {
    return this.setupContext;
  }

  /**
   * Clear the setup context
   */
  clearSetupContext() {
    this.setupContext = null;
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

  private getMaxParallelTests() {
    return this.settings?.maxParallelTests || 1;
  }

  private getStabilizationSettings(): StabilizationSettings {
    return this.settings?.stabilization || DEFAULT_STABILIZATION_SETTINGS;
  }

  async runTests(
    tests: Test[],
    runId: string,
    onProgress?: (progress: ProgressCallback) => void,
    onResult?: (result: TestRunResult) => void | Promise<void>,
    headlessOverride?: boolean,
    maxParallelOverride?: number,
    forceVideoRecording?: boolean
  ): Promise<TestRunResult[]> {
    this.forceVideoRecording = forceVideoRecording ?? false;
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

      // Cross-OS consistency: inject Chromium flags for identical rendering across OS
      const stabilization = this.getStabilizationSettings();
      const browserType = this.settings?.browser || 'chromium';
      // Use deterministic rendering args when crossOsConsistency or freezeAnimations
      // is enabled — GPU compositing causes non-deterministic canvas anti-aliasing.
      const needsDeterministicRendering = (stabilization.crossOsConsistency || this.settings?.freezeAnimations) && browserType === 'chromium';
      const launchArgs = needsDeterministicRendering ? CROSS_OS_CHROMIUM_ARGS : [];

      // Cast needed as Playwright types may not include 'shell' yet
      const args = [...launchArgs];
      if (!headless) args.push('--start-maximized');
      this.browser = await launcher.launch({
        headless: headless as boolean | undefined,
        args: args.length > 0 ? args : undefined,
      });

      this.emit('event', {
        type: 'started',
        timestamp: Date.now(),
      } as RunEvent);

      // Get max parallel setting (override takes precedence)
      const maxParallel = maxParallelOverride ?? this.getMaxParallelTests();

      if (maxParallel > 1) {
        // Parallel execution
        const parallelResults = await this.runTestsParallel(
          tests,
          runId,
          maxParallel,
          onProgress,
          onResult
        );
        results.push(...parallelResults);
      } else {
        // Sequential execution (original behavior)
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

  /**
   * Run tests in parallel with a maximum concurrency limit.
   */
  private async runTestsParallel(
    tests: Test[],
    runId: string,
    maxParallel: number,
    onProgress?: (progress: ProgressCallback) => void,
    onResult?: (result: TestRunResult) => void | Promise<void>
  ): Promise<TestRunResult[]> {
    const pending = [...tests];
    const running = new Map<string, { promise: Promise<TestRunResult>; testName: string }>();
    const results: TestRunResult[] = [];
    let completedCount = 0;

    const updateProgress = () => {
      const activeTests = [...running.values()].map(r => r.testName);
      onProgress?.({
        completed: completedCount,
        total: tests.length,
        currentTestName: activeTests[0],
        activeCount: running.size,
        activeTests,
      });
    };

    while (pending.length > 0 || running.size > 0) {
      if (this.aborted) break;

      // Fill up to maxParallel slots
      while (running.size < maxParallel && pending.length > 0 && !this.aborted) {
        const test = pending.shift()!;

        const promise = this.runSingleTest(test, runId);
        running.set(test.id, { promise, testName: test.name });
      }

      updateProgress();

      if (running.size === 0) break;

      // Wait for any test to complete and get its ID
      const entries = [...running.entries()];
      const racePromises = entries.map(([testId, { promise }]) =>
        promise.then(result => ({ testId, result })).catch(err => ({ testId, error: err }))
      );

      const completed = await Promise.race(racePromises);

      // Remove from running and process result
      running.delete(completed.testId);
      completedCount++;

      if ('result' in completed) {
        results.push(completed.result);
        await onResult?.(completed.result);
      } else {
        // Handle error case - create a failed result
        const failedResult: TestRunResult = {
          testId: completed.testId,
          status: 'failed',
          durationMs: 0,
          screenshots: [],
          errorMessage: completed.error?.message || 'Unknown error',
        };
        results.push(failedResult);
        await onResult?.(failedResult);
      }

      updateProgress();
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
    let stepCounter = 1;
    let currentStepLabel = `Step ${stepCounter}`;

    // Track setup duration (outside try so catch can access)
    let setupDurationMs = 0;

    // Track soft errors (outside try so catch can access)
    let testSoftErrors: string[] = [];

    // Result object — assigned in try/catch, video path added in finally
    let result: TestRunResult = {
      testId: test.id,
      status: 'failed',
      durationMs: 0,
      screenshots: [],
      errorMessage: 'Unexpected error',
    };

    try {
      // If build-level setup captured storageState (cookies/localStorage),
      // inject it into the new context so tests inherit the login session
      // Check if this test IS a setup test — if so, don't inject storageState
      // because setup tests need clean contexts (e.g., login test needs to see /login)
      let skipStorageStateInjection = false;
      if (this.setupContext?.storageState && test.repositoryId) {
        const defaultSteps = await getDefaultSetupSteps(test.repositoryId);
        if (defaultSteps.some(step => step.testId === test.id)) {
          skipStorageStateInjection = true;
          console.log(`[test-context] Skipping storageState for setup test "${test.name}"`);
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsedStorageState: any;
      if (this.setupContext?.storageState && !skipStorageStateInjection) {
        try {
          parsedStorageState = JSON.parse(this.setupContext.storageState);
          console.log(`[test-context] Injecting storageState: ${parsedStorageState.cookies?.length ?? 0} cookies`);
        } catch {
          console.warn('[test-context] Failed to parse storageState');
        }
      }

      // Set up video recording if enabled
      const videoEnabled = this.settings?.enableVideoRecording || this.forceVideoRecording;
      const videoDir = videoEnabled
        ? path.join(STORAGE_DIRS.videos, this.repositoryId || 'default')
        : undefined;
      if (videoDir && !fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
      }

      // Get stabilization settings (merge per-test overrides if present)
      const stabilization = { ...this.getStabilizationSettings(), ...test.stabilizationOverrides };

      // Per-test playwright overrides
      const effectiveBaseUrl = test.playwrightOverrides?.baseUrl ?? (this.environmentConfig?.baseUrl || 'http://localhost:3000');

      // Per-test viewport override takes precedence over global settings
      const testViewport = test.viewportOverride || this.getViewport();

      const effectiveAcceptAnyCert = test.playwrightOverrides?.acceptAnyCertificate ?? this.settings?.acceptAnyCertificate ?? false;

      context = await this.browser.newContext({
        viewport: testViewport,
        ...(parsedStorageState ? { storageState: parsedStorageState } : {}),
        ...(videoDir ? { recordVideo: { dir: videoDir, size: testViewport } } : {}),
        ...(effectiveAcceptAnyCert ? { ignoreHTTPSErrors: true } : {}),
        ...(this.settings?.freezeAnimations ? { reducedMotion: 'reduce' } : {}),
        ...(this.settings?.grantClipboardAccess ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
        ...(this.settings?.acceptDownloads ? { acceptDownloads: true } : {}),
        ...(stabilization.crossOsConsistency ? { deviceScaleFactor: 1 } : {}),
      });
      page = await context.newPage();

      // Setup freeze scripts BEFORE navigation (must be added as init scripts)
      // Pass freezeAnimations from PlaywrightSettings so setupFreezeScripts can apply
      // deterministic CSS, __resetExcalidrawRNG, and canvas determinism (these conditions
      // check freezeAnimations which lives on PlaywrightSettings, not StabilizationSettings).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await setupFreezeScripts(page, { ...stabilization, freezeAnimations: this.settings?.freezeAnimations ?? false } as any);

      // Setup third-party blocking if enabled
      // Get the base URL from environment config or per-test override
      const envBaseUrl = effectiveBaseUrl.replace(/\/$/, '');
      // Resolve target URL - if test.targetUrl is relative, combine with envBaseUrl
      let targetUrl = envBaseUrl;
      if (test.targetUrl) {
        if (test.targetUrl.startsWith('http://') || test.targetUrl.startsWith('https://')) {
          targetUrl = test.targetUrl;
        } else {
          // Relative URL - combine with envBaseUrl
          targetUrl = `${envBaseUrl.replace(/\/$/, '')}${test.targetUrl.startsWith('/') ? '' : '/'}${test.targetUrl}`;
        }
      }
      await setupThirdPartyBlocking(page, targetUrl, stabilization);

      // Freeze CSS + JS animations if enabled (uses addInitScript to persist across navigations)
      if (this.settings?.freezeAnimations) {
        await page.addInitScript(FREEZE_ANIMATIONS_SCRIPT);
        // Excalidraw RNG: roughjs uses each element's stored seed via Math.imul(48271, seed).
        // Provide __resetExcalidrawRNG that resets the LCG seed for deterministic rendering.
        // Note: setupFreezeScripts also injects this when freezeAnimations is passed through,
        // but this serves as a fallback if freezeRandomValues is off.
        await page.addInitScript(`
          (function() {
            window.__resetExcalidrawRNG = function() {
              if (typeof window.__resetMathRandom === 'function') {
                window.__resetMathRandom();
              }
            };
          })();
        `);
        // Force willReadFrequently on canvas 2D contexts when freezeAnimations is
        // enabled (but crossOsConsistency is not — that case is in setupFreezeScripts).
        // This ensures CPU-backed canvas for deterministic toDataURL() results.
        if (!stabilization.crossOsConsistency) {
          await page.addInitScript(`
            (function() {
              var _origGetContext = HTMLCanvasElement.prototype.getContext;
              HTMLCanvasElement.prototype.getContext = function(type, attrs) {
                if (type === '2d') {
                  attrs = Object.assign({}, attrs || {}, { willReadFrequently: true });
                }
                return _origGetContext.call(this, type, attrs);
              };
            })();
          `);
        }
      }

      // Patterns for console errors that should be ignored (React dev warnings, hydration, etc.)
      const ignoredErrorPatterns = [
        /hydrat(ion|ed)/i,
        /server rendered HTML/i,
        /This won't be patched up/i,
        /react\.dev\/link\/hydration-mismatch/i,
        /Warning: .* did not match/i,
        /Text content does not match/i,
        /Failed to load resource/i,
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
      const ignoreExternalNetworkErrors = this.settings?.ignoreExternalNetworkErrors ?? false;
      let targetOrigin: string | undefined;
      try { targetOrigin = new URL(targetUrl).origin; } catch { /* ignore */ }

      page.on('response', response => {
        if (response.status() >= 400) {
          // Skip external origin errors if configured
          if (ignoreExternalNetworkErrors && targetOrigin) {
            try {
              const responseOrigin = new URL(response.url()).origin;
              if (responseOrigin !== targetOrigin) return;
            } catch { /* keep the error if URL parsing fails */ }
          }
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

      // Run test-level setup if configured
      const orchestrator = getSetupOrchestrator();
      const baseContext: SetupContext = {
        baseUrl: envBaseUrl.replace(/\/$/, ''), // Strip trailing slash to avoid double slashes
        page,
        variables: this.setupContext?.variables || {},
        repositoryId: this.repositoryId,
      };

      // Check if test has setup (own or from repo defaults)
      // Skip per-test setup if storageState was already injected into this context
      // (from build-level setup or a prior test's setup) — the session cookies
      // are already present, re-running login would fail (app redirects away from /login).
      const setupAlreadyInjected = !!parsedStorageState;
      if (setupAlreadyInjected && await testNeedsSetup(test)) {
        console.log(`[test-setup] Skipping per-test setup for "${test.name}" — storageState already injected`);
      }
      if (!setupAlreadyInjected && await testNeedsSetup(test)) {
        const setupResult = await orchestrator.runTestSetup(test, page, baseContext);
        setupDurationMs = setupResult.duration;

        if (!setupResult.success) {
          // Setup failed - return early with setup_failed status
          const durationMs = Date.now() - startTime;

          this.emit('event', {
            type: 'test_failed',
            testId: test.id,
            testName: test.name,
            durationMs,
            error: `Setup failed: ${setupResult.error}`,
            timestamp: Date.now(),
          } as RunEvent);

          // Take screenshot on setup failure if possible
          let screenshotPath: string | undefined;
          try {
            const screenshotFilename = `${runId}-${test.id}-setup-failure.png`;
            const fullPath = path.join(this.screenshotDir, screenshotFilename);
            await page.screenshot({ path: fullPath, fullPage: true });
            screenshotPath = this.repositoryId
              ? `/screenshots/${this.repositoryId}/${screenshotFilename}`
              : `/screenshots/${screenshotFilename}`;
          } catch {
            // Ignore screenshot errors
          }

          return {
            testId: test.id,
            status: 'setup_failed',
            durationMs,
            screenshotPath,
            screenshots: screenshotPath ? [{ path: screenshotPath, label: 'setup-failure' }] : [],
            errorMessage: `Setup failed: ${setupResult.error}`,
            setupDurationMs,
          };
        }

        // Merge setup variables into context
        if (setupResult.variables) {
          baseContext.variables = {
            ...baseContext.variables,
            ...setupResult.variables,
          };
        }

        // Wait for page to settle after setup (e.g., login click + redirect)
        // First, wait for URL change (login → redirect target)
        const setupPageUrl = page.url();
        try {
          await page.waitForURL(
            url => url.toString() !== setupPageUrl,
            { timeout: 10000, waitUntil: 'networkidle' }
          );
        } catch {
          // URL didn't change within timeout — setup didn't trigger navigation
        }

        // Then verify the session cookie actually exists before proceeding.
        // The redirect may have completed but the Set-Cookie hasn't been
        // processed by the browser yet.
        try {
          const ctx = page.context();
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const cookies = await ctx.cookies();
            const hasSession = cookies.some(c =>
              c.name.includes('session') || c.name.includes('auth') || c.name.includes('token')
            );
            if (hasSession) {
              console.log(`[per-test-setup] Session cookie found after setup (${cookies.length} total cookies)`);
              break;
            }
            await page.waitForTimeout(200);
          }
        } catch {
          // Cookie check failed — continue anyway
        }

        // Capture storageState after per-test setup so it can seed future contexts
        if (!this.setupContext?.storageState) {
          try {
            const state = await page.context().storageState();
            if (state.cookies.length > 0) {
              if (!this.setupContext) {
                this.setupContext = { baseUrl: envBaseUrl.replace(/\/+$/, ''), variables: {} };
              }
              this.setupContext.storageState = JSON.stringify(state);
              console.log(`[per-test-setup] Captured storageState: ${state.cookies.length} cookies`);
            }
          } catch {
            // Ignore storageState capture errors
          }
        }
      }

      // Create a proxy that intercepts page.screenshot() calls
      const screenshotDelay = this.settings?.screenshotDelay ?? 0;
      let aggregatedStabilityMetadata: StabilityMetadata | undefined;
      const screenshotProxy = new Proxy(page, {
        get: (target, prop) => {
          if (prop === 'screenshot') {
            return async (options?: Parameters<Page['screenshot']>[0]) => {
              // Apply stabilization before screenshot
              await applyStabilization(target, targetUrl, stabilization);

              // Deterministic rendering CSS is now injected once via setupFreezeScripts
              // init script (when freezeAnimations or crossOsConsistency is enabled),
              // so no per-screenshot addStyleTag is needed.

              // Apply dynamic content masking before screenshot
              if (stabilization.autoMaskDynamicContent) {
                await applyDynamicMasking(target, stabilization);
              }

              // Apply screenshot delay for visual stabilization
              if (screenshotDelay > 0) {
                await target.waitForTimeout(screenshotDelay);
              }

              let result: Buffer;
              if (stabilization.burstCapture) {
                // Use burst capture for instability detection
                const burst = await captureWithBurst(target, options, {
                  frameCount: stabilization.burstFrameCount,
                  stabilityThreshold: stabilization.burstStabilityThreshold,
                });
                result = burst.buffer;

                // Track worst stability across all screenshots in this test
                if (!aggregatedStabilityMetadata || burst.stabilityMetadata.maxFrameDiff > aggregatedStabilityMetadata.maxFrameDiff) {
                  aggregatedStabilityMetadata = burst.stabilityMetadata;
                }

                // Write buffer to disk if path was specified
                if (options?.path) {
                  fs.writeFileSync(options.path as string, result);
                }
              } else {
                result = await target.screenshot(options) as Buffer;
              }

              if (options?.path) {
                const filename = path.basename(options.path as string);
                // Ensure the screenshot is saved to the correct location on disk
                // (test code may pass an invalid path, e.g. treating screenshotPath as a directory)
                const correctDiskPath = path.join(this.screenshotDir, filename);
                if (!fs.existsSync(correctDiskPath)) {
                  fs.writeFileSync(correctDiskPath, result);
                }
                const publicPath = this.repositoryId
                  ? `/screenshots/${this.repositoryId}/${filename}`
                  : `/screenshots/${filename}`;
                capturedScreenshots.push({ path: publicPath, label: currentStepLabel });
                // Increment step counter for next screenshot
                stepCounter++;
                currentStepLabel = `Step ${stepCounter}`;
              } else {
                // Auto-save screenshot when test code doesn't specify a path
                const autoFilename = `${runId}-${test.id}-Step_${stepCounter}.png`;
                const autoPath = path.join(this.screenshotDir, autoFilename);
                fs.writeFileSync(autoPath, result);
                const publicPath = this.repositoryId
                  ? `/screenshots/${this.repositoryId}/${autoFilename}`
                  : `/screenshots/${autoFilename}`;
                capturedScreenshots.push({ path: publicPath, label: currentStepLabel });
                stepCounter++;
                currentStepLabel = `Step ${stepCounter}`;

              }
              // Disable RAF gating + unfreeze performance.now after screenshot
              /* eslint-disable @typescript-eslint/no-explicit-any */
              await target.evaluate(() => {
                if (typeof (window as any).__disableRAFGating === 'function') {
                  (window as any).__disableRAFGating();
                }
                (window as any).__perfNowFrozen = false;
              }).catch(() => {});
              /* eslint-enable @typescript-eslint/no-explicit-any */

              return result;
            };
          }
          const value = target[prop as keyof Page];
          if (typeof value === 'function') {
            return (value as (...args: unknown[]) => unknown).bind(target);
          }
          return value;
        }
      });

      // Execute the test code with the proxy page
      // Errors are caught as soft errors so screenshot capture still happens
      let testThrewError = false;
      try {
        testSoftErrors = await this.executeTestCode(screenshotProxy, test, runId, testScreenshotPath, (label: string) => {
          currentStepLabel = label;
        });
      } catch (e) {
        testThrewError = true;
        const msg = e instanceof Error ? e.message : String(e);
        testSoftErrors.push(msg);
        console.warn(`[soft-error] Test "${test.name}" error, continuing to screenshot: ${msg}`);
      }

      // If test threw and captured zero screenshots, it's a hard failure —
      // soft errors only count as passed when screenshots were still captured
      if (testThrewError && capturedScreenshots.length === 0) {
        const errorMsg = testSoftErrors[testSoftErrors.length - 1] || 'Test failed without capturing any screenshots';
        throw new Error(errorMsg);
      }

      // Check for console errors or network failures after test execution
      const consoleErrorMode = (this.settings?.consoleErrorMode as string) || 'fail';
      const networkErrorMode = (this.settings?.networkErrorMode as string) || 'fail';
      const errorParts: string[] = [];

      if (consoleErrors.length > 0 && consoleErrorMode !== 'ignore') {
        const msg = `Console errors detected: ${consoleErrors.join('; ')}`;
        if (consoleErrorMode === 'warn') {
          console.warn(`[test] ${msg}`);
        } else {
          errorParts.push(msg);
        }
      }
      if (networkFailures.length > 0 && networkErrorMode !== 'ignore') {
        const failureDetails = networkFailures.map(f => `${f.method} ${f.url} (${f.status})`).join('; ');
        const msg = `Network failures detected: ${failureDetails}`;
        if (networkErrorMode === 'warn') {
          console.warn(`[test] ${msg}`);
        } else {
          errorParts.push(msg);
        }
      }
      if (errorParts.length > 0) {
        throw new Error(errorParts.join(' | '));
      }

      // Run accessibility check with axe-core
      let a11yViolations: A11yViolation[] | undefined;
      try {
        const a11yResults = await new AxeBuilder({ page }).analyze();
        if (a11yResults.violations.length > 0) {
          a11yViolations = a11yResults.violations.map(v => ({
            id: v.id,
            impact: v.impact as A11yViolation['impact'],
            description: v.description,
            help: v.help,
            helpUrl: v.helpUrl,
            nodes: v.nodes.length,
          }));
        }
      } catch {
        // Ignore a11y check errors - don't fail the test
      }

      let screenshotPublicPath: string | undefined;

      // Only take a fallback success screenshot if no screenshots were captured during the test
      if (capturedScreenshots.length === 0) {
        // Apply stabilization before fallback screenshot
        await applyStabilization(page, targetUrl, stabilization);

        // Apply dynamic content masking before fallback screenshot
        if (stabilization.autoMaskDynamicContent) {
          await applyDynamicMasking(page, stabilization);
        }

        if (screenshotDelay > 0) {
          await page.waitForTimeout(screenshotDelay);
        }
        const screenshotFilename = `${runId}-${test.id}-success.png`;
        const screenshotPath = path.join(this.screenshotDir, screenshotFilename);

        if (stabilization.burstCapture) {
          const burst = await captureWithBurst(page, { fullPage: true }, {
            frameCount: stabilization.burstFrameCount,
            stabilityThreshold: stabilization.burstStabilityThreshold,
          });
          fs.writeFileSync(screenshotPath, burst.buffer);
          if (!aggregatedStabilityMetadata || burst.stabilityMetadata.maxFrameDiff > aggregatedStabilityMetadata.maxFrameDiff) {
            aggregatedStabilityMetadata = burst.stabilityMetadata;
          }
        } else {
          await page.screenshot({ path: screenshotPath, fullPage: true });
        }

        screenshotPublicPath = this.repositoryId
          ? `/screenshots/${this.repositoryId}/${screenshotFilename}`
          : `/screenshots/${screenshotFilename}`;
      }

      // Run teardown after test (non-blocking — errors don't affect test status)
      let teardownDurationMs: number | undefined;
      let teardownError: string | undefined;
      if (await testNeedsTeardown(test)) {
        try {
          const teardownOrchestrator = getTeardownOrchestrator();
          const teardownResult = await teardownOrchestrator.runTestTeardown(test, page, baseContext);
          teardownDurationMs = teardownResult.duration > 0 ? teardownResult.duration : undefined;
          if (!teardownResult.success) {
            teardownError = teardownResult.error;
            console.warn(`[teardown] Non-blocking error for "${test.name}": ${teardownResult.error}`);
          }
        } catch (e) {
          teardownError = e instanceof Error ? e.message : String(e);
          console.warn(`[teardown] Non-blocking exception for "${test.name}": ${teardownError}`);
        }
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

      result = {
        testId: test.id,
        status: 'passed',
        durationMs,
        // Use first captured screenshot if any, otherwise fallback screenshot
        screenshotPath: capturedScreenshots[0]?.path || screenshotPublicPath,
        screenshots: capturedScreenshots,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
        networkRequests: networkFailures.length > 0 ? networkFailures : undefined,
        a11yViolations,
        setupDurationMs: setupDurationMs > 0 ? setupDurationMs : undefined,
        teardownDurationMs,
        teardownError,
        stabilityMetadata: aggregatedStabilityMetadata,
        softErrors: testSoftErrors.length > 0 ? testSoftErrors : undefined,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Run teardown even on failure (it's cleanup)
      let teardownDurationMs: number | undefined;
      let teardownError: string | undefined;
      if (page && await testNeedsTeardown(test)) {
        try {
          const teardownOrchestrator = getTeardownOrchestrator();
          const fallbackBaseUrl = this.environmentConfig?.baseUrl || 'http://localhost:3000';
          const teardownContext: SetupContext = {
            baseUrl: fallbackBaseUrl.replace(/\/$/, ''),
            page,
            variables: this.setupContext?.variables || {},
            repositoryId: this.repositoryId,
          };
          const teardownResult = await teardownOrchestrator.runTestTeardown(test, page, teardownContext);
          teardownDurationMs = teardownResult.duration > 0 ? teardownResult.duration : undefined;
          if (!teardownResult.success) {
            teardownError = teardownResult.error;
            console.warn(`[teardown] Non-blocking error for "${test.name}": ${teardownResult.error}`);
          }
        } catch (e) {
          teardownError = e instanceof Error ? e.message : String(e);
          console.warn(`[teardown] Non-blocking exception for "${test.name}": ${teardownError}`);
        }
      }

      const durationMs = Date.now() - startTime;

      this.emit('event', {
        type: 'test_failed',
        testId: test.id,
        testName: test.name,
        durationMs,
        error: errorMessage,
        screenshotPath: capturedScreenshots[0]?.path,
        timestamp: Date.now(),
      } as RunEvent);

      result = {
        testId: test.id,
        status: 'failed',
        durationMs,
        screenshotPath: capturedScreenshots[0]?.path,
        screenshots: capturedScreenshots,
        errorMessage,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
        networkRequests: networkFailures.length > 0 ? networkFailures : undefined,
        setupDurationMs: setupDurationMs > 0 ? setupDurationMs : undefined,
        teardownDurationMs,
        teardownError,
        softErrors: testSoftErrors.length > 0 ? testSoftErrors : undefined,
      };

    } finally {
      // Capture video before closing context (video is finalized on close)
      const video = page?.video();
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      // After context close, video file is finalized — relocate it
      if (video) {
        try {
          const videoDestDir = path.join(STORAGE_DIRS.videos, this.repositoryId || 'default');
          if (!fs.existsSync(videoDestDir)) {
            fs.mkdirSync(videoDestDir, { recursive: true });
          }
          const dest = path.join(videoDestDir, `${runId}-${test.id}.webm`);
          await video.saveAs(dest);
          await video.delete(); // clean temp file
          result.videoPath = toRelativePath(dest);
        } catch {
          // Video capture is best-effort
        }
      }
    }

    return result;
  }

  /**
   * Strip TypeScript type annotations from code so it can execute as plain JavaScript.
   */
  private stripTypeAnnotations(code: string): string {
    return stripTypeAnnotations(code);
  }

  /**
   * Validate test code for dangerous patterns before execution.
   */
  private validateTestCode(code: string): void {
    validateTestCode(code);
  }

  private async executeTestCode(page: Page, test: Test, runId: string, screenshotPath: string, onStepLabel?: (label: string) => void): Promise<string[]> {
    let code = test.code;
    if (!code) {
      throw new Error('No test code');
    }

    // Validate test code before execution
    this.validateTestCode(code);

    // Resolve {{sheet:...}} data references from Google Sheets data sources
    if (code.includes('{{sheet:')) {
      try {
        const { resolveSheetReferences } = await import('@/lib/google-sheets/resolver');
        const { getGoogleSheetsDataSources } = await import('@/lib/db/queries');
        const repoId = test.repositoryId || this.repositoryId;
        if (repoId) {
          const dataSources = await getGoogleSheetsDataSources(repoId);
          if (dataSources.length > 0) {
            const result = resolveSheetReferences(code, dataSources);
            if (result.errors.length > 0) {
              console.warn('Sheet data reference warnings:', result.errors);
            }
            code = result.resolvedCode;
          }
        }
      } catch (err) {
        console.warn('Failed to resolve sheet data references:', err);
      }
    }

    // Try to execute as a proper function with signature:
    // export async function test(page, baseUrl, screenshotPath, stepLogger)
    const funcMatch = code.match(
      /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
    );

    if (funcMatch) {
      const serverManager = getServerManager();
      const baseUrl = (this.environmentConfig?.baseUrl || serverManager.resolveUrl('http://localhost:3000') || 'http://localhost:3000').replace(/\/$/, '');

      const softErrors: string[] = [];

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
        warn: (msg: string) => {
          softErrors.push(msg);
          onStepLabel?.(`[WARN] ${msg}`);
        },
        softExpect: async (fn: () => Promise<void>, label?: string) => {
          try {
            await fn();
          } catch (e: unknown) {
            const msg = label || (e instanceof Error ? e.message : String(e));
            softErrors.push(msg);
            onStepLabel?.(`[SOFT FAIL] ${msg}`);
          }
        },
        softAction: async (fn: () => Promise<void>, label?: string) => {
          try {
            await fn();
          } catch (e: unknown) {
            const msg = label || (e instanceof Error ? e.message : String(e));
            softErrors.push(msg);
            onStepLabel?.(`[SOFT FAIL] ${msg}`);
          }
        },
      };

      // Strip import statements and the function wrapper, execute the body
      // Also strip TypeScript annotations since code runs as plain JavaScript
      let body = this.stripTypeAnnotations(funcMatch[1]);

      // Build an async function from the body
      // Include 'expect' for Playwright Inspector-generated tests that use assertions
      // Include 'appState' for internal state inspection (Excalidraw undo/redo, etc.)
      const expectFn = createExpect(this.getActionTimeout(), softErrors);
      const appStateFn = createAppState(page);

      // Create stats-tracking locateWithFallback that tests can use
      const testId = test.id;
      const statsLocateWithFallback = async (
        pg: Page,
        selectors: { type: string; value: string }[],
        action: string,
        value?: string | null,
        coords?: { x: number; y: number } | null
      ) => {
        const hash = crypto.createHash('sha256').update(JSON.stringify(selectors)).digest('hex').slice(0, 16);
        let validSelectors = selectors.filter(s => s.value && s.value.trim() && !s.value.includes('undefined'));

        // Load stats and apply optimization
        try {
          const stats = await getSelectorStats(testId, hash);
          if (stats.length > 0) {
            const statsMap = new Map(stats.map(s => [`${s.selectorType}:${s.selectorValue}`, s]));

            // Sort by success count (successful selectors first)
            validSelectors = validSelectors.sort((a, b) => {
              const aStats = statsMap.get(`${a.type}:${a.value}`);
              const bStats = statsMap.get(`${b.type}:${b.value}`);
              const aSuccess = aStats?.successCount ?? 0;
              const bSuccess = bStats?.successCount ?? 0;
              if (aSuccess > 0 && bSuccess === 0) return -1;
              if (bSuccess > 0 && aSuccess === 0) return 1;
              return bSuccess - aSuccess;
            });

            // Skip selectors with 0 successes after 3+ attempts
            validSelectors = validSelectors.filter(s => {
              const stat = statsMap.get(`${s.type}:${s.value}`);
              if (!stat) return true;
              if ((stat.totalAttempts ?? 0) >= 3 && (stat.successCount ?? 0) === 0) {
                return false; // Skip this selector
              }
              return true;
            });
          }
        } catch {
          // Stats unavailable, continue without optimization
        }

        for (const sel of validSelectors) {
          const start = Date.now();
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
            await target.scrollIntoViewIfNeeded().catch(() => {});
            if (action === 'click') await target.click();
            else if (action === 'fill') await target.fill(value || '');
            else if (action === 'selectOption') await target.selectOption(value || '');
            recordSelectorSuccess(testId, hash, sel.type, sel.value, Date.now() - start).catch(() => {});
            return;
          } catch {
            recordSelectorFailure(testId, hash, sel.type, sel.value).catch(() => {});
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

      // Remove the test's local locateWithFallback function declaration so the parameter is used
      // Match: async function locateWithFallback(...) { ... } with balanced braces
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
          // Replace the function with a comment
          body = body.slice(0, startIdx) + '/* locateWithFallback provided by runner */' + body.slice(endIdx);
        }
      }

      // Replace replayCursorPath with speed-aware version from runner
      if (body.includes('async function replayCursorPath(')) {
        const rcpMatch = body.match(/async function replayCursorPath\s*\([^)]*\)\s*\{/);
        if (rcpMatch && rcpMatch.index !== undefined) {
          const rcpStart = rcpMatch.index;
          const rcpBraceStart = body.indexOf('{', rcpStart);
          let rcpDepth = 1;
          let rcpEnd = rcpBraceStart + 1;
          while (rcpDepth > 0 && rcpEnd < body.length) {
            if (body[rcpEnd] === '{') rcpDepth++;
            else if (body[rcpEnd] === '}') rcpDepth--;
            rcpEnd++;
          }
          body = body.slice(0, rcpStart) + '/* replayCursorPath provided by runner */' + body.slice(rcpEnd);
        }
      }

      // Fix legacy test code that uses non-existent page.keyboard.selectAll()
      // Older recorder versions generated this; the correct Playwright API is keyboard.press('Control+a')
      body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

      // Wrap standalone await statements (except screenshots) in try/catch so
      // execution continues past locator/action failures to reach screenshot calls
      body = body.replace(/^(\s*)(await\s+.+;)\s*$/gm, (_match, indent, stmt) => {
        if (stmt.includes('.screenshot(')) return `${indent}${stmt}`;
        return `${indent}try { ${stmt} } catch(__softErr) { stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
      });

      // File upload helper — always available
      const fileUploadHelper = async (selector: string, filePaths: string | string[]) => {
        const locator = page.locator(selector);
        await locator.setInputFiles(Array.isArray(filePaths) ? filePaths : [filePaths]);
      };

      // Clipboard helper — available when grantClipboardAccess is enabled
      const clipboardHelper = this.settings?.grantClipboardAccess ? {
        copy: async (text: string) => {
          await page.evaluate((t) => navigator.clipboard.writeText(t), text);
        },
        paste: async () => {
          return await page.evaluate(() => navigator.clipboard.readText());
        },
        pasteInto: async (selector: string) => {
          await page.locator(selector).focus();
          await page.keyboard.press('Control+V');
        },
      } : null;

      // Downloads helper — available when acceptDownloads is enabled
      const dlDir = this.settings?.acceptDownloads
        ? path.join(STORAGE_DIRS.screenshots, this.repositoryId || 'default', 'downloads')
        : '';
      if (dlDir) {
        fs.mkdirSync(dlDir, { recursive: true });
      }
      const dlList: Array<{ suggestedFilename: string; path: string }> = [];
      const downloadsHelper = this.settings?.acceptDownloads ? {
        waitForDownload: async (triggerAction: () => Promise<void>) => {
          const [download] = await Promise.all([
            page.waitForEvent('download'),
            triggerAction(),
          ]);
          const safeName = path.basename(download.suggestedFilename()).replace(/\.\./g, '_');
          const savePath = path.join(dlDir, safeName);
          await download.saveAs(savePath);
          dlList.push({ suggestedFilename: safeName, path: savePath });
          return { filename: safeName, path: savePath };
        },
        list: () => dlList,
      } : null;

      // Network interception helper — available when enableNetworkInterception is enabled
      const networkHelper = this.settings?.enableNetworkInterception ? {
        mock: async (urlPattern: string, response: { status?: number; body?: string; contentType?: string; json?: unknown }) => {
          await page.route(urlPattern, async (route) => {
            await route.fulfill({
              status: response.status ?? 200,
              contentType: response.contentType ?? (response.json ? 'application/json' : 'text/plain'),
              body: response.json ? JSON.stringify(response.json) : (response.body ?? ''),
            });
          });
        },
        block: async (urlPattern: string) => {
          await page.route(urlPattern, (route) => route.abort());
        },
        passthrough: async (urlPattern: string) => {
          await page.unroute(urlPattern);
        },
        capture: (urlPattern: string) => {
          const captured: Array<{ url: string; method: string; postData?: string }> = [];
          page.on('request', (req) => {
            if (new RegExp(urlPattern).test(req.url())) {
              captured.push({ url: req.url(), method: req.method(), postData: req.postData() ?? undefined });
            }
          });
          return { requests: captured };
        },
      } : null;

      // Speed-aware replayCursorPath — respects cursorPlaybackSpeed setting
      const cursorPlaybackSpeed = this.settings?.cursorPlaybackSpeed ?? 1;
      const replayCursorPathFn = async (pg: Page, moves: [number, number, number][]) => {
        for (const [x, y, delay] of moves) {
          await pg.mouse.move(x, y);
          if (delay > 0 && cursorPlaybackSpeed > 0) {
            await pg.waitForTimeout(Math.round(delay / cursorPlaybackSpeed));
          }
        }
      };

      // Load test fixtures from DB — map filename → absolute storage path
      const fixturesMap: Record<string, string> = {};
      if (test.id) {
        const fixtureRecords = await getTestFixtures(test.id);
        for (const fixture of fixtureRecords) {
          const absPath = path.join(STORAGE_DIRS.fixtures, fixture.storagePath.replace(/^\/fixtures\//, ''));
          if (fs.existsSync(absPath)) {
            fixturesMap[fixture.filename] = absPath;
          }
        }
      }

      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const testFn = new AsyncFunction('page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'appState', 'locateWithFallback', 'fileUpload', 'clipboard', 'downloads', 'network', 'replayCursorPath', 'fixtures', body);
      await testFn(page, baseUrl, screenshotPath, stepLogger, expectFn, appStateFn, statsLocateWithFallback, fileUploadHelper, clipboardHelper, downloadsHelper, networkHelper, replayCursorPathFn, fixturesMap);
      return softErrors;
    }

    // Legacy: try Playwright test format
    const bodyMatch = code.match(/test\([^,]+,\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{([\s\S]*)\}\);?\s*$/);

    if (!bodyMatch) {
      const lines = code.split('\n').filter(line =>
        line.trim().startsWith('await page.')
      );
      for (const line of lines) {
        await this.executeLine(page, line.trim(), test.id);
      }
      return [];
    }

    const body = bodyMatch[1];
    const lines = body.split('\n').filter(line => line.trim() && !line.trim().startsWith('//'));

    for (const line of lines) {
      await this.executeLine(page, line.trim(), test.id);
    }
    return [];
  }

  // Locate element using fallback selector strategy with stats-based optimization
  private async locateWithFallback(
    page: Page,
    selectors: ActionSelector[],
    testId?: string,
  ): Promise<Locator> {
    const priority = this.getSelectorPriority();
    const timeout = this.getActionTimeout();

    // Compute hash of selector array for stats lookup
    const selectorArrayHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(selectors))
      .digest('hex')
      .slice(0, 16);

    // Load stats if testId provided
    let stats: Awaited<ReturnType<typeof getSelectorStats>> = [];
    if (testId) {
      try {
        stats = await getSelectorStats(testId, selectorArrayHash);
      } catch {
        // Stats unavailable, continue without optimization
      }
    }
    const statsMap = new Map(stats.map(s => [`${s.selectorType}:${s.selectorValue}`, s]));

    // Sort selectors by user-defined priority
    let sorted = selectors
      .filter(s => priority.find(p => p.type === s.type && p.enabled))
      .sort((a, b) => {
        const aPriority = priority.find(p => p.type === a.type)?.priority ?? 999;
        const bPriority = priority.find(p => p.type === b.type)?.priority ?? 999;
        return aPriority - bPriority;
      });

    // Re-sort based on stats: successful selectors first, ordered by success count desc
    if (stats.length > 0) {
      sorted = sorted.sort((a, b) => {
        const aStats = statsMap.get(`${a.type}:${a.value}`);
        const bStats = statsMap.get(`${b.type}:${b.value}`);
        const aSuccess = aStats?.successCount ?? 0;
        const bSuccess = bStats?.successCount ?? 0;
        // Put successful selectors first
        if (aSuccess > 0 && bSuccess === 0) return -1;
        if (bSuccess > 0 && aSuccess === 0) return 1;
        // Among successful, sort by success count desc
        if (aSuccess !== bSuccess) return bSuccess - aSuccess;
        // Fall back to original priority
        const aPriority = priority.find(p => p.type === a.type)?.priority ?? 999;
        const bPriority = priority.find(p => p.type === b.type)?.priority ?? 999;
        return aPriority - bPriority;
      });

      // Skip selectors with 0 successes after 3+ attempts
      sorted = sorted.filter(s => {
        const stat = statsMap.get(`${s.type}:${s.value}`);
        if (!stat) return true; // No history, try it
        if ((stat.totalAttempts ?? 0) >= 3 && (stat.successCount ?? 0) === 0) {
          return false; // Skip: tried 3+ times, never worked
        }
        return true;
      });
    }

    // Try each selector in priority order
    const perSelectorTimeout = Math.max(Math.floor(timeout / Math.max(sorted.length, 1)), 1000);

    for (const sel of sorted) {
      const startTime = Date.now();
      try {
        const locator = page.locator(sel.value);
        await locator.waitFor({ timeout: perSelectorTimeout, state: 'visible' });
        // Record success
        if (testId) {
          const elapsed = Date.now() - startTime;
          recordSelectorSuccess(testId, selectorArrayHash, sel.type, sel.value, elapsed).catch(() => {});
        }
        return locator;
      } catch {
        // Record failure
        if (testId) {
          recordSelectorFailure(testId, selectorArrayHash, sel.type, sel.value).catch(() => {});
        }
        continue;
      }
    }

    // If no prioritized selectors worked, try all selectors as fallback
    for (const sel of selectors) {
      const startTime = Date.now();
      try {
        const locator = page.locator(sel.value);
        await locator.waitFor({ timeout: 1000, state: 'visible' });
        // Record success
        if (testId) {
          const elapsed = Date.now() - startTime;
          recordSelectorSuccess(testId, selectorArrayHash, sel.type, sel.value, elapsed).catch(() => {});
        }
        return locator;
      } catch {
        // Record failure
        if (testId) {
          recordSelectorFailure(testId, selectorArrayHash, sel.type, sel.value).catch(() => {});
        }
        continue;
      }
    }

    throw new Error(`No selector matched: ${JSON.stringify(selectors)}`);
  }

  private async executeLine(page: Page, line: string, testId?: string): Promise<void> {
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

        const locator = await this.locateWithFallback(page, selectors, testId);

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
      } else {
        // Handle screenshot without explicit path (just fullPage option)
        const fullPage = fullPageMatch ? fullPageMatch[1] === 'true' : false;
        await page.screenshot({ fullPage });
      }
    } else if (line.startsWith('await page.waitForLoadState(')) {
      // Handle waitForLoadState
      const stateMatch = line.match(/waitForLoadState\(['"]([^'"]+)['"]\)/);
      if (stateMatch) {
        const state = stateMatch[1] as 'load' | 'domcontentloaded' | 'networkidle';
        // networkidle can hang on pages with persistent connections (SSE/polling)
        const timeout = state === 'networkidle' ? 10000 : 30000;
        await page.waitForLoadState(state, { timeout }).catch(() => {});
      }
    } else if (line.startsWith('await page.waitForTimeout(')) {
      // Handle waitForTimeout
      const timeMatch = line.match(/waitForTimeout\((\d+)\)/);
      if (timeMatch) {
        await page.waitForTimeout(parseInt(timeMatch[1], 10));
      }
    } else if (line.startsWith('await page.fill(')) {
      // Handle legacy page.fill() format
      const fillMatch = line.match(/fill\(['"]([^'"]+)['"],\s*['"]([^'"]*)['"]\)/);
      if (fillMatch) {
        await page.fill(fillMatch[1], fillMatch[2]);
      }
    } else if (line.startsWith('await page.click(')) {
      // Handle legacy page.click() format
      const clickMatch = line.match(/click\(['"]([^'"]+)['"]\)/);
      if (clickMatch) {
        await page.click(clickMatch[1]);
      }
    }
  }

  abort(): void {
    this.aborted = true;
  }

  /**
   * Force reset the runner state. Use when runner is stuck in "running" state.
   */
  async forceReset(): Promise<void> {
    this.aborted = true;
    await this.cleanup();
    this.isRunning = false;
    this.aborted = false;
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
