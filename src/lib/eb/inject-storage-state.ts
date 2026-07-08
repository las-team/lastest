import { chromium, type Browser } from "playwright";

interface CapturedCookie {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * Inject a captured storage_state (cookies + localStorage) into the EB's live
 * page over CDP, so the next agent phase starts already-signed-in.
 *
 * IMPORTANT: Playwright's `context.addCookies()` is the WRONG tool here. The
 * EB's page lives in a non-default browser context (`browser.newContext()` in
 * the EB service); over `connectOverCDP`, `addCookies` writes to a cookie
 * store the page's network stack never reads — the cookie shows up in
 * `context.cookies()` but Chromium NEVER SENDS it (verified against a live EB
 * pod: `document.cookie` stays empty, requests carry no Cookie header).
 * A page-level CDP `Network.setCookie` writes to the page's real store and
 * authenticates immediately. Reads (`storageState()`) are unaffected.
 *
 * localStorage is set by driving the EB's OWN page to each origin — a
 * `context.newPage()` can land in a different context with a separate
 * storage bucket, same failure mode as the cookies.
 *
 * `browser.close()` over connectOverCDP only disconnects the CDP session; it
 * does not terminate the EB's Chromium (mirrors play-agent.ts).
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
      cookies?: CapturedCookie[];
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
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    let injected = false;
    if (cookies.length > 0) {
      const cdp = await ctx.newCDPSession(page);
      try {
        for (const c of cookies) {
          if (!c.name || typeof c.value !== "string") continue;
          const ok = await cdp
            .send("Network.setCookie", {
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path ?? "/",
              secure: c.secure,
              httpOnly: c.httpOnly,
              sameSite: c.sameSite,
              // -1 marks a session cookie in Playwright captures — omit so
              // CDP treats it as a session cookie instead of expired.
              ...(typeof c.expires === "number" && c.expires > 0
                ? { expires: Math.floor(c.expires) }
                : {}),
            })
            .then((r) => (r as { success?: boolean }).success !== false)
            .catch(() => false);
          injected = injected || ok;
        }
      } finally {
        await cdp.detach().catch(() => {});
      }
    }

    for (const o of origins) {
      const ls = Array.isArray(o.localStorage) ? o.localStorage : [];
      if (!o.origin || ls.length === 0) continue;
      try {
        await page.goto(o.origin, {
          waitUntil: "domcontentloaded",
          timeout: 10000,
        });
        await page.evaluate((items) => {
          for (const it of items) {
            try {
              window.localStorage.setItem(it.name, it.value);
            } catch {
              /* quota / opaque origin — best effort */
            }
          }
        }, ls);
        injected = true;
      } catch {
        // Best-effort per origin — cookies may already be enough.
      }
    }
    return injected;
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
