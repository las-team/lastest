import { describe, it, expect } from 'vitest';
import { extractTestBody } from './extract-test-body';

describe('extractTestBody — tier 1 legacy', () => {
  it('extracts body from export async function test', () => {
    const code = `export async function test(page, baseUrl, screenshotPath, stepLogger) {
      await page.goto(baseUrl);
      await page.screenshot({ path: screenshotPath });
    }`;
    const r = extractTestBody(code);
    expect(r.shape).toBe('legacy-export');
    expect(r.body).toContain("await page.goto(baseUrl)");
    expect(r.body).toContain("await page.screenshot");
  });

  it('extracts body from export async function setup when allowSetup', () => {
    const code = `export async function setup(page) { await page.goto('/login'); }`;
    const r = extractTestBody(code, { allowSetup: true });
    expect(r.shape).toBe('legacy-export');
    expect(r.body).toContain("await page.goto('/login')");
  });

  it('does NOT extract setup when allowSetup is false', () => {
    const code = `export async function setup(page) { await page.goto('/login'); }`;
    const r = extractTestBody(code);
    expect(r.shape).toBe('whole-code');
  });
});

describe('extractTestBody — tier 2 framework', () => {
  it('extracts body from test("name", async ({ page }) => {...})', () => {
    const code = `
import { test, expect } from '@playwright/test';
test('homepage loads', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});`;
    const r = extractTestBody(code);
    expect(r.shape).toBe('framework-test');
    expect(r.body).toContain("await page.goto('https://example.com')");
    expect(r.body).toContain('await expect(page).toHaveTitle');
  });

  it('handles destructured { page, context, request }', () => {
    const code = `test('multi', async ({ page, context, request }) => {
      await page.goto('/');
    });`;
    const r = extractTestBody(code);
    expect(r.shape).toBe('framework-test');
    expect(r.body).toContain('const context = page.context();');
    expect(r.body).toContain('const request = undefined');
    expect(r.body).toContain("await page.goto('/')");
  });

  it('handles tag-object 2nd arg', () => {
    const code = `test('smoke', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/x');
    });`;
    const r = extractTestBody(code);
    expect(r.shape).toBe('framework-test');
    expect(r.body).toContain("await page.goto('/x')");
  });

  it('handles test.only / test.skip', () => {
    const code = `test.only('iso', async ({ page }) => { await page.click('a'); });`;
    const r = extractTestBody(code);
    expect(r.shape).toBe('framework-test');
    expect(r.body).toContain("await page.click('a')");
  });

  it('survives braces inside the body', () => {
    const code = `test('nested', async ({ page }) => {
      const x = { a: 1, b: { c: 2 } };
      await page.evaluate(() => { return { ok: true }; });
    });`;
    const r = extractTestBody(code);
    expect(r.shape).toBe('framework-test');
    expect(r.body).toContain('const x = { a: 1, b: { c: 2 } }');
    expect(r.body).toContain('await page.evaluate');
  });
});

describe('extractTestBody — tier 3 whole-code fallback', () => {
  it('returns the whole code when no wrapper matches', () => {
    const code = `await page.goto('/');
await page.screenshot({ path: screenshotPath });`;
    const r = extractTestBody(code);
    expect(r.shape).toBe('whole-code');
    expect(r.body).toBe(code);
  });
});

describe('extractTestBody — tier ordering (no regression)', () => {
  it('prefers legacy when both shapes are present', () => {
    const code = `
test('framework one', async ({ page }) => { await page.click('a'); });
export async function test(page) {
  await page.goto('/legacy');
}`;
    const r = extractTestBody(code);
    expect(r.shape).toBe('legacy-export');
    expect(r.body).toContain("await page.goto('/legacy')");
  });
});
