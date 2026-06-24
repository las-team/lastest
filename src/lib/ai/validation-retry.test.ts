import { describe, it, expect, vi } from "vitest";
import {
  runValidationWithRetry,
  MAX_VALIDATION_RETRIES,
} from "./validation-retry";

describe("runValidationWithRetry", () => {
  it("returns valid immediately when first code passes", async () => {
    const goodCode = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await page.goto(baseUrl);
      }
    `;
    const regen = vi.fn();
    const result = await runValidationWithRetry(goodCode, regen);
    expect(result.valid).toBe(true);
    expect(regen).not.toHaveBeenCalled();
  });

  it("retries on validation failure and accepts the fixed code", async () => {
    const badCode = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await page.fooBar('nope');
      }
    `;
    const goodCode = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await page.goto(baseUrl);
      }
    `;
    const regen = vi.fn().mockResolvedValueOnce(goodCode);
    const result = await runValidationWithRetry(badCode, regen);
    expect(result.valid).toBe(true);
    expect(regen).toHaveBeenCalledTimes(1);
  });

  it("gives up after MAX_VALIDATION_RETRIES and returns last feedback", async () => {
    const badCode = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await page.fooBar('nope');
      }
    `;
    const stillBadCode = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await page.barBaz('still nope');
      }
    `;
    const regen = vi.fn().mockResolvedValue(stillBadCode);
    const result = await runValidationWithRetry(badCode, regen);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.feedback).toBeTruthy();
    }
    expect(regen).toHaveBeenCalledTimes(MAX_VALIDATION_RETRIES);
  });

  it("passes the feedback string into each regenerate call", async () => {
    const badCode = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await page.fooBar('nope');
      }
    `;
    const regen = vi.fn().mockResolvedValue(badCode);
    await runValidationWithRetry(badCode, regen);
    expect(regen).toHaveBeenCalled();
    const [feedback, attempt] = regen.mock.calls[0];
    expect(typeof feedback).toBe("string");
    expect(feedback.length).toBeGreaterThan(0);
    expect(attempt).toBe(1);
  });

  it("honors a custom maxRetries override", async () => {
    const badCode = `
      export async function test(page, baseUrl, screenshotPath, stepLogger) {
        await page.fooBar('nope');
      }
    `;
    const regen = vi.fn().mockResolvedValue(badCode);
    await runValidationWithRetry(badCode, regen, { maxRetries: 0 });
    expect(regen).not.toHaveBeenCalled();
  });
});
