import { chromium } from "playwright";
import { pageMapScript, type PageMap } from "@lastest/page-map";

/**
 * Ranger: a deterministic, browser-backed page map. Connects to a provisioned
 * Embedded Browser over CDP, navigates to a URL, lets it render, and extracts a
 * structured map of the LIVE DOM (so SPA/JS content is included — unlike the
 * static `scout`). No AI is involved; this is pure observation. Because it
 * drives the EB's existing page/tab, the EB screencast shows the browse live,
 * which is what makes a ranger run watchable in the activity feed.
 *
 * The DOM extraction itself moved to `@lastest/page-map` when `explorer` became
 * a plugin: it needed the same map but may not import another feature's code.
 * What is left here is the part that is genuinely ranger's — connecting to an
 * EB over CDP and driving its existing tab.
 */

export type RangerPageMap = PageMap;

export async function browsePageMap(
  cdpUrl: string,
  url: string,
  viewport?: { width: number; height: number },
): Promise<RangerPageMap> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    if (viewport) await page.setViewportSize(viewport).catch(() => {});

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Give SPAs a moment to render past the initial HTML.
    await page
      .waitForLoadState("networkidle", { timeout: 8_000 })
      .catch(() => {});

    const map = await page.evaluate(pageMapScript);

    return {
      url,
      ...map,
      note: "Rendered DOM via Embedded Browser (SPA content included). Use these selectors as authoritative for authoring.",
    };
  } finally {
    // Disconnect the CDP client; the EB itself is released by the caller.
    await browser.close().catch(() => {});
  }
}
