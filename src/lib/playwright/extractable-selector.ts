/** Pull a Playwright-compatible selector out of a step's code line.
 *  Recognizes the helpers we generate (locateWithFallback, locator, getByRole,
 *  getByText, getByTestId, getByLabel, getByPlaceholder, getByAltText, getByTitle).
 *  Returns null when no selector can be safely extracted.
 *
 *  All returned strings are valid first-arg input to `page.locator(...)`,
 *  matching the runtime extractor in packages/embedded-browser/src/test-executor.ts.
 */
export function parseExtractableSelector(stepCode: string): string | null {
  // locateWithFallback(page, [{"type":"...","value":"..."}, ...], ...) → first .value
  const lwfMatch = stepCode.match(/locateWithFallback\s*\(\s*page\s*,\s*(\[[\s\S]*?\])\s*,/);
  if (lwfMatch) {
    try {
      const arr = JSON.parse(lwfMatch[1]) as Array<{ type?: string; value?: string }>;
      const first = arr.find(s => typeof s.value === 'string' && s.value.length > 0);
      if (first?.value) return first.value;
    } catch {
      // fall through to other patterns
    }
  }

  // page.locator('X') / .locator(`X`) / .locator("X")
  const locMatch = stepCode.match(/\.locator\s*\(\s*(['"`])([^'"`]+)\1\s*[,)]/);
  if (locMatch) return locMatch[2];

  // page.getByRole('btn', { name: 'Submit' }) → role=btn[name="Submit"]
  const roleMatch = stepCode.match(/\.getByRole\s*\(\s*(['"`])([^'"`]+)\1(?:\s*,\s*\{([^}]*)\})?/);
  if (roleMatch) {
    const role = roleMatch[2];
    const opts = roleMatch[3] ?? '';
    const nameMatch = opts.match(/name\s*:\s*(['"`])([^'"`]+)\1/);
    return nameMatch ? `role=${role}[name="${nameMatch[2]}"]` : `role=${role}`;
  }

  // page.getByTestId('foo') → [data-testid="foo"]
  const tidMatch = stepCode.match(/\.getByTestId\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (tidMatch) return `[data-testid="${tidMatch[2]}"]`;

  // page.getByPlaceholder('X') → [placeholder="X"]
  const phMatch = stepCode.match(/\.getByPlaceholder\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (phMatch) return `[placeholder="${phMatch[2]}"]`;

  // page.getByAltText('X') → [alt="X"]
  const altMatch = stepCode.match(/\.getByAltText\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (altMatch) return `[alt="${altMatch[2]}"]`;

  // page.getByTitle('X') → [title="X"]
  const titleMatch = stepCode.match(/\.getByTitle\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (titleMatch) return `[title="${titleMatch[2]}"]`;

  // page.getByLabel('X') → [aria-label="X"] (best-effort; users can refine)
  const labelMatch = stepCode.match(/\.getByLabel\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (labelMatch) return `[aria-label="${labelMatch[2]}"]`;

  // page.getByText('X') → text=X
  const textMatch = stepCode.match(/\.getByText\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (textMatch) return `text=${textMatch[2]}`;

  return null;
}

/** Walk every step in the test body and return the set of selectors a user
 *  could currently extract a Var from. Used to detect orphaned extract-mode
 *  Vars whose target no longer appears in the code. */
export function collectExtractableSelectors(steps: Array<{ code: string }>): Set<string> {
  const out = new Set<string>();
  for (const s of steps) {
    const sel = parseExtractableSelector(s.code);
    if (sel) out.add(sel);
  }
  return out;
}
