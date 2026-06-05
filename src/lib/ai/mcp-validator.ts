import { chromium, Browser, Page } from "playwright";

export interface SelectorValidationResult {
  selector: string;
  valid: boolean;
  error?: string;
  matchCount?: number;
}

export interface MCPValidationResult {
  valid: boolean;
  results: SelectorValidationResult[];
  pageError?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Selector extraction.
//
// Walks every `.locator(...)`, `.getByRole(...)`, `.filter(...)`, etc. call in
// the source — not just top-level `page.X` — so chained locators like
//   page.locator('section').filter({ hasText: /…/ }).getByRole('link', { name })
// surface each segment as its own queryable selector. This is what lets the
// page-snapshot validator pinpoint that the `<section>` ancestor doesn't exist
// even when the leaf `role=link[name=…]` would have matched on its own.
// ───────────────────────────────────────────────────────────────────────────

interface ChainSegment {
  /** Method name e.g. "locator", "getByRole" */
  method: string;
  /** Raw arguments string between parens, for error reporting */
  args: string;
  /** Playwright-engine selector string this segment translates to */
  selector: string;
}

const SEGMENT_RE =
  /\.(locator|filter|getByRole|getByTestId|getByText|getByLabel|getByPlaceholder|getByTitle|getByAltText)\(((?:[^()]|\([^()]*\))*)\)/g;

const STRING_ARG_RE = /^['"`]([^'"`]+)['"`]/;
const NAME_OPT_RE = /name:\s*['"`]([^'"`]+)['"`]/;
const HAS_TEXT_OPT_RE = /hasText:\s*(?:['"`]([^'"`]+)['"`]|\/([^/]+)\/)/;

function segmentToSelector(method: string, args: string): string | null {
  const trimmed = args.trim();
  switch (method) {
    case "locator": {
      const m = trimmed.match(STRING_ARG_RE);
      return m ? m[1] : null;
    }
    case "getByRole": {
      const role = trimmed.match(STRING_ARG_RE);
      if (!role) return null;
      const name = trimmed.match(NAME_OPT_RE);
      return name ? `role=${role[1]}[name="${name[1]}"]` : `role=${role[1]}`;
    }
    case "getByTestId": {
      const m = trimmed.match(STRING_ARG_RE);
      return m ? `[data-testid="${m[1]}"]` : null;
    }
    case "getByText": {
      const m = trimmed.match(STRING_ARG_RE);
      return m ? `text=${m[1]}` : null;
    }
    case "getByLabel": {
      const m = trimmed.match(STRING_ARG_RE);
      return m ? `internal:label=${JSON.stringify(m[1])}i` : null;
    }
    case "getByPlaceholder": {
      const m = trimmed.match(STRING_ARG_RE);
      return m ? `[placeholder="${m[1]}"]` : null;
    }
    case "getByTitle": {
      const m = trimmed.match(STRING_ARG_RE);
      return m ? `[title="${m[1]}"]` : null;
    }
    case "getByAltText": {
      const m = trimmed.match(STRING_ARG_RE);
      return m ? `[alt="${m[1]}"]` : null;
    }
    case "filter": {
      const m = trimmed.match(HAS_TEXT_OPT_RE);
      if (m) return `internal:has-text=${JSON.stringify(m[1] ?? m[2])}i`;
      return null;
    }
    default:
      return null;
  }
}

/**
 * Public legacy API — returns the flat list of selector strings, deduped.
 * Preserved for callers that only want a quick reachability check per selector
 * regardless of chain context. Internally walks chained calls now, so
 * `page.locator('section').filter({hasText:'X'}).getByRole('link',{name:'Y'})`
 * yields three entries: `section`, `internal:has-text="X"i`, and
 * `role=link[name="Y"]`.
 */
export function extractSelectors(code: string): string[] {
  const selectors: string[] = [];
  let match;
  const re = new RegExp(SEGMENT_RE.source, "g");
  while ((match = re.exec(code)) !== null) {
    const sel = segmentToSelector(match[1], match[2]);
    if (sel) selectors.push(sel);
  }
  // Also keep the `page.$('...')`/`waitForSelector('...')` forms the AI sometimes emits.
  const extraRe = /(?:page\.\$\$?|waitForSelector)\(['"`]([^'"`]+)['"`]\)/g;
  while ((match = extraRe.exec(code)) !== null) {
    selectors.push(match[1]);
  }
  return [...new Set(selectors)];
}

/**
 * Returns each *full* locator chain found in the source so the page-snapshot
 * validator can verify the whole chain resolves to ≥1 element — which is the
 * surface that catches "ancestor doesn't exist" failures like the
 * marktolmacs.com `<section>` case.
 */
export function extractLocatorChains(
  code: string,
): { chain: string; selector: string; segments: ChainSegment[] }[] {
  const chains: {
    chain: string;
    selector: string;
    segments: ChainSegment[];
  }[] = [];

  // Walk each line; collect runs of consecutive segment matches that form a
  // single chain starting from `page` (or a bare-locator variable assignment).
  // We greedily merge segments whose offsets are contiguous in the source.
  const segs: {
    method: string;
    args: string;
    selector: string;
    start: number;
    end: number;
  }[] = [];
  const re = new RegExp(SEGMENT_RE.source, "g");
  let m;
  while ((m = re.exec(code)) !== null) {
    const sel = segmentToSelector(m[1], m[2]);
    if (!sel) continue;
    segs.push({
      method: m[1],
      args: m[2],
      selector: sel,
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  // Group contiguous segments into chains. A segment continues a chain when it
  // begins exactly where the previous segment ended (no whitespace/operator
  // separation), which is how `.locator(...).filter(...).getByRole(...)` looks.
  let currentGroup: typeof segs = [];
  for (const seg of segs) {
    if (
      currentGroup.length === 0 ||
      seg.start === currentGroup[currentGroup.length - 1].end
    ) {
      currentGroup.push(seg);
    } else {
      if (currentGroup.length > 0) flush(currentGroup, code, chains);
      currentGroup = [seg];
    }
  }
  if (currentGroup.length > 0) flush(currentGroup, code, chains);

  // Dedupe by composite selector string.
  const seen = new Set<string>();
  return chains.filter((c) => {
    if (seen.has(c.selector)) return false;
    seen.add(c.selector);
    return true;
  });
}

function flush(
  group: {
    method: string;
    args: string;
    selector: string;
    start: number;
    end: number;
  }[],
  code: string,
  out: { chain: string; selector: string; segments: ChainSegment[] }[],
): void {
  const segments: ChainSegment[] = group.map((s) => ({
    method: s.method,
    args: s.args,
    selector: s.selector,
  }));
  const composite = segments.map((s) => s.selector).join(" >> ");
  const chainSource = code.slice(group[0].start, group[group.length - 1].end);
  out.push({ chain: chainSource, selector: composite, segments });
}

// Convert Playwright-engine selector strings into something `page.locator(...)`
// understands. Most strings produced by `segmentToSelector` are already valid
// Playwright engine syntax (role=, text=, [attr=…], internal:has-text=, …) —
// only bare tag-like identifiers need wrapping in a CSS selector to disambiguate
// them from a default text-engine match.
function convertToQueryableSelector(selector: string): string {
  // Already a Playwright engine selector — pass through.
  if (/^(role|text|css|xpath|internal:)/i.test(selector)) return selector;
  // Bracket / class / id selectors are valid CSS — pass through.
  if (
    selector.startsWith("[") ||
    selector.startsWith(".") ||
    selector.startsWith("#")
  ) {
    return selector;
  }
  // Anything that looks like a tag name (`section`, `header`, etc.) stays as CSS.
  if (/^[a-z][a-z0-9-]*$/i.test(selector)) return selector;
  return selector;
}

export async function validateSelectorsOnPage(
  pageUrl: string,
  selectors: string[],
): Promise<MCPValidationResult> {
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 30000 });

    const results: SelectorValidationResult[] = [];

    for (const selector of selectors) {
      try {
        // Skip URL-like patterns (from goto)
        if (selector.startsWith("http") || selector.startsWith("/")) {
          continue;
        }

        const queryableSelector = convertToQueryableSelector(selector);

        // Use page.locator(...).count() so we accept the full Playwright engine
        // syntax (role=…, text=…, internal:has-text=…) — page.$$() only takes CSS.
        const matchCount = await page.locator(queryableSelector).count();

        results.push({
          selector,
          valid: matchCount > 0,
          matchCount,
        });
      } catch (error) {
        results.push({
          selector,
          valid: false,
          error: error instanceof Error ? error.message : "Invalid selector",
        });
      }
    }

    const valid = results.every((r) => r.valid);

    return { valid, results };
  } catch (error) {
    return {
      valid: false,
      results: [],
      pageError: error instanceof Error ? error.message : "Failed to load page",
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Like `validateSelectorsOnPage` but takes whole locator chains (from
 * `extractLocatorChains`) and reports per-chain how many elements the *full*
 * chain resolves to. Also re-checks each constituent segment so callers can
 * pinpoint which segment in the chain is the bad one (the marktolmacs.com
 * `<section>` ancestor case).
 */
export async function validateLocatorChainsOnPage(
  pageUrl: string,
  chains: {
    chain: string;
    selector: string;
    segments: { method: string; args: string; selector: string }[];
  }[],
): Promise<MCPValidationResult> {
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 30000 });

    const results: SelectorValidationResult[] = [];

    for (const c of chains) {
      // Test the full chain selector first.
      try {
        const wholeCount = await page
          .locator(convertToQueryableSelector(c.selector))
          .count();
        results.push({
          selector: c.chain,
          valid: wholeCount > 0,
          matchCount: wholeCount,
        });
        if (wholeCount > 0) continue; // chain works — skip per-segment forensics
      } catch (err) {
        results.push({
          selector: c.chain,
          valid: false,
          error: err instanceof Error ? err.message : "Invalid locator chain",
        });
      }

      // If the whole chain didn't match, drill in: which segment is empty?
      for (const seg of c.segments) {
        try {
          const segCount = await page
            .locator(convertToQueryableSelector(seg.selector))
            .count();
          results.push({
            selector: `  └─ ${seg.method}(${seg.args}) → ${seg.selector}`,
            valid: segCount > 0,
            matchCount: segCount,
          });
        } catch (err) {
          results.push({
            selector: `  └─ ${seg.method}(${seg.args}) → ${seg.selector}`,
            valid: false,
            error:
              err instanceof Error ? err.message : "Invalid segment selector",
          });
        }
      }
    }

    const valid = results.every((r) => r.valid);
    return { valid, results };
  } catch (error) {
    return {
      valid: false,
      results: [],
      pageError: error instanceof Error ? error.message : "Failed to load page",
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

export function formatValidationFeedback(result: MCPValidationResult): string {
  if (result.pageError) {
    return `Failed to load page: ${result.pageError}`;
  }

  if (result.valid) {
    return "All selectors are valid.";
  }

  const invalidSelectors = result.results
    .filter((r) => !r.valid)
    .map((r) => `- "${r.selector}": ${r.error || "No matching elements found"}`)
    .join("\n");

  return `The following selectors are invalid:\n${invalidSelectors}\n\nPlease update the test code to use valid selectors.`;
}
