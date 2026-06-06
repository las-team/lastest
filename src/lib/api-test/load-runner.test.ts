import { describe, it, expect } from 'vitest';
import { percentile, summarizeLoad } from './load-runner';

describe('percentile', () => {
  it('uses nearest-rank and handles edges', () => {
    const s = [10, 20, 30, 40, 50];
    expect(percentile(s, 50)).toBe(30);
    expect(percentile(s, 95)).toBe(50);
    expect(percentile(s, 100)).toBe(50);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('summarizeLoad', () => {
  it('passes when within thresholds', () => {
    const r = summarizeLoad([100, 120, 110, 130], 0, 1000, { p95Ms: 200, maxErrorRate: 0.01 });
    expect(r.passed).toBe(true);
    expect(r.count).toBe(4);
    expect(r.errorRate).toBe(0);
    expect(r.breaches).toEqual([]);
  });

  it('flags a p95 breach', () => {
    const r = summarizeLoad([100, 100, 100, 5000], 0, 1000, { p95Ms: 500 });
    expect(r.passed).toBe(false);
    expect(r.breaches.join()).toMatch(/p95/);
  });

  it('flags an error-rate breach and computes throughput', () => {
    const r = summarizeLoad([50, 50, 50, 50], 2, 1000, { maxErrorRate: 0.1 });
    expect(r.errorRate).toBe(0.5);
    expect(r.passed).toBe(false);
    expect(r.throughputRps).toBe(4); // 4 requests / 1s
  });

  it('flags a min-throughput breach', () => {
    const r = summarizeLoad([10, 10], 0, 2000, { minThroughputRps: 100 });
    expect(r.breaches.join()).toMatch(/throughput/);
  });
});
