import { chromium, type Browser } from "playwright";

/**
 * Inject a captured storage_state (cookies + localStorage) into the EB's default
 * browser context over CDP, so the next agent phase starts already-signed-in.
 * This removes LLM/deterministic login replays when a session was already
 * captured moments earlier.
 *
 * Targets `browser.contexts()[0]` — the persistent default context that
 * `@playwright/mcp --cdp-endpoint` reuses — NOT a fresh `newContext` (which MCP
 * would never see). `browser.close()` over connectOverCDP only disconnects the
 * CDP session; it does not terminate the EB's Chromium (mirrors play-agent.ts).
 *
 * Returns whether enough session material (cookies and/or localStorage) was
 * injected to consider the browser pre-authenticated. IndexedDB-only captures
 * (e.g. Firebase) inject nothing here → caller falls back to seed replay.
 */
export async function injectStorageStateIntoEb(
  cdpUrl: string,
  storageStateJson: string,
): Promise<boolean> {
  let browser: Browser | null = null;
  try {
    const parsed = JSON.parse(storageStateJson) as {
      cookies?: Array<Record<string, unknown>>;
      origins?: Array<{
        origin?: string;
        localStorage?: Array<{ name: string; value: string }>;
      }>;
    };
    const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
    const origins = Array.isArray(parsed.origins) ? parsed.origins : [];
    const hasLocalStorage = origins.some(
      (o) => Array.isArray(o.localStorage) && o.localStorage.length > 0,
    );
    // Nothing cookie/localStorage-shaped to inject (e.g. IndexedDB-only Firebase
    // capture) — let the caller fall back to LLM seed replay.
    if (cookies.length === 0 && !hasLocalStorage) return false;

    browser = await chromium.connectOverCDP(cdpUrl);
    const ctx = browser.contexts()[0];
    if (!ctx) return false;

    if (cookies.length > 0) {
      // Cookies come straight from Playwright's own storageState() capture, so
      // they already match addCookies' param shape — route through `unknown` to
      // satisfy the structural check on the loosely-parsed JSON.
      await ctx.addCookies(
        cookies as unknown as Parameters<typeof ctx.addCookies>[0],
      );
    }
    for (const o of origins) {
      const ls = Array.isArray(o.localStorage) ? o.localStorage : [];
      if (!o.origin || ls.length === 0) continue;
      const page = await ctx.newPage();
      try {
        await page
          .goto(o.origin, { waitUntil: "domcontentloaded", timeout: 10000 })
          .catch(() => {});
        await page.evaluate((items) => {
          for (const it of items) {
            try {
              window.localStorage.setItem(it.name, it.value);
            } catch {
              /* quota / opaque origin — best effort */
            }
          }
        }, ls);
      } finally {
        await page.close().catch(() => {});
      }
    }
    return true;
  } catch (err) {
    console.warn(
      `[EB storage-state] injection failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
