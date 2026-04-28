import { describe, it, expect } from 'vitest';
import { parseAssertions } from './assertion-parser';

describe('Assertion Parser', () => {
  describe('Pattern 1: Element assertion blocks', () => {
    it('parses element assertion comment + locateWithFallback + expect', () => {
      const code = `
// Element assertion: toBeVisible
{
  const el = await locateWithFallback(page, [{"type":"testId","value":"submit-btn"}]);
  await expect(el).toBeVisible();
}`;
      const assertions = parseAssertions(code);
      // Block produces element assertion from comment; inline expect(el) also matches Pattern 3
      expect(assertions.length).toBeGreaterThanOrEqual(1);
      const blockAssertion = assertions[0];
      expect(blockAssertion.category).toBe('element');
      expect(blockAssertion.assertionType).toBe('toBeVisible');
      expect(blockAssertion.targetSelector).toBe('testId: submit-btn');
      expect(blockAssertion.negated).toBe(false);
    });

    it('parses toHaveAttribute with attributeName and value', () => {
      const code = `
// Element assertion: toHaveAttribute
{
  const el = await locateWithFallback(page, [{"type":"css","value":".link"}]);
  await expect(el).toHaveAttribute('href', '/home');
}`;
      const assertions = parseAssertions(code);
      expect(assertions.length).toBeGreaterThanOrEqual(1);
      const blockAssertion = assertions[0];
      expect(blockAssertion.assertionType).toBe('toHaveAttribute');
      expect(blockAssertion.attributeName).toBe('href');
      expect(blockAssertion.expectedValue).toBe('/home');
    });

    it('parses negated element assertions', () => {
      const code = `
// Element assertion: toBeVisible
{
  const el = await locateWithFallback(page, [{"type":"testId","value":"modal"}]);
  await expect(el).not.toBeVisible();
}`;
      const assertions = parseAssertions(code);
      expect(assertions.length).toBeGreaterThanOrEqual(1);
      const blockAssertion = assertions[0];
      expect(blockAssertion.negated).toBe(true);
      expect(blockAssertion.label).toContain('not');
    });

    it('parses toHaveText with expected value', () => {
      const code = `
// Element assertion: toHaveText
{
  const el = await locateWithFallback(page, [{"type":"role","value":"heading"}]);
  await expect(el).toHaveText('Welcome');
}`;
      const assertions = parseAssertions(code);
      expect(assertions.length).toBeGreaterThanOrEqual(1);
      expect(assertions[0].expectedValue).toBe('Welcome');
    });
  });

  describe('Pattern 2: Page-level assertions', () => {
    it('parses await expect(page).toHaveURL(...)', () => {
      const code = `await expect(page).toHaveURL('https://example.com/home');`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].category).toBe('page');
      expect(assertions[0].assertionType).toBe('toHaveURL');
      expect(assertions[0].expectedValue).toBe('https://example.com/home');
    });

    it('parses await expect(page).toHaveTitle(...)', () => {
      const code = `await expect(page).toHaveTitle('My App');`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].assertionType).toBe('toHaveTitle');
      expect(assertions[0].expectedValue).toBe('My App');
    });

    it('parses negated page assertions', () => {
      const code = `await expect(page).not.toHaveURL('/login');`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].negated).toBe(true);
      expect(assertions[0].label).toContain('not');
    });

    it('parses buildUrl pattern in expected value', () => {
      const code = `await expect(page).toHaveURL(buildUrl(baseUrl, '/dashboard'));`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].expectedValue).toBe('/dashboard');
    });
  });

  describe('Pattern 3: Inline element assertions', () => {
    it('parses await expect(el).toBeVisible()', () => {
      const code = `await expect(button).toBeVisible();`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].category).toBe('element');
      expect(assertions[0].assertionType).toBe('toBeVisible');
    });

    it('does not match page as inline element', () => {
      const code = `await expect(page).toHaveURL('/');`;
      const assertions = parseAssertions(code);
      // Should be captured by page pattern, not inline element
      expect(assertions).toHaveLength(1);
      expect(assertions[0].category).toBe('page');
    });

    it('parses inline element with expected value', () => {
      const code = `await expect(input).toHaveValue('hello');`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].assertionType).toBe('toHaveValue');
      expect(assertions[0].expectedValue).toBe('hello');
    });
  });

  describe('Pattern 4: Generic value assertions', () => {
    it('parses expect(someVar).toBe(...)', () => {
      const code = `expect(count).toBe(5);`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].category).toBe('generic');
      expect(assertions[0].assertionType).toBe('toBe');
      expect(assertions[0].expectedValue).toBe('5');
    });

    it('parses expect(flag).toBeTruthy()', () => {
      const code = `expect(flag).toBeTruthy();`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].assertionType).toBe('toBeTruthy');
    });

    it('does not match await expect(...) as generic', () => {
      // await expressions should be caught by earlier patterns
      const code = `await expect(el).toBeVisible();`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].category).toBe('element');
    });

    it('parses negated generic assertions', () => {
      const code = `expect(result).not.toEqual('error');`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].negated).toBe(true);
    });
  });

  describe('Pattern 5: Download assertions', () => {
    it('parses recorder-emitted block with filename comment', () => {
      const code = `
// Download assertion: report.csv
await downloads.waitForAny();
expect(downloads.list().length).toBeGreaterThan(0);`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].category).toBe('download');
      expect(assertions[0].assertionType).toBe('fileDownloaded');
      expect(assertions[0].expectedValue).toBe('report.csv');
      expect(assertions[0].label).toBe('Download: report.csv');
    });

    it('parses bare pattern without comment', () => {
      const code = `
await downloads.waitForAny();
expect(downloads.list().length).toBeGreaterThan(0);`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].category).toBe('download');
      expect(assertions[0].assertionType).toBe('fileDownloaded');
      expect(assertions[0].label).toBe('File downloaded');
      // Spans waitForAny → expect line so step matching can locate it
      expect(assertions[0].codeLineEnd).toBeGreaterThan(assertions[0].codeLineStart!);
    });

    it('does not double-count expect when bare pattern is parsed', () => {
      // Without skip-past logic the inner `expect(downloads.list().length).toBeGreaterThan(0)`
      // would also be scanned by Pattern 4 on the next iteration. It happens to
      // not match Pattern 4's regex because of nested parens, but the test
      // pins the expected count regardless.
      const code = `
await downloads.waitForAny();
expect(downloads.list().length).toBeGreaterThan(0);
await expect(page).toHaveURL('/done');`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(2);
      expect(assertions[0].assertionType).toBe('fileDownloaded');
      expect(assertions[1].assertionType).toBe('toHaveURL');
    });

    it('ignores lone waitForAny without a following expect', () => {
      const code = `
await downloads.waitForAny();
await page.click('button');`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(0);
    });
  });

  describe('Pattern 6: Page wait assertions', () => {
    it('parses waitForLoadState with state', () => {
      const code = `await page.waitForLoadState('networkidle');`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].category).toBe('page');
      expect(assertions[0].assertionType).toBe('waitForLoadState');
      expect(assertions[0].expectedValue).toBe('networkidle');
    });

    it('parses waitForLoadState with load state', () => {
      const code = `await page.waitForLoadState('load');`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].expectedValue).toBe('load');
    });
  });

  describe('Multi-assertion parsing', () => {
    it('parses multiple assertions in order', () => {
      const code = `
await expect(page).toHaveURL('/home');
await expect(heading).toBeVisible();
expect(count).toBe(3);`;
      const assertions = parseAssertions(code);
      expect(assertions).toHaveLength(3);
      expect(assertions[0].orderIndex).toBe(0);
      expect(assertions[1].orderIndex).toBe(1);
      expect(assertions[2].orderIndex).toBe(2);
    });

    it('tracks correct line numbers', () => {
      const code = `line 1
await expect(page).toHaveURL('/');
line 3
expect(x).toBe(1);`;
      const assertions = parseAssertions(code);
      expect(assertions[0].codeLineStart).toBe(2);
      expect(assertions[1].codeLineStart).toBe(4);
    });

    it('generates stable IDs', () => {
      const code = `await expect(page).toHaveURL('/home');`;
      const a1 = parseAssertions(code);
      const a2 = parseAssertions(code);
      expect(a1[0].id).toBe(a2[0].id);
    });

    it('keeps IDs stable when unrelated lines are added above', () => {
      // Adding comments / blank lines / unrelated code above an assertion
      // should NOT change its id — that's the whole point of swapping
      // orderIndex out of the hash.
      const before = `await expect(page).toHaveURL('/home');
expect(count).toBe(3);`;
      const after = `// new comment line
const x = 1;
await expect(page).toHaveURL('/home');
expect(count).toBe(3);`;
      const a = parseAssertions(before);
      const b = parseAssertions(after);
      expect(a[0].id).toBe(b[0].id);
      expect(a[1].id).toBe(b[1].id);
    });

    it('keeps IDs stable when dissimilar assertions are reordered', () => {
      const original = `await expect(page).toHaveURL('/home');
await expect(button).toBeVisible();`;
      const reordered = `await expect(button).toBeVisible();
await expect(page).toHaveURL('/home');`;
      const a = parseAssertions(original);
      const b = parseAssertions(reordered);
      // Same (type, selector, expected) → same id regardless of source order
      const urlA = a.find(x => x.assertionType === 'toHaveURL')!;
      const urlB = b.find(x => x.assertionType === 'toHaveURL')!;
      expect(urlA.id).toBe(urlB.id);
      const visA = a.find(x => x.assertionType === 'toBeVisible')!;
      const visB = b.find(x => x.assertionType === 'toBeVisible')!;
      expect(visA.id).toBe(visB.id);
    });

    it('gives duplicate assertions distinct IDs via occurrence index', () => {
      const code = `await expect(page).toHaveURL('/foo');
await expect(page).toHaveURL('/foo');`;
      const a = parseAssertions(code);
      expect(a).toHaveLength(2);
      expect(a[0].id).not.toBe(a[1].id);
      // Both should re-parse to the same pair of ids in the same order
      const b = parseAssertions(code);
      expect(b[0].id).toBe(a[0].id);
      expect(b[1].id).toBe(a[1].id);
    });

    it('returns empty array for code with no assertions', () => {
      const code = `
const x = 1;
await page.click('button');
console.log('done');`;
      expect(parseAssertions(code)).toEqual([]);
    });
  });

  describe('describeAssertion labels', () => {
    it('generates visibility labels', () => {
      const code = `await expect(el).toBeVisible();`;
      const assertions = parseAssertions(code);
      expect(assertions[0].label).toBe('Element is visible');
    });

    it('generates page URL label', () => {
      const code = `await expect(page).toHaveURL('/home');`;
      const assertions = parseAssertions(code);
      expect(assertions[0].label).toBe('Page URL matches "/home"');
    });

    it('generates toBe label for generic', () => {
      const code = `expect(count).toBe(5);`;
      const assertions = parseAssertions(code);
      expect(assertions[0].label).toBe('Value is 5');
    });

    it('generates negated label', () => {
      const code = `await expect(el).not.toBeVisible();`;
      const assertions = parseAssertions(code);
      expect(assertions[0].label).toBe('Element is not visible');
    });

    it('generates toHaveText label', () => {
      const code = `await expect(heading).toHaveText('Hello');`;
      const assertions = parseAssertions(code);
      expect(assertions[0].label).toBe('Element has text "Hello"');
    });

    it('generates waitForLoadState label', () => {
      const code = `await page.waitForLoadState('domcontentloaded');`;
      const assertions = parseAssertions(code);
      expect(assertions[0].label).toBe('Page load state: domcontentloaded');
    });
  });
});
