import { describe, it, expect } from 'vitest';
import { computeNetworkDiff, normalizeRequestUrl, summarizeNetworkDiff } from './network-diff';
import type { NetworkRequest } from '@/lib/db/schema';

function req(url: string, status: number, method = 'GET'): NetworkRequest {
  return { url, method, status, duration: 100, resourceType: 'fetch' };
}

describe('normalizeRequestUrl', () => {
  it('strips noisy nonces and timestamps', () => {
    expect(normalizeRequestUrl('https://x.com/api?foo=1&_=12345&csrf=abc'))
      .toBe('https://x.com/api?foo=1');
  });
  it('replaces digit-only path segments', () => {
    expect(normalizeRequestUrl('https://x.com/users/123/posts/456'))
      .toBe('https://x.com/users/:id/posts/:id');
  });
  it('replaces hash-like path segments', () => {
    expect(normalizeRequestUrl('https://x.com/files/a1b2c3d4e5f67890abcdef1234567890'))
      .toBe('https://x.com/files/:hash');
  });
  it('sorts retained query params', () => {
    expect(normalizeRequestUrl('https://x.com/api?b=2&a=1'))
      .toBe('https://x.com/api?a=1&b=2');
  });
  it('returns input unchanged for invalid URL', () => {
    expect(normalizeRequestUrl('not a url')).toBe('not a url');
  });
});

describe('computeNetworkDiff', () => {
  it('reports zero diff for identical lists', () => {
    const list = [req('https://x.com/a', 200), req('https://x.com/b', 200)];
    const d = computeNetworkDiff(list, list);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.changed).toBe(0);
    expect(d.unchanged).toBe(2);
    expect(d.newErrorCount).toBe(0);
  });

  it('flags new 5xx as high-signal', () => {
    const baseline = [req('https://x.com/api/users', 200)];
    const current = [req('https://x.com/api/users', 500)];
    const d = computeNetworkDiff(baseline, current);
    expect(d.changed).toBe(1);
    expect(d.newServerErrors).toHaveLength(1);
    expect(d.newServerErrors[0].status).toBe(500);
    expect(d.newErrorCount).toBe(1);
  });

  it('flags new 4xx as high-signal', () => {
    const baseline = [req('https://x.com/api/users', 200)];
    const current = [req('https://x.com/api/users', 404)];
    const d = computeNetworkDiff(baseline, current);
    expect(d.newClientErrors).toHaveLength(1);
    expect(d.newErrorCount).toBe(1);
  });

  it('does not double-count when 4xx → 5xx (still one new error category)', () => {
    const baseline = [req('https://x.com/api/users', 404)];
    const current = [req('https://x.com/api/users', 503)];
    const d = computeNetworkDiff(baseline, current);
    // 5xx is a new server-error class even though baseline was already 4xx.
    expect(d.newServerErrors).toHaveLength(1);
    expect(d.newClientErrors).toHaveLength(0);
  });

  it('records added requests (excess on current side)', () => {
    const baseline = [req('https://x.com/a', 200)];
    const current = [req('https://x.com/a', 200), req('https://x.com/b', 200)];
    const d = computeNetworkDiff(baseline, current);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
  });

  it('records removed requests', () => {
    const baseline = [req('https://x.com/a', 200), req('https://x.com/b', 200)];
    const current = [req('https://x.com/a', 200)];
    const d = computeNetworkDiff(baseline, current);
    expect(d.removed).toBe(1);
    expect(d.added).toBe(0);
  });

  it('treats nonce-only differences as same key', () => {
    const baseline = [req('https://x.com/api?_=111&foo=1', 200)];
    const current = [req('https://x.com/api?_=222&foo=1', 200)];
    const d = computeNetworkDiff(baseline, current);
    expect(d.unchanged).toBe(1);
    expect(d.added).toBe(0);
  });

  it('records status flips for non-error transitions', () => {
    const baseline = [req('https://x.com/api', 301)];
    const current = [req('https://x.com/api', 200)];
    const d = computeNetworkDiff(baseline, current);
    expect(d.statusFlips).toHaveLength(1);
    expect(d.statusFlips[0].from).toBe(301);
    expect(d.statusFlips[0].to).toBe(200);
    expect(d.newErrorCount).toBe(0);
  });
});

describe('summarizeNetworkDiff', () => {
  it('prioritizes server errors in summary', () => {
    const baseline = [req('https://x.com/a', 200)];
    const current = [req('https://x.com/a', 500)];
    const d = computeNetworkDiff(baseline, current);
    expect(summarizeNetworkDiff(d)).toContain('1 new 5xx');
  });

  it('reports no changes for identical lists', () => {
    const list = [req('https://x.com/a', 200)];
    const d = computeNetworkDiff(list, list);
    expect(summarizeNetworkDiff(d)).toBe('No network changes');
  });
});
