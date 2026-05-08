import { describe, it, expect } from 'vitest';
import {
  computeNetworkDiff,
  isThirdParty,
  normalizeUrl,
  type NetworkRequestLike,
} from './network-diff';

const req = (over: Partial<NetworkRequestLike> = {}): NetworkRequestLike => ({
  url: 'https://example.com/',
  method: 'GET',
  status: 200,
  duration: 100,
  resourceType: 'document',
  responseSize: 1000,
  ...over,
});

describe('normalizeUrl', () => {
  it('strips known cache-busting params', () => {
    const out = normalizeUrl('https://x.io/a?_t=1700000000&cb=abc&page=2');
    expect(out).toBe('https://x.io/a?page=2');
  });
  it('strips hex nonces', () => {
    const out = normalizeUrl('https://x.io/a?token=1234567890ab&page=2');
    expect(out).toBe('https://x.io/a?page=2');
  });
  it('sorts remaining params (idempotent)', () => {
    const a = normalizeUrl('https://x.io/p?b=2&a=1');
    const b = normalizeUrl('https://x.io/p?a=1&b=2');
    expect(a).toBe(b);
  });
  it('drops hash', () => {
    expect(normalizeUrl('https://x.io/p#frag')).toBe('https://x.io/p');
  });
  it('returns input on parse failure', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('isThirdParty', () => {
  it('same host is first-party', () => {
    expect(isThirdParty('example.com', 'example.com')).toBe(false);
  });
  it('subdomain is first-party (suffix-after-dot)', () => {
    expect(isThirdParty('cdn.example.com', 'example.com')).toBe(false);
  });
  it('similar but distinct host is third-party', () => {
    expect(isThirdParty('foo-example.com', 'example.com')).toBe(true);
  });
  it('unrelated host is third-party', () => {
    expect(isThirdParty('analytics.google.com', 'example.com')).toBe(true);
  });
  it('empty inputs are third-party', () => {
    expect(isThirdParty('', 'example.com')).toBe(true);
  });
});

describe('computeNetworkDiff', () => {
  it('identical inputs produce no diffs', () => {
    const reqs = [req()];
    const out = computeNetworkDiff(reqs, reqs, 'example.com', 'example.com');
    expect(out.added).toHaveLength(0);
    expect(out.removed).toHaveLength(0);
    expect(out.changedStatus).toHaveLength(0);
    expect(out.changedSize).toHaveLength(0);
  });
  it('status change is captured', () => {
    const a = [req({ status: 200 })];
    const b = [req({ status: 500 })];
    const out = computeNetworkDiff(a, b, 'example.com', 'example.com');
    expect(out.changedStatus).toHaveLength(1);
    expect(out.changedStatus[0]?.baseline?.status).toBe(200);
    expect(out.changedStatus[0]?.current?.status).toBe(500);
  });
  it('only-in-B URL → added', () => {
    const a: NetworkRequestLike[] = [];
    const b = [req({ url: 'https://example.com/new' })];
    const out = computeNetworkDiff(a, b, 'example.com', 'example.com');
    expect(out.added).toHaveLength(1);
    expect(out.removed).toHaveLength(0);
  });
  it('only-in-A URL → removed', () => {
    const a = [req({ url: 'https://example.com/gone' })];
    const b: NetworkRequestLike[] = [];
    const out = computeNetworkDiff(a, b, 'example.com', 'example.com');
    expect(out.removed).toHaveLength(1);
    expect(out.added).toHaveLength(0);
  });
  it('size delta > 10% → changedSize', () => {
    const a = [req({ responseSize: 1000 })];
    const b = [req({ responseSize: 1200 })];
    const out = computeNetworkDiff(a, b, 'example.com', 'example.com');
    expect(out.changedSize).toHaveLength(1);
  });
  it('size delta < 10% → no changedSize', () => {
    const a = [req({ responseSize: 1000 })];
    const b = [req({ responseSize: 1050 })];
    const out = computeNetworkDiff(a, b, 'example.com', 'example.com');
    expect(out.changedSize).toHaveLength(0);
  });
  it('slowdown beyond threshold and ratio', () => {
    const a = [req({ duration: 100 })];
    const b = [req({ duration: 400 })];
    const out = computeNetworkDiff(a, b, 'example.com', 'example.com');
    expect(out.slowdowns).toHaveLength(1);
  });
  it('cache-busted URLs match across nonces', () => {
    const a = [req({ url: 'https://example.com/api?_t=111' })];
    const b = [req({ url: 'https://example.com/api?_t=999', status: 404 })];
    const out = computeNetworkDiff(a, b, 'example.com', 'example.com');
    expect(out.added).toHaveLength(0);
    expect(out.changedStatus).toHaveLength(1);
  });
  it('summary counts third-party domains by host', () => {
    const a = [
      req({ url: 'https://example.com/' }),
      req({ url: 'https://analytics.google.com/track' }),
    ];
    const out = computeNetworkDiff(a, a, 'example.com', 'example.com');
    expect(out.summary.thirdPartyDomainsA).toEqual(['analytics.google.com']);
    expect(out.summary.countA).toBe(2);
  });
  it('failed requests are listed per-side', () => {
    const a = [req({ failed: true })];
    const b = [req()];
    const out = computeNetworkDiff(a, b, 'example.com', 'example.com');
    expect(out.failedA).toHaveLength(1);
    expect(out.failedB).toHaveLength(0);
  });
});
