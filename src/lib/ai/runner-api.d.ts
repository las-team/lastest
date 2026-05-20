/**
 * Typed surface of the Lastest test runner — used by validate-test-against-api.ts
 * to type-check AI-generated test code before it reaches the DB.
 *
 * Source of truth alignment:
 *   - Variable bag        → packages/embedded-browser/src/test-executor.ts:1204
 *                          packages/runner/src/runner.ts:1374
 *   - Expect matcher list → packages/shared/src/playwright-expect.ts:113
 *
 * If those drift, this file must be updated. The
 * `runner-parity-matchers.test.ts` suite + `audit-playwright-parity.ts` script
 * keep them in sync.
 */

// We borrow Page/Locator from @playwright/test so the chain methods
// (locator, filter, getByRole, click, fill, …) are typed by Playwright itself.
// Only the *matcher* surface differs from upstream and is redeclared below.
import type { Page as PWPage, Locator as PWLocator } from '@playwright/test';

export type Page = PWPage;
export type Locator = PWLocator;

// ───────────────────────────────────────────────────────────────────────────
// Expect — matcher list mirrored from packages/shared/src/playwright-expect.ts
// ───────────────────────────────────────────────────────────────────────────

interface LocatorMatchers {
  toBeVisible(opts?: { timeout?: number }): Promise<void>;
  toBeHidden(opts?: { timeout?: number }): Promise<void>;
  toBeAttached(opts?: { timeout?: number }): Promise<void>;
  toBeEnabled(opts?: { timeout?: number }): Promise<void>;
  toBeDisabled(opts?: { timeout?: number }): Promise<void>;
  toBeChecked(opts?: { timeout?: number; checked?: boolean }): Promise<void>;
  toBeFocused(opts?: { timeout?: number }): Promise<void>;
  toBeEditable(opts?: { timeout?: number }): Promise<void>;
  toBeEmpty(opts?: { timeout?: number }): Promise<void>;
  toBeInViewport(opts?: { timeout?: number; ratio?: number }): Promise<void>;
  toHaveText(expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  toContainText(expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  toHaveValue(expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  toHaveAttribute(name: string, expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  toHaveCount(expected: number, opts?: { timeout?: number }): Promise<void>;
  toHaveClass(expected: string | RegExp | (string | RegExp)[], opts?: { timeout?: number }): Promise<void>;
  toHaveCSS(name: string, expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  toHaveJSProperty(name: string, expected: unknown, opts?: { timeout?: number }): Promise<void>;
  toHaveRole(expected: string, opts?: { timeout?: number }): Promise<void>;
}

interface PageMatchers {
  toHaveURL(expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  toHaveTitle(expected: string | RegExp, opts?: { timeout?: number }): Promise<void>;
  toHaveScreenshot(name?: string, opts?: unknown): Promise<void>;
}

interface GenericMatchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeNaN(): void;
  toBeInstanceOf(ctor: unknown): void;
  toBeCloseTo(expected: number, digits?: number): void;
  toContain(expected: unknown): void;
  toHaveLength(expected: number): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toMatch(expected: string | RegExp): void;
}

type LocatorExpect = LocatorMatchers & { not: LocatorMatchers };
type PageExpect = PageMatchers & { not: PageMatchers };
type GenericExpect = GenericMatchers & { not: GenericMatchers };

interface ExpectFn {
  (target: Locator, message?: string): LocatorExpect;
  (target: Page, message?: string): PageExpect;
  (target: unknown, message?: string): GenericExpect;
}

export type Expect = ExpectFn;

// ───────────────────────────────────────────────────────────────────────────
// Runner-injected helper bag — kept loose. Refer to the runner source for the
// exact shape of each helper; the validator only needs the *name* to exist.
// ───────────────────────────────────────────────────────────────────────────

export interface StepLogger {
  log(message: string): void;
  warn(message: string): void;
  error?(message: string): void;
}

export type AppState = unknown;

export interface LocateWithFallback {
  (page: Page, primary: string, fallbacks?: string[]): Promise<Locator>;
}

export type FileUploadHelper = unknown;
export type ClipboardHelper = unknown;
export type DownloadsHelper = unknown;
export type NetworkHelper = unknown;
export type ReplayCursorPathFn = unknown;
export type FixturesMap = Record<string, unknown>;
export type StepReachedFn = (label: string) => void;
export type AssertionFn = (...args: unknown[]) => void;

// ───────────────────────────────────────────────────────────────────────────
// The test-function signature the runner injects code into.
// ───────────────────────────────────────────────────────────────────────────

export type TestFn = (
  page: Page,
  baseUrl: string,
  screenshotPath: string,
  stepLogger: StepLogger,
  expect: Expect,
  appState: AppState,
  locateWithFallback: LocateWithFallback,
  fileUpload: FileUploadHelper,
  clipboard: ClipboardHelper,
  downloads: DownloadsHelper,
  network: NetworkHelper,
  replayCursorPath: ReplayCursorPathFn,
  fixtures: FixturesMap,
  __stepReached: StepReachedFn,
  __assertion: AssertionFn,
) => Promise<void>;
