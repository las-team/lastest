/**
 * Shared validation pipeline for AI-generated test code, used by both the
 * one-shot save paths (`saveGeneratedTest`, `aiFixTest`) and the agentic
 * paths that can retry with feedback (`agentCreateTest`, `agentHealTestCore`,
 * `agentEnhanceTest`).
 *
 * Static TS check vs runner-api.d.ts only — real selector feedback comes
 * from the Embedded Browser run, not an in-process page-snapshot pass.
 *
 * For agentic paths, callers supply a `regenerate(feedback)` callback that
 * re-invokes the LLM with the validation feedback appended. We loop up to
 * MAX_VALIDATION_RETRIES times before giving up.
 */

import {
  validateTestAgainstRunnerAPI,
  formatTSDiagnostics,
} from "./validate-test-against-api";

export const MAX_VALIDATION_RETRIES = 2;

export interface RunValidationOptions {
  /** Override the default retry count. */
  maxRetries?: number;
}

export type ValidationOutcome =
  | { valid: true; code: string }
  | { valid: false; code: string; feedback: string };

/**
 * Run the static validation layer against `code`. Does NOT loop — callers
 * wanting retry behaviour should use `runValidationWithRetry`.
 */
export async function runValidation(code: string): Promise<ValidationOutcome> {
  const tsResult = validateTestAgainstRunnerAPI(code);
  if (!tsResult.valid) {
    return {
      valid: false,
      code,
      feedback: formatTSDiagnostics(tsResult.errors),
    };
  }

  return { valid: true, code };
}

/**
 * Run validation, and on failure call `regenerate(feedback)` so the agent can
 * try again with the validation result in its prompt. Loops up to
 * `options.maxRetries` times (default MAX_VALIDATION_RETRIES = 2).
 */
export async function runValidationWithRetry(
  initialCode: string,
  regenerate: (feedback: string, attempt: number) => Promise<string>,
  options: RunValidationOptions = {},
): Promise<ValidationOutcome> {
  const maxRetries = options.maxRetries ?? MAX_VALIDATION_RETRIES;
  let code = initialCode;
  let lastFeedback = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await runValidation(code);
    if (result.valid) return result;
    lastFeedback = result.feedback;
    if (attempt === maxRetries) break;
    code = await regenerate(lastFeedback, attempt + 1);
  }

  return { valid: false, code, feedback: lastFeedback };
}
