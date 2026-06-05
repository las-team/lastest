import type { SelectorConfig, SelectorType } from "@/lib/db/schema";

/**
 * Static selector analysis for the "Analyze before record" flow.
 *
 * Given the raw HTML served at a target URL, estimate how well each selector
 * strategy is represented on the page so the recorder can promote strategies
 * the app actually uses and mute the ones it never does.
 *
 * Two numbers are tracked per strategy:
 *  - `counts` — raw occurrences of the attribute / element.
 *  - `uniqueCounts` — number of *distinct* values, which is what actually
 *    determines whether a selector can uniquely identify an element. A page
 *    with 50 buttons all labeled "Close" scores 50 on raw count but 1 on
 *    uniqueness, so ranking is driven by `uniqueCounts`.
 *
 * This is a regex-based scan of the *initial* HTML — it does not execute JS, so
 * heavily client-rendered apps return a near-empty shell. {@link isMeaningful}
 * guards against acting on such pages (we keep the existing config untouched).
 */

export interface SelectorCoverage {
  /** Total element open-tags found in the document. */
  totalElements: number;
  /** Interactive elements (buttons, links, inputs, selects, textareas). */
  interactiveElements: number;
  /** Per selector-type candidate counts (raw attribute/element occurrences). */
  counts: Record<SelectorType, number>;
  /**
   * Per selector-type *unique* candidate counts (distinct values). For
   * attribute-backed strategies, this is the number of distinct attribute
   * values; for text-backed strategies (text, label, heading-context), it's
   * the number of distinct inner-text strings. Universal fallbacks
   * (css-path, coords) mirror `counts`. Drives the ranking.
   */
  uniqueCounts: Record<SelectorType, number>;
}

// Selector types that are universal fallbacks — always usable regardless of
// what the page contains, so analysis never disables them.
const ALWAYS_ON: SelectorType[] = ["text", "css-path", "coords"];
// OCR cannot be detected from HTML; leave its enabled state untouched.
const PRESERVE: SelectorType[] = ["ocr-text"];
// Attribute/element-backed strategies whose usefulness we can actually measure.
const SPECIFIC: SelectorType[] = [
  "data-testid",
  "id",
  "role-name",
  "label",
  "heading-context",
  "aria-label",
  "placeholder",
  "name",
  "alt-text",
  "title",
];

// A page needs at least this many interactive elements before we trust the
// scan enough to reorder/disable strategies. Below it, the page is most likely
// a client-rendered shell and the initial HTML tells us nothing.
const MIN_INTERACTIVE_FOR_RECOMMENDATION = 3;

function countMatches(html: string, re: RegExp): number {
  const matches = html.match(re);
  return matches ? matches.length : 0;
}

/**
 * Extract the set of *values* for a given HTML attribute. Handles both
 * single- and double-quoted forms. Empty values are kept (they still
 * exist on the page and would still be matched by the recorder).
 */
function extractAttrValues(html: string, attrName: string): Set<string> {
  const safe = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\s${safe}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "gi");
  const values = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    values.add(m[2]);
  }
  return values;
}

/**
 * Extract the inner text of every occurrence of a tag (e.g. `button`, `a`,
 * `label`). Nested tags are stripped, whitespace is collapsed. Empty texts
 * are dropped — an empty-labeled button is invisible to text-based selectors.
 */
function extractTagInnerTexts(html: string, tagName: string): Set<string> {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "gi");
  const values = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) values.add(text);
  }
  return values;
}

/** Inner text of every `<h1>`–`<h6>`, with level-matched closing tag. */
function extractHeadingInnerTexts(html: string): Set<string> {
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const values = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) values.add(text);
  }
  return values;
}

function unionSize(...sets: Set<string>[]): number {
  const u = new Set<string>();
  for (const s of sets) for (const v of s) u.add(v);
  return u.size;
}

/**
 * Scan raw HTML and estimate per-strategy selector coverage.
 *
 * `customAttributeName` (e.g. `data-automation-id`) folds into the
 * `data-testid` bucket since the recorder treats a configured custom attribute
 * as the highest-priority test id.
 */
export function analyzeHtmlForSelectors(
  html: string,
  opts: { customAttributeName?: string | null } = {},
): SelectorCoverage {
  const buttons = countMatches(html, /<button[\s/>]/gi);
  const links = countMatches(html, /<a[\s/>]/gi);
  const inputs = countMatches(html, /<input[\s/>]/gi);
  const selects = countMatches(html, /<select[\s/>]/gi);
  const textareas = countMatches(html, /<textarea[\s/>]/gi);
  const labels = countMatches(html, /<label[\s/>]/gi);
  const headings = countMatches(html, /<h[1-6][\s/>]/gi);

  const totalElements = countMatches(html, /<[a-zA-Z][\w-]*/g);
  const interactiveElements = buttons + links + inputs + selects + textareas;

  const dataTestidRaw = countMatches(html, /\sdata-testid\s*=/gi);
  const customAttrName = opts.customAttributeName?.trim();
  const customAttrRaw = customAttrName
    ? countMatches(
        html,
        new RegExp(
          `\\s${customAttrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`,
          "gi",
        ),
      )
    : 0;

  // Unique value sets per attribute / element.
  const uniqTestid = extractAttrValues(html, "data-testid");
  const uniqCustom = customAttrName
    ? extractAttrValues(html, customAttrName)
    : new Set<string>();
  const uniqId = extractAttrValues(html, "id");
  const uniqRole = extractAttrValues(html, "role");
  const uniqAria = extractAttrValues(html, "aria-label");
  const uniqPlaceholder = extractAttrValues(html, "placeholder");
  const uniqName = extractAttrValues(html, "name");
  const uniqAlt = extractAttrValues(html, "alt");
  const uniqTitle = extractAttrValues(html, "title");

  const uniqButtonText = extractTagInnerTexts(html, "button");
  const uniqLinkText = extractTagInnerTexts(html, "a");
  const uniqLabelText = extractTagInnerTexts(html, "label");
  const uniqHeadingText = extractHeadingInnerTexts(html);

  // role-name in Playwright = role + accessible name. We can't compute the
  // accessible name without a DOM, but the dominant signal is unique inner
  // text of buttons/links (most common roles) plus unique aria-labels (which
  // override inner text when present). Explicit `role=` values widen the set
  // for non-default roles.
  const uniqRoleName = unionSize(
    uniqButtonText,
    uniqLinkText,
    uniqAria,
    uniqRole,
  );

  const counts: Record<SelectorType, number> = {
    "data-testid": dataTestidRaw + customAttrRaw,
    id: countMatches(html, /\sid\s*=/gi),
    "role-name":
      countMatches(html, /\srole\s*=/gi) +
      buttons +
      links +
      inputs +
      selects +
      textareas,
    label: labels,
    "heading-context": headings,
    "aria-label": countMatches(html, /\saria-label\s*=/gi),
    text: buttons + links,
    placeholder: countMatches(html, /\splaceholder\s*=/gi),
    name: countMatches(html, /\sname\s*=/gi),
    "alt-text": countMatches(html, /\salt\s*=/gi),
    title: countMatches(html, /\stitle\s*=/gi),
    "css-path": totalElements,
    "ocr-text": 0,
    coords: totalElements,
  };

  const uniqueCounts: Record<SelectorType, number> = {
    "data-testid": unionSize(uniqTestid, uniqCustom),
    id: uniqId.size,
    "role-name": uniqRoleName,
    label: uniqLabelText.size,
    "heading-context": uniqHeadingText.size,
    "aria-label": uniqAria.size,
    text: unionSize(uniqButtonText, uniqLinkText),
    placeholder: uniqPlaceholder.size,
    name: uniqName.size,
    "alt-text": uniqAlt.size,
    title: uniqTitle.size,
    "css-path": totalElements,
    "ocr-text": 0,
    coords: totalElements,
  };

  return { totalElements, interactiveElements, counts, uniqueCounts };
}

/** Whether the scan found enough content to base recommendations on. */
export function isMeaningful(coverage: SelectorCoverage): boolean {
  return coverage.interactiveElements >= MIN_INTERACTIVE_FOR_RECOMMENDATION;
}

/**
 * Produce a new selector priority list based on measured coverage:
 *  - Specific strategies with *unique* candidates on the page are enabled and
 *    ordered by uniqueness (most distinct values first; raw count as tiebreaker).
 *  - Specific strategies with zero unique candidates are disabled and sunk to
 *    the end. This covers both "attribute never appears" and the misleading
 *    case "attribute appears N times but always with the same value".
 *  - Universal fallbacks (text/css-path/coords) stay enabled in a stable tail.
 *  - OCR keeps whatever enabled state it already had.
 *
 * When the page isn't meaningful (client-rendered shell), the current config is
 * returned unchanged so we never mute strategies the live app actually relies on.
 */
export function recommendPriorityFromAnalysis(
  current: SelectorConfig[],
  coverage: SelectorCoverage,
): SelectorConfig[] {
  if (!isMeaningful(coverage)) {
    return current.map((c) => ({ ...c }));
  }

  const byType = new Map(current.map((c) => [c.type, c]));
  const origPriority = (t: SelectorType) => byType.get(t)?.priority ?? 999;
  // A strategy is useful iff it has at least 2 unique values, OR exactly 1
  // unique value with only 1 occurrence (single-button page, unambiguous).
  // A single unique value across many occurrences is the misleading case.
  const isUseful = (t: SelectorType) => {
    const u = coverage.uniqueCounts[t];
    const c = coverage.counts[t];
    if (u === 0) return false;
    if (u === 1 && c > 1) return false;
    return true;
  };

  const specificsPresent = SPECIFIC.filter((t) => byType.has(t));
  const enabledSpecific = specificsPresent
    .filter(isUseful)
    .sort(
      (a, b) =>
        coverage.uniqueCounts[b] - coverage.uniqueCounts[a] ||
        coverage.counts[b] - coverage.counts[a] ||
        origPriority(a) - origPriority(b),
    );
  const disabledSpecific = specificsPresent
    .filter((t) => !isUseful(t))
    .sort((a, b) => origPriority(a) - origPriority(b));

  // Fixed fallback tail, in the order they should be tried after specifics.
  const tail: SelectorType[] = ["text", "css-path", "ocr-text", "coords"];

  const orderedTypes: SelectorType[] = [
    ...enabledSpecific,
    ...tail.filter((t) => byType.has(t)),
    ...disabledSpecific,
  ];

  // Append any types not covered above (e.g. future selector types) preserving order.
  for (const c of current) {
    if (!orderedTypes.includes(c.type)) orderedTypes.push(c.type);
  }

  const enabledFor = (t: SelectorType): boolean => {
    if (ALWAYS_ON.includes(t)) return true;
    if (PRESERVE.includes(t)) return byType.get(t)?.enabled ?? false;
    if (SPECIFIC.includes(t)) return isUseful(t);
    return byType.get(t)?.enabled ?? false;
  };

  return orderedTypes.map((type, idx) => ({
    type,
    enabled: enabledFor(type),
    priority: idx + 1,
  }));
}
