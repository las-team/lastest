/**
 * Sitemap.xml fetcher for the App Map — pulls a target app's declared page URLs
 * from `${baseUrl}/sitemap.xml`, following sitemap-index recursion.
 *
 * All outbound fetches go through the SSRF guard, so a localhost/private/dev
 * base URL is refused and we degrade to an empty list rather than throwing
 * into a server-component render. The guard itself is **not** in this package:
 * it arrives as `AppMapHost.fetchSitemapXml`, because an SSRF check is a
 * security boundary and `docs/architecture/core-scope.md` §2 puts those in
 * core. What is left here is the parsing and the index-recursion — pure, and
 * the plugin's to own.
 *
 * Parsing is a deliberately small regex over `<loc>` elements — the sitemaps
 * protocol subset we need is well-formed and this avoids adding an XML dep.
 */

import type { AppMapHost } from "./host";

export interface FetchSitemapOptions {
  /** Cap on total URLs collected across the index tree. Default 500. */
  maxUrls?: number;
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** How deep to recurse through sitemap-index files. Default 2. */
  maxDepth?: number;
}

const LOC_RE = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    );
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml)) !== null) {
    const loc = decodeXmlEntities(m[1]!.trim());
    if (loc) out.push(loc);
  }
  return out;
}

/**
 * Returns the de-duplicated absolute page URLs declared in the app's sitemap.
 * Never throws — returns `[]` on any error, empty base, or blocked host. The
 * "blocked host" half of that promise is `host.fetchSitemapXml`'s to keep.
 */
export async function fetchSitemapUrls(
  host: AppMapHost,
  baseUrl: string,
  opts: FetchSitemapOptions = {},
): Promise<string[]> {
  if (!baseUrl) return [];

  let sitemapUrl: string;
  try {
    sitemapUrl = new URL("/sitemap.xml", baseUrl).toString();
  } catch {
    return [];
  }

  const maxUrls = opts.maxUrls ?? 500;
  const maxDepth = opts.maxDepth ?? 2;
  const seen = new Set<string>();
  const pages = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [
    { url: sitemapUrl, depth: 0 },
  ];

  while (queue.length > 0 && pages.size < maxUrls) {
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const xml = await host.fetchSitemapXml(url, {
      timeoutMs: opts.timeoutMs ?? 5000,
    });
    if (!xml) continue;

    const isIndex = /<sitemapindex[\s>]/i.test(xml);
    const locs = extractLocs(xml);

    if (isIndex) {
      if (depth >= maxDepth) continue;
      for (const child of locs) {
        if (!seen.has(child)) queue.push({ url: child, depth: depth + 1 });
      }
    } else {
      for (const loc of locs) {
        if (pages.size >= maxUrls) break;
        pages.add(loc);
      }
    }
  }

  return [...pages];
}
