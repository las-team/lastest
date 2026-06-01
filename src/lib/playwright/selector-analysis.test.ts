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
  });

  it('always reports css-path and coords as available, never ocr', () => {
    const cov = analyzeHtmlForSelectors('<div><span>hi</span></div>');
    expect(cov.counts['css-path']).toBeGreaterThan(0);
    expect(cov.counts['coords']).toBeGreaterThan(0);
    expect(cov.counts['ocr-text']).toBe(0);
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
    // data-testid (3 candidates) should rank above aria-label (1 candidate)
    expect(dataTestidPriority).toBeLessThan(ariaPriority);
    // priorities are a contiguous 1..N sequence
    const sorted = [...result].sort((a, b) => a.priority - b.priority).map((c) => c.priority);
    expect(sorted).toEqual(result.map((_, i) => i + 1));
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
