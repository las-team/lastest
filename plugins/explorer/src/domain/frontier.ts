import type { PageMap } from "@lastest/page-map";

import { normalizeUrl } from "./state";

/**
 * Which same-origin link to explore next.
 *
 * Ranked rather than crawled breadth-first: labelled, shallow, nav-like paths
 * first, because those are where a real tester would go. Assets and already
 * visited states are dropped, and `logout` is dropped explicitly — following it
 * ends the session's authentication and every remaining iteration explores the
 * logged-out surface, which is the single most expensive wrong turn available.
 */
export function extractFrontierLinks(
  map: PageMap,
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
