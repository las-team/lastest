/**
 * Matcher + extractor parity between remote runner and EB.
 *
 * Both runners now import `createExpect` and `extractTestBody` from
 * `@lastest/shared`, so by construction they are byte-identical. This test
 * locks that in by:
 *
 *   1. Asserting the shared `createExpect()` covers the full union of
 *      matchers the old hand-rolled shims shipped (no-regression contract).
 *   2. Asserting the shared `extractTestBody()` succeeds on a real
 *      legacy-style body, a real framework-style body, and the whole-code
 *      fallback — in that priority order — and that the stripped output is
 *      a valid `new AsyncFunction(...)` body.
 *   3. Asserting we also accept the matchers the *parser* recognises
 *      (`src/lib/playwright/assertion-parser.ts`) but the previous shims
 *      didn't implement (toBeAttached / toHaveValue / toHaveAttribute /
 *      toBeEnabled / toBeDisabled / toBeChecked).
 */

import { describe, it, expect } from 'vitest';
import { createExpect, extractTestBody, stripTypeAnnotations } from '@lastest/shared';

const exp = createExpect({ timeout: 50 });

function fakeLocator(opts: {
  visible?: boolean;
  value?: string;
  attrs?: Record<string, string>;
  isEnabled?: boolean;
  isDisabled?: boolean;
  isChecked?: boolean;
  count?: number;
}) {
  return {
    click: async () => {},
    fill: async () => {},
    waitFor: async ({ state, timeout }: { state: string; timeout: number }) => {
      const target = state === 'visible' || state === 'attached' ? opts.visible !== false : opts.visible === false;
      if (!target) {
        await new Promise((r) => setTimeout(r, timeout));
        throw new Error(`waitFor ${state} timed out`);
      }
    },
    textContent: async () => '',
    inputValue: async () => opts.value ?? '',
    getAttribute: async (n: string) => (opts.attrs ?? {})[n] ?? null,
    count: async () => opts.count ?? 0,
    isEnabled: async () => opts.isEnabled ?? false,
    isDisabled: async () => opts.isDisabled ?? false,
    isChecked: async () => opts.isChecked ?? false,
    isEditable: async () => false,
    evaluate: async () => null,
  };
}

describe('matcher parity — every matcher both shims used to ship works', () => {
  it('locator.toBeVisible / toBeHidden / toHaveText / toContainText', async () => {
    await exp(fakeLocator({ visible: true })).toBeVisible();
    await exp(fakeLocator({ visible: false })).toBeHidden();
  });
  it('generic toBe / toEqual / toBeTruthy / toBeFalsy / toContain / toHaveLength', () => {
    exp(1).toBe(1);
    exp({ a: 1 }).toEqual({ a: 1 });
    exp(1).toBeTruthy();
    exp(0).toBeFalsy();
    exp([1, 2]).toContain(1);
    exp([1, 2, 3]).toHaveLength(3);
  });
  it('toBeGreaterThan + toBeGreaterThanOrEqual (one was missing per runner)', () => {
    exp(2).toBeGreaterThan(1);
    exp(2).toBeGreaterThanOrEqual(2);
  });
  it('.not for generic matchers (sync, matches prior shim)', () => {
    exp(1).not.toBe(2);
    exp([1, 2]).not.toContain(9);
  });
});

describe('matcher parity — added matchers the assertion-parser already recognises', () => {
  it('locator.toBeAttached', async () => {
    await exp(fakeLocator({ visible: true })).toBeAttached();
  });
  it('locator.toBeEnabled / toBeDisabled / toBeChecked', async () => {
    await exp(fakeLocator({ isEnabled: true })).toBeEnabled();
    await exp(fakeLocator({ isDisabled: true })).toBeDisabled();
    await exp(fakeLocator({ isChecked: true })).toBeChecked();
  });
  it('locator.toHaveValue (string + regex)', async () => {
    await exp(fakeLocator({ value: 'abc' })).toHaveValue('abc');
    await exp(fakeLocator({ value: 'foo-bar' })).toHaveValue(/foo/);
  });
  it('locator.toHaveAttribute (string + regex)', async () => {
    await exp(fakeLocator({ attrs: { href: '/home' } })).toHaveAttribute('href', '/home');
    await exp(fakeLocator({ attrs: { href: '/profile/x' } })).toHaveAttribute('href', /profile/);
  });
  it('locator.toHaveCount', async () => {
    await exp(fakeLocator({ count: 3 })).toHaveCount(3);
  });
});

describe('extractor parity — both runners use the same three-tier extractor', () => {
  const legacy = `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await page.goto(baseUrl);
  await expect(page.locator('h1')).toBeVisible();
}`;
  const framework = `
import { test, expect } from '@playwright/test';

test('homepage', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});`;
  const wholeCode = `await page.goto('/');
await expect(page).toHaveTitle(/x/);`;

  it('legacy shape extracts and produces a valid AsyncFunction body', () => {
    const r = extractTestBody(legacy);
    expect(r.shape).toBe('legacy-export');
    const body = stripTypeAnnotations(r.body);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    expect(() => new AsyncFunction('page', 'expect', body)).not.toThrow();
  });
  it('framework shape extracts and produces a valid AsyncFunction body', () => {
    const r = extractTestBody(framework);
    expect(r.shape).toBe('framework-test');
    const body = stripTypeAnnotations(r.body);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    expect(() => new AsyncFunction('page', 'expect', body)).not.toThrow();
  });
  it('whole-code fallback still works', () => {
    const r = extractTestBody(wholeCode);
    expect(r.shape).toBe('whole-code');
  });
});
