import type { DrivablePage } from "@lastest/contracts";
import { pageMapScript, type PageMap } from "@lastest/page-map";

/**
 * What ranger does with the page core hands it.
 *
 * The old `src/lib/playwright/ranger.ts` connected to the EB over CDP itself
 * — one of the six direct-CDP call sites RFC §1.1 opened with. That is gone:
 * core made the connection (`ctx.browser.withBrowser`), owns closing it, and
 * hands this function a live page. What is left is the part that was always
 * ranger's — navigate, let the SPA settle, and extract a structured map of
 * the rendered DOM so JS-only content is included (unlike the static
 * `scout`). No AI is involved; this is pure observation.
 *
 * `DrivablePage` resolves to Playwright's real `Page` for any build compiled
 * alongside `@lastest/core-browser` (every build of this repo) — see
 * `plugins/explorer/src/browser/page.ts` for the mechanism. Without it the
 * slot is `unknown`, which fails closed rather than silently degrading.
 */
export type RangerPage = DrivablePage;

export async function browsePageMap(
  page: RangerPage,
  url: string,
  viewport?: { width: number; height: number },
): Promise<PageMap> {
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
}
