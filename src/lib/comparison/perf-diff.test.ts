import { describe, it, expect } from 'vitest';
import { computePerfDiff, summarizePerfDiff } from './perf-diff';
import type { WebVitalsSample } from '@/lib/db/schema';

function s(stepIndex: number, partial: Partial<WebVitalsSample> = {}): WebVitalsSample {
  return { stepIndex, url: 'https://x.com/', ...partial };
}

describe('computePerfDiff', () => {
  it('returns empty deltas for matching samples', () => {
    const sample = [s(0, { lcp: 1500, cls: 0.05, inp: 100, fcp: 800, tbt: 50 })];
    const d = computePerfDiff(sample, sample);
    expect(d.deltas).toHaveLength(0);
  });

  it('flags absolute budget breach for LCP', () => {
    const baseline = [s(0, { lcp: 2000 })];
    const current = [s(0, { lcp: 3000 })];
    const d = computePerfDiff(baseline, current);
    const lcp = d.deltas.find(x => x.metric === 'lcp');
    expect(lcp?.budgetBreached).toBe(true);
    expect(lcp?.newlyBreached).toBe(true);
    expect(lcp?.delta).toBe(1000);
  });

  it('marks pre-existing breach as budgetBreached but NOT newlyBreached', () => {
    // Baseline already over budget; current is essentially identical. Scorer
    // must not flip the verdict to red on a stable, already-broken page.
    const baseline = [s(0, { cls: 0.4 })];
    const current = [s(0, { cls: 0.4 })];
    const d = computePerfDiff(baseline, current);
    const cls = d.deltas.find(x => x.metric === 'cls');
    expect(cls?.budgetBreached).toBe(true);
    expect(cls?.newlyBreached).toBe(false);
    expect(cls?.delta).toBe(0);
  });

  it('does not mark newlyBreached when baseline was already over budget', () => {
    const baseline = [s(0, { lcp: 3000 })];
    const current = [s(0, { lcp: 3050 })];
    const d = computePerfDiff(baseline, current);
    const lcp = d.deltas.find(x => x.metric === 'lcp');
    expect(lcp?.budgetBreached).toBe(true);
    expect(lcp?.newlyBreached).toBe(false);
  });

  it('flags relative drift even within budget', () => {
    const baseline = [s(0, { lcp: 1000 })];
    const current = [s(0, { lcp: 1500 })]; // 50% worse, still under 2500ms budget
    const d = computePerfDiff(baseline, current);
    const lcp = d.deltas.find(x => x.metric === 'lcp');
    expect(lcp?.budgetBreached).toBe(false);
    expect(lcp?.drifted).toBe(true);
  });

  it('does not mark drift for trivial absolute changes', () => {
    const baseline = [s(0, { cls: 0.001 })];
    const current = [s(0, { cls: 0.005 })]; // 5x worse, but tiny absolute
    const d = computePerfDiff(baseline, current);
    const cls = d.deltas.find(x => x.metric === 'cls');
    expect(cls?.drifted).toBe(false);
  });

  it('skips metrics missing on either side', () => {
    const baseline = [s(0, { lcp: 1500 })];
    const current = [s(0, { fcp: 800 })];
    const d = computePerfDiff(baseline, current);
    expect(d.deltas).toHaveLength(0);
  });

  it('respects custom budgets', () => {
    const baseline = [s(0, { lcp: 800 })];
    const current = [s(0, { lcp: 900 })];
    const d = computePerfDiff(baseline, current, { budgets: { lcp: 850 } });
    const lcp = d.deltas.find(x => x.metric === 'lcp');
    expect(lcp?.budgetBreached).toBe(true);
  });
});

describe('summarizePerfDiff', () => {
  it('reports within-budget when no breaches or drifts', () => {
    const sample = [s(0, { lcp: 1500 })];
    expect(summarizePerfDiff(computePerfDiff(sample, sample))).toBe('Within budget');
  });

  it('separates new breaches from pre-existing ones', () => {
    const baseline = [s(0, { lcp: 3000, cls: 0.05 })];
    const current = [s(0, { lcp: 3050, cls: 0.4 })];
    const summary = summarizePerfDiff(computePerfDiff(baseline, current));
    expect(summary).toContain('1 new breach');
    expect(summary).toContain('1 pre-existing breach');
  });
});
