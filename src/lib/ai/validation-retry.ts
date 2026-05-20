/**
 * Shared validation pipeline for AI-generated test code, used by both the
 * one-shot save paths (`saveGeneratedTest`, `aiFixTest`) and the agentic
 * paths that can retry with feedback (`agentCreateTest`, `agentHealTestCore`,
 * `agentEnhanceTest`).
 *
 * Two layers:
 *   1. validateTestAgainstRunnerAPI   — static TS check vs runner-api.d.ts
 *   2. validateLocatorChainsOnPage    — headless chromium reachability check
 *                                        (only when baseUrl is available)
 *
 * For agentic paths, callers supply a `regenerate(feedback)` callback that
 * re-invokes the LLM with the validation feedback appended. We loop up to
 * MAX_VALIDATION_RETRIES times before giving up.
 */

import { validateTestAgainstRunnerAPI, formatTSDiagnostics } from './validate-test-against-api';
import { extractLocatorChains, validateLocatorChainsOnPage, formatValidationFeedback } from './mcp-validator';

export const MAX_VALIDATION_RETRIES = 2;

export interface RunValidationOptions {
  /** Skip the page-snapshot pass even when baseUrl is set. Use for tests that don't navigate. */
  skipPageCheck?: boolean;
  /** Override the default retry count. */
  maxRetries?: number;
}

export type ValidationOutcome =
  | { valid: true; code: string }
  | { valid: false; code: string; feedback: string };

/**
 * Run both validation layers against `code`. Does NOT loop — callers wanting
 * retry behaviour should use `runValidationWithRetry`.
 */
export async function runValidation(
  code: string,
  baseUrl: string | null | undefined,
  options: RunValidationOptions = {},
): Promise<ValidationOutcome> {
  // 1. Static TypeScript check.
  const tsResult = validateTestAgainstRunnerAPI(code);
  if (!tsResult.valid) {
    return { valid: false, code, feedback: formatTSDiagnostics(tsResult.errors) };
  }

  // 2. Page-snapshot check (only when we have a baseUrl + the caller wants it).
  if (baseUrl && !options.skipPageCheck) {
    const chains = extractLocatorChains(code);
    if (chains.length > 0) {
      const pageResult = await validateLocatorChainsOnPage(baseUrl, chains);
      if (!pageResult.valid) {
        return { valid: false, code, feedback: formatValidationFeedback(pageResult) };
      }
    }
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
  baseUrl: string | null | undefined,
  regenerate: (feedback: string, attempt: number) => Promise<string>,
  options: RunValidationOptions = {},
): Promise<ValidationOutcome> {
  const maxRetries = options.maxRetries ?? MAX_VALIDATION_RETRIES;
  let code = initialCode;
  let lastFeedback = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await runValidation(code, baseUrl, options);
    if (result.valid) return result;
    lastFeedback = result.feedback;
    if (attempt === maxRetries) break;
    code = await regenerate(lastFeedback, attempt + 1);
  }

  return { valid: false, code, feedback: lastFeedback };
}
