/**
 * Design-system compliance score — mirrors `lib/a11y/wcag-score.ts`.
 *
 * Start at 100, deduct severity × min(nodes, 3) × category-weight per
 * violation, clamp to [0,100]. Color and font-family carry the highest
 * weight (brand identity); radii are mid; spacing minor.
 */

import type {
  DesignSystemViolation,
  DesignSystemScoreSummary,
} from '@/lib/db/schema';

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
};

const CATEGORY_MULTIPLIERS: Record<string, number> = {
  color: 1.5,
  'font-family': 1.5,
  'border-radius': 1.0,
  'font-size': 1.0,
  spacing: 0.5,
};

export function calculateDesignSystemScore(
  violations: DesignSystemViolation[],
  rulesChecked = 0,
): DesignSystemScoreSummary {
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  let totalDeduction = 0;

  for (const v of violations) {
    const severity = v.impact ?? 'moderate';
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    const weight = SEVERITY_WEIGHTS[severity] ?? 2;
    const nodeMultiplier = Math.min(typeof v.nodes === 'number' ? v.nodes : 1, 3);
    const catMultiplier = CATEGORY_MULTIPLIERS[v.category] ?? 1.0;
    totalDeduction += weight * nodeMultiplier * catMultiplier;
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));
  const violatedRules = violations.length;
  const totalRules = Math.max(rulesChecked, violatedRules);
  const passedRules = Math.max(0, totalRules - violatedRules);

  return {
    score,
    totalRules,
    passedRules,
    violatedRules,
    bySeverity,
  };
}

export function aggregateDesignSystemForBuild(
  results: Array<{
    designSystemViolations?: DesignSystemViolation[] | null;
    designSystemRulesChecked?: number | null;
  }>,
): {
  score: number;
  violationCount: number;
  criticalCount: number;
  totalRulesChecked: number;
} {
  const all: DesignSystemViolation[] = [];
  let totalChecked = 0;

  for (const r of results) {
    if (r.designSystemViolations) all.push(...r.designSystemViolations);
    if (typeof r.designSystemRulesChecked === 'number') totalChecked += r.designSystemRulesChecked;
  }

  const summary = calculateDesignSystemScore(all, totalChecked);
  const criticalCount = summary.bySeverity.critical + summary.bySeverity.serious;

  return {
    score: summary.score,
    violationCount: all.length,
    criticalCount,
    totalRulesChecked: summary.totalRules,
  };
}
