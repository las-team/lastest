import { describe, it, expect } from 'vitest';
import { diffNetworkRequests } from './network-diff';
import type { NetworkRequest } from '../db/schema';

const req = (over: Partial<NetworkRequest>): NetworkRequest => ({
  url: 'https://example.com/x',
  method: 'GET',
  status: 200,
  duration: 100,
  resourceType: 'fetch',
  ...over,
});

describe('diffNetworkRequests', () => {
  it('reports unchanged when both sides match', () => {
    const r = diffNetworkRequests([req({})], [req({})]);
    expect(r.summary.unchanged).toBe(1);
    expect(r.summary.added).toBe(0);
    expect(r.summary.removed).toBe(0);
  });

  it('detects added and removed requests', () => {
    const r = diffNetworkRequests(
      [req({ url: 'https://example.com/a' })],
      [req({ url: 'https://example.com/b' })],
    );
    expect(r.summary.added).toBe(1);
    expect(r.summary.removed).toBe(1);
  });

  it('detects status changes', () => {
    const r = diffNetworkRequests(
      [req({ status: 200 })],
      [req({ status: 500 })],
    );
    expect(r.summary.changed).toBe(1);
    expect(r.rows[0].changes).toContain('status');
  });

  it('ignores volatile URL params by default', () => {
    const r = diffNetworkRequests(
      [req({ url: 'https://example.com/x?t=111' })],
      [req({ url: 'https://example.com/x?t=222' })],
    );
    expect(r.summary.unchanged).toBe(1);
  });

  it('respects ignoreHosts', () => {
    const r = diffNetworkRequests(
      [req({ url: 'https://analytics.com/p' })],
      [],
      { ignoreHosts: ['analytics.com'] },
    );
    expect(r.summary.removed).toBe(0);
  });

  it('matches multiple occurrences of the same URL by index', () => {
    const r = diffNetworkRequests(
      [req({ status: 200 }), req({ status: 200 })],
      [req({ status: 200 }), req({ status: 500 })],
    );
    expect(r.summary.unchanged).toBe(1);
    expect(r.summary.changed).toBe(1);
  });

  it('counts failed delta correctly', () => {
    const r = diffNetworkRequests(
      [req({})],
      [req({ failed: true })],
    );
    expect(r.summary.failedDelta).toBe(1);
  });
});
