/**
 * Extract Playwright test code from an LLM response.
 *
 * Promoted from `src/lib/ai/prompts.ts` (RFC §9 phase 4, `authoring-ai`
 * migration): pure text extraction, no `@/…` import, and already shared
 * by core (`ai.ts`) and several unmigrated pseudo-plugins
 * (`play-agent.ts`, `spec-import.ts`, `specs.ts`) before this plugin
 * needed it too. `src/lib/ai/prompts.ts` re-exports this for its existing
 * callers rather than each one importing `@lastest/ai-kit` directly.
 */
export function extractCodeFromResponse(response: string): string {
  // Try to extract code from markdown code blocks (any language tag or none)
  const codeBlockMatch = response.match(/```(?:\w*)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    // Strip import statements that AI sometimes adds despite instructions
    return codeBlockMatch[1].replace(/^\s*import\s+.*$/gm, "").trim();
  }

  // If no code block, check if response starts with import or export
  if (
    response.trim().startsWith("import") ||
    response.trim().startsWith("export")
  ) {
    return response.trim();
  }

  // Look for export async function anywhere in the response (AI may have added explanation before code)
  const funcMatch = response.match(
    /(export\s+async\s+function\s+test\s*\([\s\S]*)/,
  );
  if (funcMatch) {
    return funcMatch[1].trim();
  }

  // Look for import statement followed by code anywhere in the response
  const importMatch = response.match(
    /(import\s+[\s\S]*export\s+async\s+function[\s\S]*)/,
  );
  if (importMatch) {
    return importMatch[1].trim();
  }

  // If no code patterns found, the response is likely explanatory text, not code.
  // Check for actual code patterns (not just mentions of words in prose)
  const trimmed = response.trim();
  const hasCodePattern =
    /(?:^|\n)\s*(?:export\s+|async\s+function|const\s+\w+\s*=|let\s+\w+\s*=|await\s+page\.|page\.goto|page\.locator|stepLogger\.log)/.test(
      trimmed,
    );
  if (!hasCodePattern) {
    return "";
  }

  // Return as-is if we can't extract but it looks code-like
  return trimmed;
}

/**
 * Shared selector-robustness rules, injected into every generation/fix/heal
 * prompt. Single source of truth so the two failure classes we keep hitting
 * (regex hasText over multi-block text; brittle structural-ancestor scoping)
 * are discouraged consistently.
 */
export const SELECTOR_ROBUSTNESS_RULES = `SELECTOR ROBUSTNESS:
- Anchor on the LEAF interactive element: prefer page.getByRole('link', { name }).first() over scoping through a structural ancestor like page.locator('section').filter({ hasText: ... }). Only add ancestor scoping when the same accessible name appears multiple times AND you verified that ancestor exists in the snapshot.
- NEVER use a RegExp inside filter({ hasText }). Playwright matches a regex against RAW, non-normalized text, so whitespace/newlines between block elements break patterns like /A.*B/. Use a plain string (it is whitespace-normalized) or page.getByText().`;
