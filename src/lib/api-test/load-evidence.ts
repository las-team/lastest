/**
 * Map a load-test result to EvidenceItem[] on the existing `perf` layer (E3) —
 * a threshold breach gates the step the same way a Web-Vitals breach does.
 */

import type { EvidenceItem, LoadTestResultData } from '@/lib/db/schema';

export function loadResultToEvidence(result: LoadTestResultData): EvidenceItem[] {
  const summary = `load: ${result.count} req, p95 ${result.p95}ms, ${(result.errorRate * 100).toFixed(1)}% errors, ${result.throughputRps} rps`;
  return [{
    layer: 'perf',
    signal: result.passed ? 'low' : 'high',
    summary: result.passed ? summary : `${summary} — ${result.breaches.join('; ')}`,
    details: {
      count: result.count,
      p50: result.p50,
      p95: result.p95,
      p99: result.p99,
      mean: result.mean,
      min: result.min,
      max: result.max,
      throughputRps: result.throughputRps,
      errorRate: result.errorRate,
      breaches: result.breaches,
    },
  }];
}
