/**
 * Sitemap.xml fetcher for the App Map — pulls a target app's declared page URLs
 * from `${baseUrl}/sitemap.xml`, following sitemap-index recursion.
 *
 * All outbound fetches go through the SSRF guard (`safeOutboundFetch`), so a
 * localhost/private/dev base URL is refused and we degrade to an empty list
 * rather than throwing into a server-component render.
 *
 * Parsing is a deliberately small regex over `<loc>` elements — the sitemaps
 * protocol subset we need is well-formed and this avoids adding an XML dep.
 */

import {
  safeOutboundFetch,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";

export interface FetchSitemapOptions {
  /** Source IP for the SSRF allowlist, if known. */
  sourceIp?: string;
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

async function fetchXml(
  url: string,
  opts: FetchSitemapOptions,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await safeOutboundFetch(
      url,
      {
        headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.5" },
        signal: controller.signal,
      },
      { sourceIp: opts.sourceIp },
    );
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    // SSRF-blocked (dev/localhost/private) or network/timeout — degrade silently.
    if (err instanceof SsrfBlockedError) return null;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the de-duplicated absolute page URLs declared in the app's sitemap.
 * Never throws — returns `[]` on any error, empty base, or blocked host.
 */
export async function fetchSitemapUrls(
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

    const xml = await fetchXml(url, opts);
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
