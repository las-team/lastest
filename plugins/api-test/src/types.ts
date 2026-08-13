/**
 * Runtime result types for the headless API-test engine (E1).
 *
 * The request/assertion *definition* and the persisted result shapes live in
 * `@lastest/eb-protocol` so the core `tests` / `test_results` columns that
 * store them can name them without this package importing `@lastest/db`
 * (recipe §6.1). Re-exported here under the engine's names to keep one source
 * of truth.
 */

export type {
  ApiTestResultData as ApiTestResult,
  ApiAssertionResultData as ApiAssertionResult,
} from "@lastest/eb-protocol";

/** Normalized response handed to the pure assertion evaluator. */
export interface ApiResponseSnapshot {
  statusCode: number;
  headers: Record<string, string>;
  json: unknown;
  rawText: string;
  latencyMs: number;
}
