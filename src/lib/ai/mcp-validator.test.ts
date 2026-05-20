import { describe, it, expect } from 'vitest';
import { extractSelectors, extractLocatorChains } from './mcp-validator';

describe('extractSelectors (chained-call aware)', () => {
  it('enumerates each segment of the marktolmacs.com chain separately', () => {
    const code = `
      await page.locator('section')
        .filter({ hasText: /Welcome.*I'm Mark Tolmacs/ })
        .getByRole('link', { name: 'Request a free consultation' })
        .click();
    `;
    const selectors = extractSelectors(code);
    expect(selectors).toContain('section');
    expect(selectors.some((s) => /role=link\[name="Request a free consultation"\]/.test(s))).toBe(true);
    // Filter on hasText should land as an internal:has-text engine selector.
    expect(selectors.some((s) => /internal:has-text/.test(s))).toBe(true);
  });

  it('still handles flat page.X calls', () => {
    const code = `
      await page.getByTestId('submit-btn').click();
      await page.getByText('Hello').waitFor();
    `;
    const selectors = extractSelectors(code);
    expect(selectors).toContain('[data-testid="submit-btn"]');
    expect(selectors.some((s) => /text=Hello/.test(s))).toBe(true);
  });

  it('returns deduped selectors', () => {
    const code = `
      await page.getByRole('button', { name: 'OK' }).click();
      await page.getByRole('button', { name: 'OK' }).click();
    `;
    const selectors = extractSelectors(code);
    const okCount = selectors.filter((s) => s === 'role=button[name="OK"]').length;
    expect(okCount).toBe(1);
  });

  it('preserves page.$/waitForSelector style selectors', () => {
    const code = `
      await page.$('.foo');
      await page.waitForSelector('#bar');
    `;
    const selectors = extractSelectors(code);
    expect(selectors).toContain('.foo');
    expect(selectors).toContain('#bar');
  });
});

describe('extractLocatorChains', () => {
  it('groups the marktolmacs.com chain as one chain with three segments', () => {
    const code = `
      await page.locator('section').filter({ hasText: 'Welcome' }).getByRole('link', { name: 'Request' }).click();
    `;
    const chains = extractLocatorChains(code);
    expect(chains.length).toBeGreaterThanOrEqual(1);
    const target = chains.find((c) => c.segments.length === 3);
    expect(target).toBeDefined();
    if (target) {
      expect(target.segments[0].method).toBe('locator');
      expect(target.segments[0].selector).toBe('section');
      expect(target.segments[1].method).toBe('filter');
      expect(target.segments[2].method).toBe('getByRole');
      expect(target.selector).toContain('section >> ');
      expect(target.selector).toContain(' >> role=link');
    }
  });

  it('separates two independent chains on different lines', () => {
    const code = `
      await page.getByRole('button', { name: 'Open' }).click();
      await page.locator('#sidebar').getByText('Settings').click();
    `;
    const chains = extractLocatorChains(code);
    expect(chains.length).toBeGreaterThanOrEqual(2);
  });
});
