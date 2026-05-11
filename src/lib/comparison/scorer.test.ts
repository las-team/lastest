import { describe, it, expect } from 'vitest';
import { scoreMultiLayer } from './scorer';
import type { NetworkRequest, A11yViolation, UrlTrajectoryStep } from '@/lib/db/schema';

type ScoreInput = Parameters<typeof scoreMultiLayer>[0]['baseline'];

function emptyResult(overrides: Partial<NonNullable<ScoreInput>> = {}): NonNullable<ScoreInput> {
  return {
    consoleErrors: null,
    networkRequests: null,
    a11yViolations: null,
    urlTrajectory: null,
    webVitals: null,
    extractedVariables: null,
    ...overrides,
  } as NonNullable<ScoreInput>;
}

describe('scoreMultiLayer', () => {
  it('returns green when all layers are quiet', () => {
    const baseline = emptyResult();
    const current = emptyResult();
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('green');
    expect(r.evidence).toHaveLength(0);
  });

  it('returns red on a new console fingerprint alone', () => {
    const baseline = emptyResult();
    const current = emptyResult({ consoleErrors: ['ReferenceError: foo is not defined'] });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('red');
    expect(r.evidence.find(e => e.layer === 'console')?.signal).toBe('high');
  });

  it('returns red on a new 5xx response', () => {
    const baseline = emptyResult({ networkRequests: [{ url: 'https://x/a', method: 'GET', status: 200, duration: 50, resourceType: 'fetch' } as NetworkRequest] });
    const current = emptyResult({ networkRequests: [{ url: 'https://x/a', method: 'GET', status: 500, duration: 50, resourceType: 'fetch' } as NetworkRequest] });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('red');
    expect(r.evidence.find(e => e.layer === 'network')?.signal).toBe('high');
  });

  it('returns red on URL-trajectory divergence', () => {
    const baseline = emptyResult({ urlTrajectory: [{ stepIndex: 0, finalUrl: 'https://x/dashboard', redirectChain: [] } as UrlTrajectoryStep] });
    const current = emptyResult({ urlTrajectory: [{ stepIndex: 0, finalUrl: 'https://x/login', redirectChain: [] } as UrlTrajectoryStep] });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('red');
  });

  it('returns red on a new critical a11y violation', () => {
    const v = (id: string, impact: A11yViolation['impact']): A11yViolation => ({
      id, impact, description: id, help: id, helpUrl: '', nodes: 1,
    });
    const baseline = emptyResult();
    const current = emptyResult({ a11yViolations: [v('button-name', 'critical')] });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('red');
  });

  it('returns yellow for visual-only change', () => {
    const r = scoreMultiLayer({
      baseline: emptyResult(),
      current: emptyResult(),
      visualDiff: { pixelDifference: 1234, percentageDifference: '0.5', id: 'd1' },
    });
    expect(r.verdict).toBe('yellow');
    expect(r.evidence.find(e => e.layer === 'visual')?.signal).toBe('medium');
  });

  it('returns yellow for structural-break in extracted variables', () => {
    // structural-break is high-signal in this rubric — should be RED.
    const baseline = emptyResult({ extractedVariables: { user: 'alice' } });
    const current = emptyResult({ extractedVariables: { user: 'alice', extra: 'x' } });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('red');
  });

  it('returns yellow for value-only variable change', () => {
    const baseline = emptyResult({ extractedVariables: { count: '5' } });
    const current = emptyResult({ extractedVariables: { count: '6' } });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('yellow');
  });

  it('respects variable ignorePaths', () => {
    const baseline = emptyResult({ extractedVariables: { sessionId: 'a' } });
    const current = emptyResult({ extractedVariables: { sessionId: 'b' } });
    const r = scoreMultiLayer({
      baseline, current, variableIgnorePaths: ['sessionId'],
    });
    expect(r.verdict).toBe('green');
  });
});
