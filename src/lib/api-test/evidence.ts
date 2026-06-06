/**
 * Map an API-test result to the shared EvidenceItem shape (E1). API evidence
 * lands on the `api` check layer, which defaults to `enforce` — a failed
 * assertion gates the step red via effectiveVerdict.
 */

import type { EvidenceItem } from '@/lib/db/schema';
import type { ApiTestResult } from './types';

export function apiResultToEvidence(result: ApiTestResult): EvidenceItem[] {
  // Transport/SSRF/timeout failure → single high-signal item.
  if (result.error) {
    return [{
      layer: 'api',
      signal: 'high',
      summary: `API request failed: ${result.error}`,
      details: { error: result.error, statusCode: result.statusCode, latencyMs: result.latencyMs },
    }];
  }

  const failed = result.assertionResults.filter((a) => !a.passed);
  if (failed.length === 0) {
    return [{
      layer: 'api',
      signal: 'low',
      summary: `${result.assertionResults.length} API assertion(s) passed (${result.statusCode}, ${result.latencyMs}ms)`,
      details: { statusCode: result.statusCode, latencyMs: result.latencyMs },
    }];
  }

  return [{
    layer: 'api',
    signal: 'high',
    summary: `${failed.length} of ${result.assertionResults.length} API assertion(s) failed`,
    details: {
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      failed: failed.map((a) => ({ kind: a.kind, description: a.description, expected: a.expected, actual: a.actual })),
    },
  }];
}
