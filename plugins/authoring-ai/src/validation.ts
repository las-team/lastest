import type { AuthoringAiHost, AuthoringAiValidation } from "./host";

/**
 * Retry an LLM call against `host.validateGeneratedTest`'s static check.
 *
 * Ported from `src/lib/ai/validation-retry.ts`'s `runValidationWithRetry`.
 * Only the check itself (a TypeScript diagnostics pass against
 * `runner-api.d.ts`) is core — it stays behind `validateGeneratedTest`
 * because it reads a `process.cwd()`-relative asset (recipe §5's
 * row-three shape). The retry *policy* — how many attempts, what to do on
 * exhaustion — guards nothing and is the plugin's own.
 */
export const MAX_VALIDATION_RETRIES = 2;

export type ValidationOutcome =
  | { valid: true; code: string }
  | { valid: false; code: string; feedback: string };

export async function runValidationWithRetry(
  host: AuthoringAiHost,
  initialCode: string,
  regenerate: (feedback: string, attempt: number) => Promise<string>,
  maxRetries = MAX_VALIDATION_RETRIES,
): Promise<ValidationOutcome> {
  let code = initialCode;
  let lastFeedback = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result: AuthoringAiValidation =
      await host.validateGeneratedTest(code);
    if (result.valid) return { valid: true, code };
    lastFeedback = result.feedback;
    if (attempt === maxRetries) break;
    code = await regenerate(lastFeedback, attempt + 1);
  }

  return { valid: false, code, feedback: lastFeedback };
}
