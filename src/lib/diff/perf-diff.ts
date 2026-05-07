/**
 * Web Vitals diff — both absolute-budget breach (Lighthouse-CI style) and
 * relative-drift detection (SpeedCurve style).
 *
 * Default budgets (p75-leaning, 2026 Core Web Vitals):
 *   LCP ≤ 2500ms (good); INP ≤ 200ms; CLS ≤ 0.1; FCP ≤ 1800ms; TBT ≤ 200ms; TTFB ≤ 800ms
 * Default drift threshold: 20% worse than baseline.
 *
 * We pair samples by stepIndex. Missing values on either side are skipped.
 */

import type { WebVitalsSample, PerfDiffSummary } from '@/lib/db/schema';

const DEFAULT_BUDGETS: Record<keyof typeof METRIC_DIRECTIONS, number> = {
  lcp: 2500,
  cls: 0.1,
  inp: 200,
  fcp: 1800,
  tbt: 200,
  ttfb: 800,
};

// All current Web Vitals are "lower is better" — so `delta = current - baseline`
// being positive means a regression. Kept as a map for future-proofing if a
// "higher is better" metric is added.
const METRIC_DIRECTIONS = {
  lcp: 'lower' as const,
  cls: 'lower' as const,
  inp: 'lower' as const,
  fcp: 'lower' as const,
  tbt: 'lower' as const,
  ttfb: 'lower' as const,
};

type Metric = keyof typeof METRIC_DIRECTIONS;

interface PerfDiffOptions {
  budgets?: Partial<Record<Metric, number>>;
  /** Relative drift threshold as a fraction. 0.2 means 20% worse than baseline. */
  driftThreshold?: number;
}

export function computePerfDiff(
  baseline: WebVitalsSample[],
  current: WebVitalsSample[],
  options: PerfDiffOptions = {},
): PerfDiffSummary {
  const budgets = { ...DEFAULT_BUDGETS, ...(options.budgets ?? {}) };
  const driftThreshold = options.driftThreshold ?? 0.2;

  const baseByIdx = new Map(baseline.map(s => [s.stepIndex ?? -1, s]));
  const deltas: PerfDiffSummary['deltas'] = [];

  for (const c of current) {
    const idx = c.stepIndex ?? -1;
    const b = baseByIdx.get(idx);
    if (!b) continue;
    for (const metric of Object.keys(METRIC_DIRECTIONS) as Metric[]) {
      const cv = c[metric];
      const bv = b[metric];
      if (typeof cv !== 'number' || typeof bv !== 'number') continue;
      const delta = cv - bv;
      const budget = budgets[metric];
      const budgetBreached = cv > budget;
      // Drift: regressed by > driftThreshold AND moved by an absolute amount
      // worth flagging (avoids noise on tiny CLS deltas like 0.001 → 0.002).
      const minAbsoluteDelta = metric === 'cls' ? 0.05 : metric === 'inp' || metric === 'tbt' ? 30 : 100;
      const drifted = bv > 0 && delta / bv > driftThreshold && Math.abs(delta) >= minAbsoluteDelta;
      if (delta !== 0 || budgetBreached) {
        deltas.push({
          stepIndex: c.stepIndex,
          stepLabel: c.stepLabel ?? b.stepLabel,
          metric,
          baseline: bv,
          current: cv,
          delta,
          budgetBreached,
          drifted,
        });
      }
    }
  }

  return { deltas };
}

export function summarizePerfDiff(d: PerfDiffSummary): string {
  const breaches = d.deltas.filter(x => x.budgetBreached).length;
  const drifts = d.deltas.filter(x => x.drifted && !x.budgetBreached).length;
  if (breaches === 0 && drifts === 0) return 'Within budget';
  const parts: string[] = [];
  if (breaches) parts.push(`${breaches} budget breach(es)`);
  if (drifts) parts.push(`${drifts} drift(s)`);
  return parts.join(', ');
}
