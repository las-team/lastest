import { describe, it, expect } from "vitest";
import {
  validateTestAgainstRunnerAPI,
  formatTSDiagnostics,
} from "./validate-test-against-api";

describe("validateTestAgainstRunnerAPI", () => {
  it("accepts the marktolmacs.com chain — static check intentionally ignores DOM existence", () => {
    // This is the exact AI-generated locator chain that timed out in prod
    // (page.locator('section').filter(...).getByRole(...)). It IS valid
    // Playwright API; the failure was at runtime because <section> wasn't on
    // the page. The TS check must not falsely reject it — that's the page-
    // snapshot validator's job.
    const code = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await page.goto(baseUrl);
        await page.locator('section')
          .filter({ hasText: /Welcome.*I'm Mark Tolmacs/ })
          .getByRole('link', { name: 'Request a free consultation' })
          .click();
      }
    `;
    expect(validateTestAgainstRunnerAPI(code)).toEqual({ valid: true });
  });

  it("accepts a basic well-formed test", () => {
    const code = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await page.goto(baseUrl);
        await expect(page).toHaveURL(/\\/foo/);
        await page.getByRole('button', { name: 'Submit' }).click();
        await expect(page.getByRole('heading')).toBeVisible();
      }
    `;
    expect(validateTestAgainstRunnerAPI(code)).toEqual({ valid: true });
  });

  it("accepts new matchers added in af056db (toHaveAttribute on locator)", () => {
    const code = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        const link = page.getByRole('link', { name: 'Home' });
        await expect(link).toHaveAttribute('href', '/');
      }
    `;
    expect(validateTestAgainstRunnerAPI(code)).toEqual({ valid: true });
  });

  it("rejects unsupported matchers like toHaveFakeMatcher", () => {
    const code = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await expect(page).toHaveFakeMatcher('nope');
      }
    `;
    const result = validateTestAgainstRunnerAPI(code);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => /toHaveFakeMatcher/.test(e.message)),
      ).toBe(true);
    }
  });

  it("rejects unknown page methods", () => {
    const code = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await page.fooBar('hello');
      }
    `;
    const result = validateTestAgainstRunnerAPI(code);
    expect(result.valid).toBe(false);
  });

  it("rejects references to names not in the runner variable bag", () => {
    // `request` is NOT in the injected variable bag — the AI sometimes
    // imagines it exists because @playwright/test's full fixture object has
    // it. Our runner does not.
    const code = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        const r = await request.get(baseUrl);
        await r.json();
      }
    `;
    const result = validateTestAgainstRunnerAPI(code);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /request/.test(e.message))).toBe(true);
    }
  });

  it("accepts all variables in the runner injection bag", () => {
    // These are the 15 names listed in packages/embedded-browser/src/test-executor.ts:1204
    // and packages/runner/src/runner.ts:1374. Each must be a known parameter.
    const code = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        void page; void baseUrl; void screenshotPath; void stepLogger;
        void expect; void appState; void locateWithFallback; void fileUpload;
        void clipboard; void downloads; void network; void replayCursorPath;
        void fixtures; void __stepReached; void __assertion;
      }
    `;
    expect(validateTestAgainstRunnerAPI(code)).toEqual({ valid: true });
  });

  it("formatTSDiagnostics produces LLM-readable feedback", () => {
    const fb = formatTSDiagnostics([
      {
        line: 4,
        column: 12,
        code: 2339,
        message:
          "Property 'toHaveFakeMatcher' does not exist on type 'LocatorMatchers'.",
      },
    ]);
    expect(fb).toContain("line 4");
    expect(fb).toContain("TS2339");
    expect(fb).toContain("toHaveFakeMatcher");
  });
});
