import { pageMapScript, headingsScript, type PageMap } from "@lastest/page-map";

import { hashState, headingsDigest, normalizeUrl } from "../domain/state";
import { gotoAndSettle, type ExplorerPage } from "./page";

/**
 * Explorer research phase: observe the current page.
 *
 * This used to call `browsePageMap(cdpUrl, url)` in `@/lib/playwright/ranger` —
 * a cross-plugin import that also carried a CDP connection with it. Both halves
 * are gone: the DOM extraction is now `@lastest/page-map` (shared, gate-free),
 * and the connection is core's, so this function takes a page it was handed
 * rather than one it opened.
 */

export interface ResearchResult {
  pageMap: PageMap;
  stateHash: string;
  normalizedUrl: string;
  headingsDigest: string;
  headings: string[];
}

export async function researchPage(
  page: ExplorerPage,
  url: string,
): Promise<ResearchResult> {
  await gotoAndSettle(page, url, 8_000);
  const extracted = await page.evaluate(pageMapScript);
  const pageMap: PageMap = {
    url,
    ...extracted,
    note: "Rendered DOM via Embedded Browser (SPA content included).",
  };

  const headings = pageMap.headings.filter((h) => h.level <= 2);
  return {
    pageMap,
    stateHash: hashState(pageMap.finalUrl || url, pageMap.headings),
    normalizedUrl: normalizeUrl(pageMap.finalUrl || url),
    headingsDigest: headingsDigest(pageMap.headings),
    headings: headings.map((h) => h.text).slice(0, 8),
  };
}

/** The page-state hash of wherever a page currently is. */
export async function currentStateHash(page: ExplorerPage): Promise<string> {
  const headings = await page
    .evaluate(headingsScript)
    .catch(() => [] as Array<{ level: number; text: string }>);
  return hashState(page.url(), headings);
}
