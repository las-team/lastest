/**
 * Static, no-browser URL scout used by POST /api/v1/scout (exposed over MCP as
 * `lastest_scout_url`). Fetches a page's HTML and extracts a best-effort map —
 * title, headings, forms, inputs, links, and candidate selectors — to give an
 * AI agent a starting point for authoring a test when it has no live browser.
 *
 * This intentionally does NOT render JavaScript, so SPA-built DOM won't appear;
 * the MCP-first guidance tells agents to prefer their own Playwright MCP for
 * live pages and treat this as a fallback / quick map. SSRF is guarded by the
 * caller (validateTargetUrl) before this runs.
 */

export interface StaticScoutResult {
  url: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  headings: string[];
  forms: Array<{
    method: string;
    action: string | null;
    inputs: Array<{
      tag: string;
      type: string | null;
      name: string | null;
      id: string | null;
      placeholder: string | null;
      label: string | null;
    }>;
  }>;
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  testIds: string[];
  candidateSelectors: string[];
  note: string;
}

const MAX_BYTES = 800_000; // cap the HTML we parse
const FETCH_TIMEOUT_MS = 10_000;

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripTags(s: string): string {
  return decode(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(
    new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  if (!m) return null;
  return decode(m[2] ?? m[3] ?? m[4] ?? "");
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

export async function scoutUrlStatic(url: string): Promise<StaticScoutResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "LastestScout/1.0 (+https://github.com/las-team/lastest)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Target returned HTTP ${res.status}`);
  }

  // Read at most MAX_BYTES so a huge page can't blow up memory.
  const reader = res.body?.getReader();
  let html = "";
  if (reader) {
    const decoder = new TextDecoder();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (total >= MAX_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } else {
    html = (await res.text()).slice(0, MAX_BYTES);
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);

  const headings = uniq(
    [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
      .map((m) => stripTags(m[1]))
      .filter((t) => t.length > 0),
  ).slice(0, 30);

  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)]
    .slice(0, 10)
    .map((m) => {
      const open = `<form ${m[1]}>`;
      const inner = m[2];
      const inputs = [...inner.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)]
        .slice(0, 30)
        .map((im) => {
          const tag = im[0];
          return {
            tag: im[1].toLowerCase(),
            type: attr(tag, "type"),
            name: attr(tag, "name"),
            id: attr(tag, "id"),
            placeholder: attr(tag, "placeholder"),
            label: attr(tag, "aria-label"),
          };
        });
      return {
        method: (attr(open, "method") ?? "get").toLowerCase(),
        action: attr(open, "action"),
        inputs,
      };
    });

  const buttons = uniq([
    ...[...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((m) =>
      stripTags(m[1]),
    ),
    ...[...html.matchAll(/<input\b[^>]*type=["'](?:submit|button)["'][^>]*>/gi)]
      .map((m) => attr(m[0], "value") ?? "")
      .filter(Boolean),
  ]).slice(0, 30);

  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({
      text: stripTags(m[2]),
      href: attr(`<a ${m[1]}>`, "href") ?? "",
    }))
    .filter((l) => l.href && !l.href.startsWith("javascript:"))
    .slice(0, 60);

  const testIds = uniq(
    [...html.matchAll(/data-testid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
  ).slice(0, 40);

  const ids = uniq(
    [...html.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
  ).slice(0, 40);

  const candidateSelectors = uniq([
    ...testIds.map((t) => `getByTestId('${t}')`),
    ...ids.slice(0, 20).map((i) => `#${i}`),
    ...buttons
      .slice(0, 10)
      .map((b) => `getByRole('button', { name: /${escapeRe(b)}/i })`),
  ]).slice(0, 50);

  return {
    url,
    finalUrl: res.url || url,
    title: title ? stripTags(title[1]) : null,
    description: desc ? attr(desc[0], "content") : null,
    headings,
    forms,
    buttons,
    links,
    testIds,
    candidateSelectors,
    note: "Static HTML only — JS/SPA-rendered content is not included. Verify selectors on the live page with Playwright MCP where possible.",
  };
}

function escapeRe(s: string): string {
  return s.slice(0, 40).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
