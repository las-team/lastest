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
      if (!m) return null;
      // `hasText` has two forms with DIFFERENT Playwright matching semantics:
      //   • string  → matched against whitespace-NORMALIZED text (newlines/indent collapsed)
      //   • RegExp  → matched against RAW, non-normalized textContent
      // m[1] is the string branch, m[2] the regex-body branch. Coercing a regex
      // into a quoted literal (the old `m[1] ?? m[2]` path) both mis-modelled
      // runtime matching AND false-rejected valid regexes — e.g. /A.*B/ over text
      // split across block elements. Emit the slash form for the regex branch so
      // the reachability check runs the actual regex against raw text.
      if (m[2] !== undefined) return `internal:has-text=/${m[2]}/i`;
      return `internal:has-text=${JSON.stringify(m[1])}i`;
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
