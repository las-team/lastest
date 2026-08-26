/**
 * Map an API-test result to the shared EvidenceItem shape (E1). API evidence
 * lands on the `api` check layer, which defaults to `enforce` — a failed
 * assertion gates the step red via effectiveVerdict.
 */

import type { ApiTestResult } from "./types";

/**
 * One evidence row, narrowed to the `api` layer.
 *
 * Core's `EvidenceItem` (`packages/db/src/schema/visual.ts`) admits eleven
 * layers; this producer only ever emits `"api"`, so pinning the field is both
 * honest and slightly stronger than the type it replaced. Declared here rather
 * than promoted because `EvidenceItem` is Verify's vocabulary, not this
 * feature's — recipe §6.1 row two.
 *
 * The assertion that it still matches core's shape is in
 * `src/server/actions/builds.ts`, where the returned array is pushed into an
 * `EvidenceItem[]`. A field core adds as required, or a `signal` value it
 * drops, stops compiling there.
 */
export interface ApiEvidenceItem {
  layer: "api";
  signal: "high" | "medium" | "low";
  summary: string;
  details?: Record<string, unknown>;
}

export function apiResultToEvidence(result: ApiTestResult): ApiEvidenceItem[] {
  // Transport/SSRF/timeout failure → single high-signal item.
  if (result.error) {
    return [
      {
        layer: "api",
        signal: "high",
        summary: `API request failed: ${result.error}`,
        details: {
          error: result.error,
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
        },
      },
    ];
  }

  const failed = result.assertionResults.filter((a) => !a.passed);
  if (failed.length === 0) {
    return [
      {
        layer: "api",
        signal: "low",
        summary: `${result.assertionResults.length} API assertion(s) passed (${result.statusCode}, ${result.latencyMs}ms)`,
        details: { statusCode: result.statusCode, latencyMs: result.latencyMs },
      },
    ];
  }

  return [
    {
      layer: "api",
      signal: "high",
      summary: `${failed.length} of ${result.assertionResults.length} API assertion(s) failed`,
      details: {
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
        failed: failed.map((a) => ({
          kind: a.kind,
          description: a.description,
          expected: a.expected,
          actual: a.actual,
        })),
      },
    },
  ];
}
