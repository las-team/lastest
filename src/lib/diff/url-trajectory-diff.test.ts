import { describe, it, expect } from 'vitest';
import { computeUrlTrajectoryDiff, normalizeTrajectoryUrl } from './url-trajectory-diff';
import type { UrlTrajectoryStep } from '@/lib/db/schema';

function step(stepIndex: number, finalUrl: string, redirectChain: string[] = []): UrlTrajectoryStep {
  return { stepIndex, finalUrl, redirectChain };
}

describe('normalizeTrajectoryUrl', () => {
  it('strips OAuth state/code query params', () => {
    expect(normalizeTrajectoryUrl('https://x.com/cb?state=abc&code=xyz&keep=1'))
      .toBe('https://x.com/cb?keep=1');
  });

  it('replaces digit-only path segments with :id', () => {
    expect(normalizeTrajectoryUrl('https://x.com/orders/123'))
      .toBe('https://x.com/orders/:id');
  });

  it('handles invalid URLs gracefully', () => {
    expect(normalizeTrajectoryUrl('about:blank')).toBe('about:blank');
  });
});

describe('computeUrlTrajectoryDiff', () => {
  it('returns empty diff for identical trajectories', () => {
    const t = [step(0, 'https://x.com/'), step(1, 'https://x.com/dashboard')];
    const d = computeUrlTrajectoryDiff(t, t);
    expect(d.divergedSteps).toHaveLength(0);
    expect(d.totalStepsCompared).toBe(2);
  });

  it('flags route divergence (auth regression)', () => {
    const baseline = [step(1, 'https://x.com/dashboard')];
    const current = [step(1, 'https://x.com/login')];
    const d = computeUrlTrajectoryDiff(baseline, current);
    expect(d.divergedSteps).toHaveLength(1);
    expect(d.divergedSteps[0].baselineUrl).toContain('dashboard');
    expect(d.divergedSteps[0].currentUrl).toContain('login');
  });

  it('treats /orders/123 vs /orders/456 as the same route (not a regression)', () => {
    const baseline = [step(1, 'https://x.com/orders/123')];
    const current = [step(1, 'https://x.com/orders/456')];
    const d = computeUrlTrajectoryDiff(baseline, current);
    expect(d.divergedSteps).toHaveLength(0);
  });

  it('flags redirect-chain-length changes', () => {
    const baseline = [step(0, 'https://x.com/d', [])];
    const current = [step(0, 'https://x.com/d', ['https://sso.example.com/auth', 'https://x.com/d'])];
    const d = computeUrlTrajectoryDiff(baseline, current);
    expect(d.divergedSteps).toHaveLength(1);
    expect(d.divergedSteps[0].redirectChainChanged).toBe(true);
  });

  it('skips steps that exist in only one trajectory', () => {
    const baseline = [step(0, 'https://x.com/'), step(1, 'https://x.com/d')];
    const current = [step(0, 'https://x.com/')];
    const d = computeUrlTrajectoryDiff(baseline, current);
    expect(d.divergedSteps).toHaveLength(0);
    expect(d.totalStepsCompared).toBe(1);
  });
});
