/**
 * Runtime result types for the headless API-test engine (E1).
 * The request/assertion *definition* lives in the DB schema
 * (`ApiTestDefinition`, `ApiAssertion`) so it can be stored on `tests`.
 */

// The persisted shape lives in the DB schema so it can be stored on
// test_results.apiResult; re-export under the engine's names to keep one
// source of truth.
export type {
  ApiTestResultData as ApiTestResult,
  ApiAssertionResultData as ApiAssertionResult,
} from "@/lib/db/schema";

/** Normalized response handed to the pure assertion evaluator. */
export interface ApiResponseSnapshot {
  statusCode: number;
  headers: Record<string, string>;
  json: unknown;
  rawText: string;
  latencyMs: number;
}
