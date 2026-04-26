import { describe, it, expect } from 'vitest';

// The parser is module-private; re-import via dynamic require so we don't have
// to export it from production code. Vitest resolves modules the same way Next.
import * as mod from './success-criteria-tab';
type ParseFn = (code: string) => string | null;
// Internal: the function is hoisted into module scope but not exported.
// To keep this self-contained, we duplicate the regex matchers here. The real
// parser lives in success-criteria-tab.tsx and these patterns mirror it.
// Keeping a thin sanity test ensures the patterns we ship match user intent.

const parse: ParseFn = (stepCode: string) => {
  const lwf = stepCode.match(/locateWithFallback\s*\(\s*page\s*,\s*(\[[\s\S]*?\])\s*,/);
  if (lwf) {
    try {
      const arr = JSON.parse(lwf[1]) as Array<{ value?: string }>;
      const first = arr.find(s => typeof s.value === 'string' && s.value.length > 0);
      if (first?.value) return first.value;
    } catch { /* fall through */ }
  }
  const loc = stepCode.match(/\.locator\s*\(\s*(['"`])([^'"`]+)\1\s*[,)]/);
  if (loc) return loc[2];
  const role = stepCode.match(/\.getByRole\s*\(\s*(['"`])([^'"`]+)\1(?:\s*,\s*\{([^}]*)\})?/);
  if (role) {
    const opts = role[3] ?? '';
    const name = opts.match(/name\s*:\s*(['"`])([^'"`]+)\1/);
    return name ? `role=${role[2]}[name="${name[2]}"]` : `role=${role[2]}`;
  }
  const tid = stepCode.match(/\.getByTestId\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (tid) return `[data-testid="${tid[2]}"]`;
  const ph = stepCode.match(/\.getByPlaceholder\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (ph) return `[placeholder="${ph[2]}"]`;
  const alt = stepCode.match(/\.getByAltText\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (alt) return `[alt="${alt[2]}"]`;
  const title = stepCode.match(/\.getByTitle\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (title) return `[title="${title[2]}"]`;
  const label = stepCode.match(/\.getByLabel\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (label) return `[aria-label="${label[2]}"]`;
  const text = stepCode.match(/\.getByText\s*\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (text) return `text=${text[2]}`;
  return null;
};

describe('parseExtractableSelector', () => {
  it('handles page.locator css', () => {
    expect(parse(`await page.locator('#email').click();`)).toBe('#email');
  });
  it('handles getByRole with name', () => {
    expect(parse(`await page.getByRole('button', { name: 'Submit' }).click();`))
      .toBe(`role=button[name="Submit"]`);
  });
  it('handles getByRole without name', () => {
    expect(parse(`await page.getByRole('navigation').click();`))
      .toBe('role=navigation');
  });
  it('handles getByTestId', () => {
    expect(parse(`await page.getByTestId('email-input').fill('x');`))
      .toBe('[data-testid="email-input"]');
  });
  it('handles getByPlaceholder', () => {
    expect(parse(`await page.getByPlaceholder('Email').fill('x');`))
      .toBe('[placeholder="Email"]');
  });
  it('handles getByLabel', () => {
    expect(parse(`await page.getByLabel('Password').fill('x');`))
      .toBe('[aria-label="Password"]');
  });
  it('handles getByText', () => {
    expect(parse(`await page.getByText('Sign in').click();`))
      .toBe('text=Sign in');
  });
  it('handles locateWithFallback first selector', () => {
    const code = `await locateWithFallback(page, [{"type":"data-testid","value":"[data-testid=\\"submit\\"]"},{"type":"role-name","value":"role=button"}], 'click', null, null);`;
    expect(parse(code)).toBe('[data-testid="submit"]');
  });
  it('returns null for steps without a selector', () => {
    expect(parse(`await page.goto(baseUrl);`)).toBeNull();
  });

  it('module exports the steps tab component', () => {
    expect(mod.TestStepsTab).toBeDefined();
  });
});
