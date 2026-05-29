import { describe, it, expect } from 'vitest';
import { scoreMultiLayer } from './scorer';
import type { NetworkRequest, A11yViolation, UrlTrajectoryStep, WebVitalsSample } from '@/lib/db/schema';

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

  it('does NOT paint verdict red when only a third-party SDK fingerprint is new', () => {
    // Cloudflare email-decoder fires on every page with an obfuscated mailto.
    // Demoting third-party noise from high→medium prevents this from gating.
    const baseline = emptyResult();
    const current = emptyResult({
      consoleErrors: [
        'Failed to decode address\n    at https://cdn.example.com/cdn-cgi/scripts/email-decode.min.js:1:200',
      ],
    });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('yellow');
    expect(r.evidence.find(e => e.layer === 'console')?.signal).toBe('medium');
  });

  it('does NOT paint verdict red when only a transient network fingerprint is new', () => {
    // "Failed to load resource: ... 429" surfaces via console but is a network
    // signal — the network layer already gates 4xx/5xx; console should not
    // double-count it as an app exception.
    const baseline = emptyResult();
    const current = emptyResult({
      consoleErrors: ['Failed to load resource: the server responded with a status of 429 ()'],
    });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('yellow');
    expect(r.evidence.find(e => e.layer === 'console')?.signal).toBe('medium');
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

  it('does not fail when only the redirect-chain length changed (same final URL)', () => {
    // CDN/A-B/auth-cache adds or removes a hop; final URL is identical after normalization.
    const baseline = emptyResult({
      urlTrajectory: [{ stepIndex: 0, finalUrl: 'https://excalidraw.com/', redirectChain: ['https://excalidraw.com/'] } as UrlTrajectoryStep],
    });
    const current = emptyResult({
      urlTrajectory: [{ stepIndex: 0, finalUrl: 'https://excalidraw.com/', redirectChain: ['https://www.excalidraw.com/', 'https://excalidraw.com/'] } as UrlTrajectoryStep],
    });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('green');
    const url = r.evidence.find(e => e.layer === 'url');
    expect(url?.signal).toBe('low');
    expect(r.layers.url?.divergedSteps).toHaveLength(1);
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

  it('first run (null baseline) silently establishes baseline — no non-visual evidence', () => {
    const current = emptyResult({
      consoleErrors: ['ReferenceError: foo is not defined'],
      networkRequests: [{ url: 'https://x/a', method: 'GET', status: 500, duration: 50, resourceType: 'fetch' } as NetworkRequest],
      urlTrajectory: [{ stepIndex: 0, finalUrl: 'https://x/dashboard', redirectChain: [] } as UrlTrajectoryStep],
      extractedVariables: { fresh: 'value' },
    });
    const r = scoreMultiLayer({ baseline: null, current });
    expect(r.verdict).toBe('green');
    expect(r.evidence.filter(e => e.layer !== 'visual')).toHaveLength(0);
    expect(Object.keys(r.layers)).toHaveLength(0);
  });

  it('first run with visual delta still surfaces visual yellow', () => {
    const current = emptyResult({ consoleErrors: ['boom'] });
    const r = scoreMultiLayer({
      baseline: null,
      current,
      visualDiff: { pixelDifference: 42, percentageDifference: '0.1', id: 'd1' },
    });
    expect(r.verdict).toBe('yellow');
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0].layer).toBe('visual');
    expect(r.layers.visual).toBeDefined();
    expect(r.layers.consoleDiff).toBeUndefined();
  });

  it('does not paint verdict red when only a pre-existing perf breach is present', () => {
    // Baseline already over CLS budget (0.4 vs 0.1) and current is identical.
    // This is the "every run inherits the same red" trap — must stay green.
    const sample: WebVitalsSample[] = [
      { stepIndex: 0, url: 'https://x/dashboard', cls: 0.4 } as WebVitalsSample,
    ];
    const baseline = emptyResult({ webVitals: sample });
    const current = emptyResult({ webVitals: sample });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('green');
    expect(r.evidence.find(e => e.layer === 'perf')?.signal).toBe('low');
    expect(r.layers.perf?.deltas.some(d => d.budgetBreached)).toBe(true);
    expect(r.layers.perf?.deltas.some(d => d.newlyBreached)).toBe(false);
  });

  it('paints verdict red when a NEW perf breach is introduced', () => {
    const baseline = emptyResult({
      webVitals: [{ stepIndex: 0, url: 'https://x/dashboard', cls: 0.05 } as WebVitalsSample],
    });
    const current = emptyResult({
      webVitals: [{ stepIndex: 0, url: 'https://x/dashboard', cls: 0.4 } as WebVitalsSample],
    });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('red');
    expect(r.evidence.find(e => e.layer === 'perf')?.signal).toBe('high');
  });

  it('network non-error churn (added/removed of 200s) does not paint verdict', () => {
    const baseline = emptyResult({
      networkRequests: [
        { url: 'https://x/a', method: 'GET', status: 200, duration: 50, resourceType: 'fetch' } as NetworkRequest,
      ],
    });
    const current = emptyResult({
      networkRequests: [
        { url: 'https://x/a', method: 'GET', status: 200, duration: 50, resourceType: 'fetch' } as NetworkRequest,
        { url: 'https://x/b', method: 'GET', status: 200, duration: 50, resourceType: 'fetch' } as NetworkRequest,
      ],
    });
    const r = scoreMultiLayer({ baseline, current });
    expect(r.verdict).toBe('green');
    expect(r.evidence.find(e => e.layer === 'network')?.signal).toBe('low');
    expect(r.layers.network).toBeDefined();
    expect(r.layers.network?.added).toBe(1);
  });
});
