import { describe, it, expect } from 'vitest';
import type { A11yViolation } from '@/lib/db/schema';
import { computeA11yDiff } from './a11y-diff';

const v = (over: Partial<A11yViolation>): A11yViolation => ({
  id: 'image-alt',
  impact: 'serious',
  description: 'Images must have alt text',
  help: 'Provide alt',
  helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
  nodes: 1,
  tags: ['wcag2a', 'wcag2aa'],
  wcagLevel: 'A',
  ...over,
});

describe('computeA11yDiff', () => {
  it('identical inputs → no deltas, scoreDelta 0', () => {
    const violations = [v({})];
    const out = computeA11yDiff(violations, violations, 5, 5);
    expect(out.newInB).toHaveLength(0);
    expect(out.fixedInB).toHaveLength(0);
    expect(out.regressed).toHaveLength(0);
    expect(out.improved).toHaveLength(0);
    expect(out.scoreDelta).toBe(0);
  });
  it('rule only in B → newInB', () => {
    const a: A11yViolation[] = [];
    const b = [v({})];
    const out = computeA11yDiff(a, b, 0, 0);
    expect(out.newInB).toHaveLength(1);
    expect(out.fixedInB).toHaveLength(0);
    expect(out.scoreDelta).toBeLessThan(0);
  });
  it('rule only in A → fixedInB', () => {
    const a = [v({})];
    const b: A11yViolation[] = [];
    const out = computeA11yDiff(a, b, 0, 0);
    expect(out.fixedInB).toHaveLength(1);
    expect(out.newInB).toHaveLength(0);
    expect(out.scoreDelta).toBeGreaterThan(0);
  });
  it('same rule, more nodes in B → regressed', () => {
    const a = [v({ nodes: 1 })];
    const b = [v({ nodes: 4 })];
    const out = computeA11yDiff(a, b, 0, 0);
    expect(out.regressed).toEqual([
      { ruleId: 'image-alt', impact: 'serious', nodesA: 1, nodesB: 4 },
    ]);
  });
  it('same rule, fewer nodes in B → improved', () => {
    const a = [v({ nodes: 4 })];
    const b = [v({ nodes: 1 })];
    const out = computeA11yDiff(a, b, 0, 0);
    expect(out.improved).toHaveLength(1);
  });
  it('multi-rule comparison', () => {
    const a = [v({ id: 'image-alt' }), v({ id: 'label' })];
    const b = [v({ id: 'image-alt' }), v({ id: 'color-contrast', impact: 'critical' })];
    const out = computeA11yDiff(a, b, 0, 0);
    expect(out.fixedInB.map((x) => x.id)).toEqual(['label']);
    expect(out.newInB.map((x) => x.id)).toEqual(['color-contrast']);
  });
  it('passes count flows into score', () => {
    const out = computeA11yDiff([], [], 10, 20);
    expect(out.scoreA.totalRules).toBe(10);
    expect(out.scoreB.totalRules).toBe(20);
    expect(out.scoreA.score).toBe(100);
    expect(out.scoreB.score).toBe(100);
  });
});
