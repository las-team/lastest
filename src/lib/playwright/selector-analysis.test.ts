import { describe, it, expect } from 'vitest';
import {
  analyzeHtmlForSelectors,
  recommendPriorityFromAnalysis,
  isMeaningful,
} from './selector-analysis';
import { DEFAULT_SELECTOR_PRIORITY } from '@/lib/db/schema';

describe('analyzeHtmlForSelectors', () => {
  it('counts attribute-based selector candidates', () => {
    const html = `
      <button data-testid="save">Save</button>
      <button aria-label="Close">x</button>
      <input id="email" name="email" placeholder="Email" />
      <a href="/home">Home</a>
      <label for="email">Email</label>
      <img alt="logo" />
    `;
    const cov = analyzeHtmlForSelectors(html);
    expect(cov.counts['data-testid']).toBe(1);
    expect(cov.counts['aria-label']).toBe(1);
    expect(cov.counts['placeholder']).toBe(1);
    expect(cov.counts['label']).toBe(1);
    expect(cov.counts['alt-text']).toBe(1);
    expect(cov.counts['id']).toBeGreaterThanOrEqual(1);
    // buttons + links + inputs
    expect(cov.interactiveElements).toBe(4);
  });

  it('folds a custom test-id attribute into data-testid coverage', () => {
    const html = `<button data-automation-id="x">a</button><button data-automation-id="y">b</button>`;
    const cov = analyzeHtmlForSelectors(html, { customAttributeName: 'data-automation-id' });
    expect(cov.counts['data-testid']).toBe(2);
    expect(cov.uniqueCounts['data-testid']).toBe(2);
  });

  it('always reports css-path and coords as available, never ocr', () => {
    const cov = analyzeHtmlForSelectors('<div><span>hi</span></div>');
    expect(cov.counts['css-path']).toBeGreaterThan(0);
    expect(cov.counts['coords']).toBeGreaterThan(0);
    expect(cov.counts['ocr-text']).toBe(0);
  });

  it('tracks distinct values per attribute strategy', () => {
    const html = `
      <button data-testid="save">A</button>
      <button data-testid="cancel">B</button>
      <button data-testid="save">C</button>
      <input aria-label="email" />
      <input aria-label="email" />
      <input aria-label="password" />
    `;
    const cov = analyzeHtmlForSelectors(html);
    // 3 raw data-testid attrs, but only 2 distinct values
    expect(cov.counts['data-testid']).toBe(3);
    expect(cov.uniqueCounts['data-testid']).toBe(2);
    // 3 raw aria-labels, 2 distinct values
    expect(cov.counts['aria-label']).toBe(3);
    expect(cov.uniqueCounts['aria-label']).toBe(2);
  });

  it('treats a repeated single value as 1 unique (the misleading case)', () => {
    const html = `
      <button aria-label="Close">x</button>
      <button aria-label="Close">x</button>
      <button aria-label="Close">x</button>
      <button aria-label="Close">x</button>
    `;
    const cov = analyzeHtmlForSelectors(html);
    expect(cov.counts['aria-label']).toBe(4);
    expect(cov.uniqueCounts['aria-label']).toBe(1);
  });

  it('counts distinct button/link inner texts for the text strategy', () => {
    const html = `
      <button>Submit</button>
      <button>Submit</button>
      <button>Cancel</button>
      <a href="/a">Home</a>
      <a href="/b">Submit</a>
    `;
    const cov = analyzeHtmlForSelectors(html);
    // buttons(3) + links(2) = 5 raw
    expect(cov.counts['text']).toBe(5);
    // unique strings across both: {Submit, Cancel, Home}
    expect(cov.uniqueCounts['text']).toBe(3);
  });

  it('handles single-quoted attribute values', () => {
    const html = `<button data-testid='one'>A</button><button data-testid='two'>B</button>`;
    const cov = analyzeHtmlForSelectors(html);
    expect(cov.uniqueCounts['data-testid']).toBe(2);
  });
});

describe('isMeaningful', () => {
  it('is false for an empty client-rendered shell', () => {
    const cov = analyzeHtmlForSelectors('<div id="root"></div>');
    expect(isMeaningful(cov)).toBe(false);
  });
});

describe('recommendPriorityFromAnalysis', () => {
  it('leaves config unchanged when the page is not meaningful', () => {
    const cov = analyzeHtmlForSelectors('<div id="root"></div>');
    const result = recommendPriorityFromAnalysis(DEFAULT_SELECTOR_PRIORITY, cov);
    expect(result).toEqual(DEFAULT_SELECTOR_PRIORITY);
  });

  it('disables specific strategies with zero coverage but keeps fallbacks on', () => {
    // A page with only links + text, no testids/aria/ids/etc.
    const html = `<a href="/a">A</a><a href="/b">B</a><a href="/c">C</a>`;
    const cov = analyzeHtmlForSelectors(html);
    const result = recommendPriorityFromAnalysis(DEFAULT_SELECTOR_PRIORITY, cov);
    const byType = new Map(result.map((c) => [c.type, c]));

    expect(byType.get('data-testid')?.enabled).toBe(false);
    expect(byType.get('aria-label')?.enabled).toBe(false);
    expect(byType.get('placeholder')?.enabled).toBe(false);
    // role-name has coverage from the <a> tags, stays enabled
    expect(byType.get('role-name')?.enabled).toBe(true);
    // universal fallbacks always on
    expect(byType.get('text')?.enabled).toBe(true);
    expect(byType.get('css-path')?.enabled).toBe(true);
    expect(byType.get('coords')?.enabled).toBe(true);
    // ocr-text preserves its default (disabled)
    expect(byType.get('ocr-text')?.enabled).toBe(false);
  });

  it('orders well-represented strategies first', () => {
    const html = `
      <button data-testid="a">A</button>
      <button data-testid="b">B</button>
      <button data-testid="c">C</button>
      <button aria-label="d">D</button>
    `;
    const cov = analyzeHtmlForSelectors(html);
    const result = recommendPriorityFromAnalysis(DEFAULT_SELECTOR_PRIORITY, cov);
    const dataTestidPriority = result.find((c) => c.type === 'data-testid')!.priority;
    const ariaPriority = result.find((c) => c.type === 'aria-label')!.priority;
    // data-testid (3 unique) should rank above aria-label (1 unique)
    expect(dataTestidPriority).toBeLessThan(ariaPriority);
    // priorities are a contiguous 1..N sequence
    const sorted = [...result].sort((a, b) => a.priority - b.priority).map((c) => c.priority);
    expect(sorted).toEqual(result.map((_, i) => i + 1));
  });

  it('disables an attribute that always carries the same value (misleading case)', () => {
    // Every button has aria-label="Close" — looks "well represented" by raw
    // count, but yields ambiguous selectors. Should be disabled.
    const html = `
      <button aria-label="Close">x</button>
      <button aria-label="Close">x</button>
      <button aria-label="Close">x</button>
      <button aria-label="Close">x</button>
      <button data-testid="a">A</button>
      <button data-testid="b">B</button>
    `;
    const cov = analyzeHtmlForSelectors(html);
    const result = recommendPriorityFromAnalysis(DEFAULT_SELECTOR_PRIORITY, cov);
    const byType = new Map(result.map((c) => [c.type, c]));
    expect(byType.get('aria-label')?.enabled).toBe(false);
    expect(byType.get('data-testid')?.enabled).toBe(true);
    // data-testid (2 unique) should rank above aria-label (1 unique, disabled)
    expect(byType.get('data-testid')!.priority).toBeLessThan(byType.get('aria-label')!.priority);
  });

  it('keeps a single-occurrence single-value strategy enabled (not misleading)', () => {
    // Only one element on the page carries data-testid — uniqueness is 1,
    // raw count is 1, so it's unambiguous and should stay enabled.
    const html = `
      <button data-testid="save">Save</button>
      <a href="/a">A</a>
      <a href="/b">B</a>
      <a href="/c">C</a>
    `;
    const cov = analyzeHtmlForSelectors(html);
    const result = recommendPriorityFromAnalysis(DEFAULT_SELECTOR_PRIORITY, cov);
    const byType = new Map(result.map((c) => [c.type, c]));
    expect(byType.get('data-testid')?.enabled).toBe(true);
  });

  it('ranks by unique count, not raw count', () => {
    // aria-label has more raw occurrences but fewer distinct values than name.
    const html = `
      <input aria-label="Search" />
      <input aria-label="Search" />
      <input aria-label="Search" />
      <input aria-label="Search" />
      <input name="email" />
      <input name="password" />
      <input name="phone" />
    `;
    const cov = analyzeHtmlForSelectors(html);
    const result = recommendPriorityFromAnalysis(DEFAULT_SELECTOR_PRIORITY, cov);
    const byType = new Map(result.map((c) => [c.type, c]));
    // name (3 unique) beats aria-label (1 unique, downranked to disabled)
    expect(byType.get('name')!.priority).toBeLessThan(byType.get('aria-label')!.priority);
    expect(byType.get('name')?.enabled).toBe(true);
    expect(byType.get('aria-label')?.enabled).toBe(false);
  });

  it('returns every original selector type exactly once', () => {
    const html = `<button data-testid="x">X</button><input name="y" /><a href="/z">Z</a>`;
    const cov = analyzeHtmlForSelectors(html);
    const result = recommendPriorityFromAnalysis(DEFAULT_SELECTOR_PRIORITY, cov);
    expect(result).toHaveLength(DEFAULT_SELECTOR_PRIORITY.length);
    const types = new Set(result.map((c) => c.type));
    expect(types.size).toBe(DEFAULT_SELECTOR_PRIORITY.length);
  });
});
