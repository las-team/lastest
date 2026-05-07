/**
 * Accessibility-diff engine — sibling to visual-diff, dom-diff, network-diff.
 *
 * Compares two arrays of axe-core A11yViolation results and produces:
 *  - new violations introduced by side B (regressions)
 *  - violations fixed in side B (improvements)
 *  - same rule with more/fewer affected nodes (regressed/improved)
 *  - per-side WCAG scores from `calculateWcagScore`, plus delta.
 */

import type { A11yViolation, WcagScoreSummary } from '@/lib/db/schema';
import { calculateWcagScore } from '@/lib/a11y/wcag-score';

export interface A11yNodeDelta {
  ruleId: string;
  impact: A11yViolation['impact'];
  nodesA: number;
  nodesB: number;
}

export interface A11yDiffResult {
  newInB: A11yViolation[];
  fixedInB: A11yViolation[];
  regressed: A11yNodeDelta[];
  improved: A11yNodeDelta[];
  scoreA: WcagScoreSummary;
  scoreB: WcagScoreSummary;
  scoreDelta: number;
}

export function computeA11yDiff(
  violationsA: A11yViolation[],
  violationsB: A11yViolation[],
  passesA: number,
  passesB: number,
): A11yDiffResult {
  const mapA = new Map<string, A11yViolation>();
  const mapB = new Map<string, A11yViolation>();
  for (const v of violationsA) mapA.set(v.id, v);
  for (const v of violationsB) mapB.set(v.id, v);

  const newInB: A11yViolation[] = [];
  const fixedInB: A11yViolation[] = [];
  const regressed: A11yNodeDelta[] = [];
  const improved: A11yNodeDelta[] = [];

  for (const [id, b] of mapB) {
    const a = mapA.get(id);
    if (!a) {
      newInB.push(b);
      continue;
    }
    if (b.nodes > a.nodes) {
      regressed.push({ ruleId: id, impact: b.impact, nodesA: a.nodes, nodesB: b.nodes });
    } else if (b.nodes < a.nodes) {
      improved.push({ ruleId: id, impact: b.impact, nodesA: a.nodes, nodesB: b.nodes });
    }
  }
  for (const [id, a] of mapA) {
    if (!mapB.has(id)) fixedInB.push(a);
  }

  const scoreA = calculateWcagScore(violationsA, passesA);
  const scoreB = calculateWcagScore(violationsB, passesB);

  return {
    newInB,
    fixedInB,
    regressed,
    improved,
    scoreA,
    scoreB,
    scoreDelta: scoreB.score - scoreA.score,
  };
}
