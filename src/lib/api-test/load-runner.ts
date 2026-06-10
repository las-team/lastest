/**
 * Load runner for API tests (E3). Drives `runApiTest` with a bounded
 * concurrency pool and aggregates latency percentiles + error rate. The
 * aggregation (`summarizeLoad`) is pure for unit testing.
 */

import { runApiTest, type RunApiTestContext } from './runner';
import {
  DEFAULT_LOAD_TEST_THRESHOLDS,
  LOAD_TEST_MAX_CONCURRENCY,
  LOAD_TEST_MAX_TOTAL_REQUESTS,
} from '@/lib/db/schema';
import type { ApiTestDefinition, LoadTestConfig, LoadTestResultData, LoadTestThresholds } from '@/lib/db/schema';

/** Nearest-rank percentile over an unsorted sample. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))];
}

/** Pure aggregation of per-request latencies + failures into a load result. */
export function summarizeLoad(
  latencies: number[],
  failures: number,
  wallMs: number,
  thresholds: LoadTestThresholds,
): LoadTestResultData {
  const count = latencies.length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const errorRate = count > 0 ? failures / count : 0;
  const throughputRps = wallMs > 0 ? (count / wallMs) * 1000 : 0;

  const breaches: string[] = [];
  if (thresholds.p95Ms !== undefined && percentile(sorted, 95) > thresholds.p95Ms) {
    breaches.push(`p95 ${percentile(sorted, 95)}ms > ${thresholds.p95Ms}ms`);
  }
  if (thresholds.p99Ms !== undefined && percentile(sorted, 99) > thresholds.p99Ms) {
    breaches.push(`p99 ${percentile(sorted, 99)}ms > ${thresholds.p99Ms}ms`);
  }
  if (thresholds.maxErrorRate !== undefined && errorRate > thresholds.maxErrorRate) {
    breaches.push(`error rate ${(errorRate * 100).toFixed(1)}% > ${(thresholds.maxErrorRate * 100).toFixed(1)}%`);
  }
  if (thresholds.minThroughputRps !== undefined && throughputRps < thresholds.minThroughputRps) {
    breaches.push(`throughput ${throughputRps.toFixed(1)} rps < ${thresholds.minThroughputRps} rps`);
  }

  return {
    count,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: count > 0 ? Math.round(sum / count) : 0,
    min: sorted[0] ?? 0,
    max: sorted[count - 1] ?? 0,
    throughputRps: Math.round(throughputRps * 100) / 100,
    errorRate: Math.round(errorRate * 1000) / 1000,
    passed: breaches.length === 0,
    breaches,
  };
}

export async function runApiLoadTest(
  def: ApiTestDefinition,
  config: LoadTestConfig,
  ctx: RunApiTestContext = {},
): Promise<LoadTestResultData> {
  const concurrency = Math.max(1, Math.min(config.concurrency || 1, LOAD_TEST_MAX_CONCURRENCY));
  // Stop on a request budget (totalRequests, which wins when both are set) or a
  // wall-clock window (durationMs). The hard cap always protects target + host.
  const durationMode = config.totalRequests === undefined && config.durationMs !== undefined && config.durationMs > 0;
  const total = durationMode
    ? LOAD_TEST_MAX_TOTAL_REQUESTS
    : Math.max(1, Math.min(config.totalRequests ?? concurrency * 10, LOAD_TEST_MAX_TOTAL_REQUESTS));
  const thresholds: LoadTestThresholds = { ...DEFAULT_LOAD_TEST_THRESHOLDS, ...config.thresholds };

  const latencies: number[] = [];
  let failures = 0;
  let dispatched = 0;
  const started = Date.now();
  const deadline = durationMode ? started + config.durationMs! : Infinity;

  // SSRF-validate the target once up front rather than once per request — a
  // 2000-request load test should not do 2000 DNS resolutions.
  const precheck = await runApiTest({ ...def, assertions: [] }, ctx);
  if (precheck.error) {
    return summarizeLoad([precheck.latencyMs], 1, Date.now() - started, thresholds);
  }
  latencies.push(precheck.latencyMs);
  dispatched++;
  const loopCtx = { ...ctx, skipSsrfCheck: true };

  // Bounded worker pool: each worker pulls the next slot until the budget or
  // the deadline is exhausted.
  async function worker() {
    while (dispatched < total && Date.now() < deadline) {
      dispatched++;
      const res = await runApiTest(def, loopCtx);
      latencies.push(res.latencyMs);
      if (!res.passed) failures++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

  return summarizeLoad(latencies, failures, Date.now() - started, thresholds);
}
