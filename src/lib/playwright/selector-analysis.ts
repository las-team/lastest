import type { SelectorConfig, SelectorType } from '@/lib/db/schema';

/**
 * Static selector analysis for the "Analyze before record" flow.
 *
 * Given the raw HTML served at a target URL, estimate how well each selector
 * strategy is represented on the page (how many candidate attributes/elements
 * exist) so the recorder can promote the strategies the app actually uses and
 * mute the ones it never does.
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
  /** Per selector-type candidate counts. Higher = better represented. */
  counts: Record<SelectorType, number>;
}

// Selector types that are universal fallbacks — always usable regardless of
// what the page contains, so analysis never disables them.
const ALWAYS_ON: SelectorType[] = ['text', 'css-path', 'coords'];
// OCR cannot be detected from HTML; leave its enabled state untouched.
const PRESERVE: SelectorType[] = ['ocr-text'];
// Attribute/element-backed strategies whose usefulness we can actually measure.
const SPECIFIC: SelectorType[] = [
  'data-testid',
  'id',
  'role-name',
  'label',
  'heading-context',
  'aria-label',
  'placeholder',
  'name',
  'alt-text',
  'title',
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
 * Scan raw HTML and estimate per-strategy selector coverage.
 *
 * `customAttributeName` (e.g. `data-automation-id`) folds into the
 * `data-testid` bucket since the recorder treats a configured custom attribute
 * as the highest-priority test id.
 */
export function analyzeHtmlForSelectors(
  html: string,
  opts: { customAttributeName?: string | null } = {}
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

  const dataTestid = countMatches(html, /\sdata-testid\s*=/gi);
  const customAttr = opts.customAttributeName?.trim()
    ? countMatches(
        html,
        // Escape regex metacharacters in the user-supplied attribute name.
        new RegExp(`\\s${opts.customAttributeName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`, 'gi')
      )
    : 0;

  const counts: Record<SelectorType, number> = {
    'data-testid': dataTestid + customAttr,
    'id': countMatches(html, /\sid\s*=/gi),
    // role-name covers explicit ARIA roles plus elements with implicit roles.
    'role-name': countMatches(html, /\srole\s*=/gi) + buttons + links + inputs + selects + textareas,
    'label': labels,
    'heading-context': headings,
    'aria-label': countMatches(html, /\saria-label\s*=/gi),
    'text': buttons + links,
    'placeholder': countMatches(html, /\splaceholder\s*=/gi),
    'name': countMatches(html, /\sname\s*=/gi),
    'alt-text': countMatches(html, /\salt\s*=/gi),
    'title': countMatches(html, /\stitle\s*=/gi),
    'css-path': totalElements,
    'ocr-text': 0,
    'coords': totalElements,
  };

  return { totalElements, interactiveElements, counts };
}

/** Whether the scan found enough content to base recommendations on. */
export function isMeaningful(coverage: SelectorCoverage): boolean {
  return coverage.interactiveElements >= MIN_INTERACTIVE_FOR_RECOMMENDATION;
}

/**
 * Produce a new selector priority list based on measured coverage:
 *  - Specific strategies with candidates on the page are enabled and ordered by
 *    coverage (most-represented first).
 *  - Specific strategies with zero candidates are disabled and sunk to the end.
 *  - Universal fallbacks (text/css-path/coords) stay enabled in a stable tail.
 *  - OCR keeps whatever enabled state it already had.
 *
 * When the page isn't meaningful (client-rendered shell), the current config is
 * returned unchanged so we never mute strategies the live app actually relies on.
 */
export function recommendPriorityFromAnalysis(
  current: SelectorConfig[],
  coverage: SelectorCoverage
): SelectorConfig[] {
  if (!isMeaningful(coverage)) {
    return current.map((c) => ({ ...c }));
  }

  const byType = new Map(current.map((c) => [c.type, c]));
  const origPriority = (t: SelectorType) => byType.get(t)?.priority ?? 999;

  const specificsPresent = SPECIFIC.filter((t) => byType.has(t));
  const enabledSpecific = specificsPresent
    .filter((t) => coverage.counts[t] > 0)
    .sort((a, b) => coverage.counts[b] - coverage.counts[a] || origPriority(a) - origPriority(b));
  const disabledSpecific = specificsPresent
    .filter((t) => coverage.counts[t] === 0)
    .sort((a, b) => origPriority(a) - origPriority(b));

  // Fixed fallback tail, in the order they should be tried after specifics.
  const tail: SelectorType[] = ['text', 'css-path', 'ocr-text', 'coords'];

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
    if (SPECIFIC.includes(t)) return coverage.counts[t] > 0;
    return byType.get(t)?.enabled ?? false;
  };

  return orderedTypes.map((type, idx) => ({
    type,
    enabled: enabledFor(type),
    priority: idx + 1,
  }));
}
