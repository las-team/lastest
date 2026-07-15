import { browsePageMap, type RangerPageMap } from "@/lib/playwright/ranger";
import { hashState, headingsDigest, normalizeUrl } from "./state";

/**
 * Explorer research phase: observe the current page. Pure reuse of the ranger
 * page-map extraction (live rendered DOM over the EB's CDP endpoint) plus the
 * page-state identity the rest of the loop keys on.
 */

export interface ResearchResult {
  pageMap: RangerPageMap;
  stateHash: string;
  normalizedUrl: string;
  headingsDigest: string;
  headings: string[];
}

export async function researchPage(
  cdpUrl: string,
  url: string,
  viewport?: { width: number; height: number },
): Promise<ResearchResult> {
  const pageMap = await browsePageMap(cdpUrl, url, viewport);
  const headings = pageMap.headings.filter((h) => h.level <= 2);
  return {
    pageMap,
    stateHash: hashState(pageMap.finalUrl || url, pageMap.headings),
    normalizedUrl: normalizeUrl(pageMap.finalUrl || url),
    headingsDigest: headingsDigest(pageMap.headings),
    headings: headings.map((h) => h.text).slice(0, 8),
  };
}

/** Rank the page map's same-origin links for the exploration frontier:
 *  labeled, shallow, nav-like paths first; assets and visited states skipped.
 *  `visited` holds normalized URLs already explored. */
export function extractFrontierLinks(
  map: RangerPageMap,
  baseOrigin: string,
  visited: Set<string>,
  count = 5,
): string[] {
  const seen = new Set<string>();
  const candidates: Array<{ url: string; score: number }> = [];
  for (const link of map.links) {
    let url: URL;
    try {
      url = new URL(link.href, map.finalUrl || map.url);
    } catch {
      continue;
    }
    if (url.origin !== baseOrigin) continue;
    url.hash = "";
    const normalized = normalizeUrl(url.href);
    if (visited.has(normalized) || seen.has(normalized)) continue;
    if (/\.(png|jpe?g|svg|css|js|pdf|zip)(\?|$)/i.test(url.pathname)) continue;
    if (/\b(logout|signout|sign-out)\b/i.test(url.pathname)) continue;
    seen.add(normalized);
    const depth = url.pathname.split("/").filter(Boolean).length;
    const score = (link.text ? 0 : 5) + depth;
    candidates.push({ url: url.href, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, count).map((c) => c.url);
}

/** Condense a page map into the planner/tester prompt block. Caps every list
 *  so a huge page can't blow the prompt budget. */
export function condensePageMap(map: RangerPageMap): string {
  const lines: string[] = [
    `URL: ${map.finalUrl || map.url}`,
    `Title: ${map.title ?? "(none)"}`,
  ];
  if (map.headings.length > 0) {
    lines.push(
      `Headings: ${map.headings
        .slice(0, 10)
        .map((h) => `h${h.level} "${h.text.slice(0, 60)}"`)
        .join(", ")}`,
    );
  }
  for (const form of map.forms.slice(0, 6)) {
    const inputs = form.inputs
      .slice(0, 12)
      .map((i) => i.label || i.name || i.id || i.type || i.tag)
      .join(", ");
    lines.push(
      `Form${form.name ? ` "${form.name}"` : ""} (${form.method.toUpperCase()}${form.action ? ` ${form.action}` : ""}): ${inputs}`,
    );
  }
  if (map.buttons.length > 0) {
    lines.push(`Buttons: ${map.buttons.slice(0, 25).join(" | ")}`);
  }
  if (map.links.length > 0) {
    lines.push(
      `Links: ${map.links
        .slice(0, 30)
        .map((l) => `"${l.text.slice(0, 40)}"→${l.href.slice(0, 60)}`)
        .join(", ")}`,
    );
  }
  if (map.testIds.length > 0) {
    lines.push(`Test ids: ${map.testIds.slice(0, 30).join(", ")}`);
  }
  return lines.join("\n");
}
