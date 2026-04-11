/**
 * WCAG compliance score calculation.
 * Computes a 0–100 score from axe-core violations with severity weighting.
 */

import type { A11yViolation, WcagScoreSummary } from '@/lib/db/schema';

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
};

const LEVEL_MULTIPLIERS: Record<string, number> = {
  A: 1.5,
  AA: 1.0,
  AAA: 0.5,
};

/**
 * Derive WCAG conformance level from axe-core tags.
 */
export function getWcagLevel(tags?: string[]): 'A' | 'AA' | 'AAA' | undefined {
  if (!tags) return undefined;
  if (tags.some(t => t.startsWith('wcag2aaa') || t === 'wcag22aaa')) return 'AAA';
  if (tags.some(t => t.startsWith('wcag2aa') || t === 'wcag22aa' || t === 'wcag21aa')) return 'AA';
  if (tags.some(t => t.startsWith('wcag2a') || t === 'wcag21a')) return 'A';
  return undefined;
}

/**
 * Calculate a WCAG compliance score from violations.
 *
 * Algorithm:
 *   Start at 100.
 *   Per violation: deduct severity_weight × min(nodes, 3) × level_multiplier.
 *   Clamp to [0, 100].
 */
export function calculateWcagScore(
  violations: A11yViolation[],
  passesCount?: number,
): WcagScoreSummary {
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };

  let totalDeduction = 0;

  for (const v of violations) {
    const severity = v.impact ?? 'moderate';
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;

    const weight = SEVERITY_WEIGHTS[severity] ?? 2;
    const nodeMultiplier = Math.min(v.nodes ?? 1, 3);
    const level = v.wcagLevel ?? getWcagLevel(v.tags) ?? 'AA';
    const levelMultiplier = LEVEL_MULTIPLIERS[level] ?? 1.0;

    totalDeduction += weight * nodeMultiplier * levelMultiplier;
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));
  const violatedRules = violations.length;
  const passedRules = passesCount ?? 0;
  const totalRules = passedRules + violatedRules;

  return {
    score,
    totalRules,
    passedRules,
    violatedRules,
    bySeverity,
  };
}

/**
 * Aggregate a11y data across multiple test results for build-level scoring.
 */
export function aggregateA11yForBuild(
  results: Array<{ a11yViolations?: A11yViolation[] | null; a11yPassesCount?: number | null }>,
): {
  score: number;
  violationCount: number;
  criticalCount: number;
  totalRulesChecked: number;
} {
  const allViolations: A11yViolation[] = [];
  let totalPasses = 0;

  for (const r of results) {
    if (r.a11yViolations) {
      allViolations.push(...r.a11yViolations);
    }
    if (r.a11yPassesCount) {
      totalPasses += r.a11yPassesCount;
    }
  }

  const summary = calculateWcagScore(allViolations, totalPasses);
  const criticalCount = summary.bySeverity.critical + summary.bySeverity.serious;

  return {
    score: summary.score,
    violationCount: allViolations.length,
    criticalCount,
    totalRulesChecked: summary.totalRules,
  };
}
