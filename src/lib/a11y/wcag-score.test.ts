import { describe, it, expect } from 'vitest';
import { getWcagLevel, calculateWcagScore, aggregateA11yForBuild } from './wcag-score';
import type { A11yViolation } from '@/lib/db/schema';

function makeViolation(overrides: Partial<A11yViolation> = {}): A11yViolation {
  return {
    id: 'test-rule',
    impact: 'moderate',
    description: 'Test violation',
    help: 'Fix it',
    helpUrl: 'https://example.com',
    nodes: 1,
    ...overrides,
  };
}

describe('WCAG Score Utilities', () => {
  describe('getWcagLevel', () => {
    it('returns undefined for undefined tags', () => {
      expect(getWcagLevel(undefined)).toBeUndefined();
    });

    it('returns undefined for empty tags', () => {
      expect(getWcagLevel([])).toBeUndefined();
    });

    it('returns undefined for non-WCAG tags', () => {
      expect(getWcagLevel(['best-practice', 'cat.color'])).toBeUndefined();
    });

    it('detects WCAG 2.0 level A', () => {
      expect(getWcagLevel(['wcag2a', 'wcag111'])).toBe('A');
    });

    it('detects WCAG 2.0 level AA', () => {
      expect(getWcagLevel(['wcag2aa', 'wcag143'])).toBe('AA');
    });

    it('detects WCAG 2.0 level AAA', () => {
      expect(getWcagLevel(['wcag2aaa', 'wcag146'])).toBe('AAA');
    });

    it('detects WCAG 2.1 variants', () => {
      expect(getWcagLevel(['wcag21a'])).toBe('A');
      expect(getWcagLevel(['wcag21aa'])).toBe('AA');
    });

    it('detects WCAG 2.2 variants', () => {
      expect(getWcagLevel(['wcag22aa'])).toBe('AA');
      expect(getWcagLevel(['wcag22aaa'])).toBe('AAA');
    });

    it('returns highest level when multiple present (AAA > AA > A)', () => {
      expect(getWcagLevel(['wcag2a', 'wcag2aaa'])).toBe('AAA');
      expect(getWcagLevel(['wcag2a', 'wcag2aa'])).toBe('AA');
    });
  });

  describe('calculateWcagScore', () => {
    it('returns score 100 for no violations', () => {
      const result = calculateWcagScore([]);
      expect(result.score).toBe(100);
      expect(result.violatedRules).toBe(0);
      expect(result.bySeverity).toEqual({ critical: 0, serious: 0, moderate: 0, minor: 0 });
    });

    it('counts passedRules from passesCount param', () => {
      const result = calculateWcagScore([], 42);
      expect(result.passedRules).toBe(42);
      expect(result.totalRules).toBe(42);
    });

    it('defaults passedRules to 0 when not provided', () => {
      const result = calculateWcagScore([]);
      expect(result.passedRules).toBe(0);
    });

    it('deducts correctly for a single critical violation (AA)', () => {
      // critical weight=10, nodes=1, AA multiplier=1.0 → deduction=10
      const v = makeViolation({ impact: 'critical', nodes: 1, wcagLevel: 'AA' });
      const result = calculateWcagScore([v]);
      expect(result.score).toBe(90);
      expect(result.bySeverity.critical).toBe(1);
    });

    it('deducts correctly for a serious violation', () => {
      // serious weight=5, nodes=1, AA=1.0 → deduction=5
      const v = makeViolation({ impact: 'serious', nodes: 1, wcagLevel: 'AA' });
      const result = calculateWcagScore([v]);
      expect(result.score).toBe(95);
    });

    it('deducts correctly for moderate violation', () => {
      // moderate weight=2, nodes=1, AA=1.0 → deduction=2
      const v = makeViolation({ impact: 'moderate', nodes: 1, wcagLevel: 'AA' });
      const result = calculateWcagScore([v]);
      expect(result.score).toBe(98);
    });

    it('deducts correctly for minor violation', () => {
      // minor weight=1, nodes=1, AA=1.0 → deduction=1
      const v = makeViolation({ impact: 'minor', nodes: 1, wcagLevel: 'AA' });
      const result = calculateWcagScore([v]);
      expect(result.score).toBe(99);
    });

    it('applies level A multiplier (1.5)', () => {
      // moderate weight=2, nodes=1, A=1.5 → deduction=3
      const v = makeViolation({ impact: 'moderate', nodes: 1, wcagLevel: 'A' });
      const result = calculateWcagScore([v]);
      expect(result.score).toBe(97);
    });

    it('applies level AAA multiplier (0.5)', () => {
      // moderate weight=2, nodes=1, AAA=0.5 → deduction=1
      const v = makeViolation({ impact: 'moderate', nodes: 1, wcagLevel: 'AAA' });
      const result = calculateWcagScore([v]);
      expect(result.score).toBe(99);
    });

    it('caps node multiplier at 3', () => {
      // critical weight=10, nodes=100 → capped at 3, AA=1.0 → deduction=30
      const v = makeViolation({ impact: 'critical', nodes: 100, wcagLevel: 'AA' });
      const result = calculateWcagScore([v]);
      expect(result.score).toBe(70);
    });

    it('uses nodes=1 when nodes is undefined', () => {
      const v = makeViolation({ impact: 'critical', wcagLevel: 'AA' });
      delete (v as Record<string, unknown>).nodes;
      const result = calculateWcagScore([v]);
      expect(result.score).toBe(90);
    });

    it('falls back to tags-based level detection when wcagLevel not set', () => {
      const v = makeViolation({ impact: 'moderate', nodes: 1, tags: ['wcag2a'] });
      delete (v as Record<string, unknown>).wcagLevel;
      const result = calculateWcagScore([v]);
      // moderate=2, A=1.5 → deduction=3
      expect(result.score).toBe(97);
    });

    it('clamps score to 0 minimum', () => {
      // 20 critical violations × 3 nodes each = deduction 600
      const violations = Array.from({ length: 20 }, () =>
        makeViolation({ impact: 'critical', nodes: 3, wcagLevel: 'AA' })
      );
      const result = calculateWcagScore(violations);
      expect(result.score).toBe(0);
    });

    it('counts bySeverity correctly for mixed violations', () => {
      const violations = [
        makeViolation({ id: '1', impact: 'critical' }),
        makeViolation({ id: '2', impact: 'critical' }),
        makeViolation({ id: '3', impact: 'serious' }),
        makeViolation({ id: '4', impact: 'moderate' }),
        makeViolation({ id: '5', impact: 'minor' }),
      ];
      const result = calculateWcagScore(violations);
      expect(result.bySeverity).toEqual({ critical: 2, serious: 1, moderate: 1, minor: 1 });
      expect(result.violatedRules).toBe(5);
    });
  });

  describe('aggregateA11yForBuild', () => {
    it('returns perfect score for empty results', () => {
      const result = aggregateA11yForBuild([]);
      expect(result.score).toBe(100);
      expect(result.violationCount).toBe(0);
      expect(result.criticalCount).toBe(0);
    });

    it('handles results with null/undefined violations', () => {
      const result = aggregateA11yForBuild([
        { a11yViolations: null, a11yPassesCount: 10 },
        { a11yViolations: undefined, a11yPassesCount: null },
      ]);
      expect(result.score).toBe(100);
      expect(result.totalRulesChecked).toBe(10);
    });

    it('aggregates violations across multiple results', () => {
      const result = aggregateA11yForBuild([
        {
          a11yViolations: [makeViolation({ impact: 'critical', wcagLevel: 'AA', nodes: 1 })],
          a11yPassesCount: 10,
        },
        {
          a11yViolations: [makeViolation({ impact: 'serious', wcagLevel: 'AA', nodes: 1 })],
          a11yPassesCount: 5,
        },
      ]);
      expect(result.violationCount).toBe(2);
      expect(result.totalRulesChecked).toBe(17); // 15 passes + 2 violations
    });

    it('counts criticalCount as critical + serious', () => {
      const result = aggregateA11yForBuild([
        {
          a11yViolations: [
            makeViolation({ id: '1', impact: 'critical', wcagLevel: 'AA' }),
            makeViolation({ id: '2', impact: 'serious', wcagLevel: 'AA' }),
            makeViolation({ id: '3', impact: 'moderate', wcagLevel: 'AA' }),
          ],
          a11yPassesCount: 0,
        },
      ]);
      expect(result.criticalCount).toBe(2); // 1 critical + 1 serious
    });
  });
});
