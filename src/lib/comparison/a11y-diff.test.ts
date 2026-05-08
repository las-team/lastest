import { describe, it, expect } from 'vitest';
import { computeA11yDiff, summarizeA11yDiff } from './a11y-diff';
import type { A11yViolation } from '@/lib/db/schema';

function v(id: string, impact: A11yViolation['impact'], tags: string[] = []): A11yViolation {
  return {
    id,
    impact,
    description: id,
    help: id,
    helpUrl: `https://x/${id}`,
    nodes: 1,
    tags,
  };
}

describe('computeA11yDiff', () => {
  it('returns empty diff for identical lists', () => {
    const list = [v('color-contrast', 'serious'), v('label', 'critical')];
    const d = computeA11yDiff(list, list);
    expect(d.newViolations).toHaveLength(0);
    expect(d.disappeared).toHaveLength(0);
    expect(d.newBySeverity).toEqual({ critical: 0, serious: 0, moderate: 0, minor: 0 });
  });

  it('flags new violations and bins by severity', () => {
    const baseline = [v('color-contrast', 'serious')];
    const current = [
      v('color-contrast', 'serious'),
      v('button-name', 'critical'),
      v('region', 'moderate'),
    ];
    const d = computeA11yDiff(baseline, current);
    expect(d.newViolations).toHaveLength(2);
    expect(d.newBySeverity).toEqual({ critical: 1, serious: 0, moderate: 1, minor: 0 });
  });

  it('flags disappeared violations as resolved', () => {
    const baseline = [v('color-contrast', 'serious'), v('button-name', 'critical')];
    const current = [v('color-contrast', 'serious')];
    const d = computeA11yDiff(baseline, current);
    expect(d.disappeared).toHaveLength(1);
    expect(d.disappeared[0].id).toBe('button-name');
  });

  it('treats same id with different tags as different violations', () => {
    const baseline = [v('label', 'serious', ['wcag2aa'])];
    const current = [v('label', 'serious', ['best-practice'])];
    const d = computeA11yDiff(baseline, current);
    expect(d.newViolations).toHaveLength(1);
    expect(d.disappeared).toHaveLength(1);
  });
});

describe('summarizeA11yDiff', () => {
  it('orders by severity in summary', () => {
    const baseline: A11yViolation[] = [];
    const current = [v('a', 'critical'), v('b', 'minor')];
    const d = computeA11yDiff(baseline, current);
    const summary = summarizeA11yDiff(d);
    expect(summary).toContain('1 new critical');
    expect(summary).toContain('1 new minor');
    expect(summary.indexOf('critical')).toBeLessThan(summary.indexOf('minor'));
  });
});
