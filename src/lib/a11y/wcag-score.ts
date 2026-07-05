/**
 * WCAG compliance score calculation.
 * Computes a 0–100 score from axe-core violations with severity weighting.
 */

import type { A11yViolation, WcagScoreSummary } from "@/lib/db/schema";

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
};

// Softened from A:1.5 — a 1.5× multiplier on every level-A rule (and level-A is
// the default when no level resolves) made common rules deduct 50% extra and was
// a big contributor to polished sites scoring near-zero (spec §3.5).
const LEVEL_MULTIPLIERS: Record<string, number> = {
  A: 1.15,
  AA: 1.0,
  AAA: 0.6,
};

// Credit each passing axe rule contributes to the weighted pass-ratio. Tuned so
// a site that passes most of axe's ~90 rules with a handful of violations lands
// in the A/B band instead of collapsing to 0.
const PASS_WEIGHT = 3;

// Decay constant for the no-passes fallback (see below). Chosen so a moderate
// penalty (~40 weighted points) lands around 50 rather than snapping to 0.
const NO_PASS_DECAY = 40;

/**
 * Derive WCAG conformance level from axe-core tags.
 */
export function getWcagLevel(tags?: string[]): "A" | "AA" | "AAA" | undefined {
  if (!tags) return undefined;
  if (tags.some((t) => t.startsWith("wcag2aaa") || t === "wcag22aaa"))
    return "AAA";
  if (
    tags.some(
      (t) => t.startsWith("wcag2aa") || t === "wcag22aa" || t === "wcag21aa",
    )
  )
    return "AA";
  if (tags.some((t) => t.startsWith("wcag2a") || t === "wcag21a")) return "A";
  return undefined;
}

/**
 * Calculate a WCAG compliance score from violations (0–100).
 *
 * Calibrated model (spec §3.5). The previous model summed an UNBOUNDED
 * per-violation deduction (`severity × min(nodes,3) × level`, up to 45 points
 * for a single critical-A rule) and ignored `passesCount` entirely, so any
 * realistic page tripping 8–15 rules blew past 100 and clamped to 0 — a polished
 * product and a broken one scored identically.
 *
 * Now:
 *   - Each violated rule contributes a BOUNDED penalty:
 *       severity_weight × (min(nodes,3) / 3) × level_multiplier
 *     (node count is a 0.33–1 severity factor, never an unbounded multiplier).
 *   - The score is a weighted PASS-RATIO — passing hundreds of axe checks buoys
 *     the score: 100 × passWeight / (passWeight + failWeight).
 *   - When no passes were captured (passWeight = 0) we can't form a ratio, so we
 *     fall back to a bounded exponential decay that degrades gracefully instead
 *     of snapping to 0 on the first violation.
 */
export function calculateWcagScore(
  violations: A11yViolation[],
  passesCount?: number,
): WcagScoreSummary {
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };

  let failWeight = 0;

  for (const v of violations) {
    const severity = v.impact ?? "moderate";
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;

    const weight = SEVERITY_WEIGHTS[severity] ?? 2;
    // Tolerate legacy/raw axe shapes where `nodes` arrived as an array
    // instead of a count — otherwise the factor becomes NaN and poisons the
    // build a11y_score. Source remap is in
    // packages/embedded-browser/src/test-executor.ts and
    // src/lib/url-diff/capture.ts.
    const rawNodes = v.nodes as unknown;
    const nodeCount = Array.isArray(rawNodes)
      ? rawNodes.length
      : typeof rawNodes === "number" && Number.isFinite(rawNodes)
        ? rawNodes
        : 1;
    // Bounded 0.33–1: more offending nodes hurt more, but a single rule can
    // never dominate the whole score.
    const nodeFactor = Math.min(nodeCount, 3) / 3;
    const level = v.wcagLevel ?? getWcagLevel(v.tags) ?? "AA";
    const levelMultiplier = LEVEL_MULTIPLIERS[level] ?? 1.0;

    failWeight += weight * nodeFactor * levelMultiplier;
  }

  const violatedRules = violations.length;
  const passedRules = passesCount ?? 0;
  const totalRules = passedRules + violatedRules;

  const passWeight = passedRules * PASS_WEIGHT;
  let score: number;
  if (passWeight > 0) {
    score = Math.round((100 * passWeight) / (passWeight + failWeight));
  } else if (failWeight > 0) {
    score = Math.round(100 * Math.exp(-failWeight / NO_PASS_DECAY));
  } else {
    score = 100;
  }
  score = Math.max(0, Math.min(100, score));

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
  results: Array<{
    a11yViolations?: A11yViolation[] | null;
    a11yPassesCount?: number | null;
  }>,
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
  const criticalCount =
    summary.bySeverity.critical + summary.bySeverity.serious;

  return {
    score: summary.score,
    violationCount: allViolations.length,
    criticalCount,
    totalRulesChecked: summary.totalRules,
  };
}
