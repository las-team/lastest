import { describe, it, expect } from 'vitest';
import { computeConsoleDiff, fingerprintConsoleMessage, classifyConsoleFingerprint } from './console-diff';

describe('fingerprintConsoleMessage', () => {
  it('collapses messages that differ only by ID', () => {
    const a = fingerprintConsoleMessage('TypeError: Cannot read property "id" of user 123');
    const b = fingerprintConsoleMessage('TypeError: Cannot read property "id" of user 456');
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('collapses messages that differ only by URL', () => {
    const a = fingerprintConsoleMessage('Failed to load https://api.example.com/users/1');
    const b = fingerprintConsoleMessage('Failed to load https://api.example.com/users/2');
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('keeps distinct messages distinct', () => {
    const a = fingerprintConsoleMessage('TypeError: Cannot read property of null');
    const b = fingerprintConsoleMessage('ReferenceError: foo is not defined');
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('preserves a sample of the original head', () => {
    const result = fingerprintConsoleMessage('TypeError: Cannot read property "x"\n  at frame.js:10:20');
    expect(result.sample).toContain('TypeError');
  });
});

describe('computeConsoleDiff', () => {
  it('reports zero diff for identical lists', () => {
    const list = ['TypeError: foo is undefined', 'Warning: legacy API'];
    const d = computeConsoleDiff(list, list);
    expect(d.newFingerprints).toHaveLength(0);
    expect(d.disappeared).toHaveLength(0);
  });

  it('flags new fingerprints in current', () => {
    const baseline = ['TypeError: foo is undefined'];
    const current = ['TypeError: foo is undefined', 'ReferenceError: bar'];
    const d = computeConsoleDiff(baseline, current);
    expect(d.newFingerprints).toHaveLength(1);
    expect(d.newFingerprints[0].sample).toContain('ReferenceError');
  });

  it('flags disappeared fingerprints', () => {
    const baseline = ['Old error'];
    const current = ['New error'];
    const d = computeConsoleDiff(baseline, current);
    expect(d.newFingerprints).toHaveLength(1);
    expect(d.disappeared).toHaveLength(1);
  });

  it('reports count deltas for shared fingerprints', () => {
    const baseline = ['Bug X', 'Bug X'];
    const current = ['Bug X', 'Bug X', 'Bug X', 'Bug X'];
    const d = computeConsoleDiff(baseline, current);
    expect(Object.values(d.countDelta)[0]).toBe(2);
  });

  it('treats ID/URL variants as the same fingerprint (Sentry-style dedup)', () => {
    const baseline = ['Error fetching /users/1', 'Error fetching /users/2'];
    const current = ['Error fetching /users/3'];
    const d = computeConsoleDiff(baseline, current);
    // Same fingerprint, just count delta — not new + disappeared
    expect(d.newFingerprints).toHaveLength(0);
    expect(d.disappeared).toHaveLength(0);
    expect(Object.values(d.countDelta)[0]).toBe(-1);
  });
});

describe('classifyConsoleFingerprint', () => {
  it('flags Cloudflare email-decode noise as thirdParty', () => {
    expect(classifyConsoleFingerprint(
      'Failed to decode address',
      '    at https://cdn.example.com/cdn-cgi/scripts/email-decode.min.js:1:200',
    )).toBe('thirdParty');
  });

  it('flags Google Tag Manager as thirdParty', () => {
    expect(classifyConsoleFingerprint(
      'gtag is not a function',
      '    at https://www.googletagmanager.com/gtm.js:5:42',
    )).toBe('thirdParty');
  });

  it('flags Failed-to-load-resource as network', () => {
    expect(classifyConsoleFingerprint(
      'Failed to load resource: the server responded with a status of 429 ()',
      '',
    )).toBe('network');
  });

  it('flags CSP refusals as csp', () => {
    expect(classifyConsoleFingerprint(
      "Refused to execute inline script because it violates the following Content Security Policy directive",
      '',
    )).toBe('csp');
  });

  it('flags app-origin stack frames as app', () => {
    expect(classifyConsoleFingerprint(
      'TypeError: Cannot read property "x" of undefined',
      '    at O (https://app.lastest.cloud/_next/static/chunks/main.js:42:7)',
    )).toBe('app');
  });

  it('returns unknown when there is no stack URL and no message pattern', () => {
    expect(classifyConsoleFingerprint('something happened', '')).toBe('unknown');
  });
});
