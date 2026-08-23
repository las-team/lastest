/**
 * Enhancer Agent — improves existing tests by giving the AI provider live
 * MCP browser tools bound to a core-issued `BrowserSession`, so it can
 * inspect the live UI and enhance test coverage, selectors, and
 * assertions instead of hallucinating them.
 */

import type { AiCapability, BrowserSession } from "@lastest/contracts";
import {
  extractCodeFromResponse,
  SELECTOR_ROBUSTNESS_RULES,
} from "@lastest/ai-kit";

import type { AuthoringAiHost } from "./host";
import { runValidationWithRetry } from "./validation";

// ---------------------------------------------------------------------------
// Enhancer system prompt
// ---------------------------------------------------------------------------

const ENHANCER_SYSTEM_PROMPT = `You are the Playwright Test Enhancer, an expert test automation engineer specializing in improving existing test coverage and robustness.

Your workflow:
1. **Run the Seed Test First** — if a seed fixture is provided, execute it step-by-step using MCP browser tools to set up auth/login BEFORE enhancing
2. **Understand the Existing Test**: Read the current test code carefully
3. **Inspect the Live UI**: Use browser_navigate to go to the page, then browser_snapshot to see the current state
4. **Analyze Enhancement Opportunities**: Based on the user's request and the live UI, identify:
   - Additional user flows to cover
   - More assertions to validate
   - Better selectors (role-based preferred)
   - Edge cases or error states
   - Missing screenshot checkpoints
5. **Enhance the Code**: Improve the test while preserving its existing functionality
   - Add new scenarios or steps as requested
   - Strengthen existing selectors with verified alternatives
   - Add meaningful assertions
   - Improve error resilience
6. **Verify**: Use MCP tools to confirm your enhancements would work on the live page

OUTPUT FORMAT:
Output the complete enhanced test function — NO imports, NO TypeScript, plain JavaScript only:

\`\`\`javascript
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // ... enhanced test code
}
\`\`\`

CRITICAL RULES:
- ALWAYS inspect the live page via browser_snapshot before modifying selectors
- NEVER guess selectors — verify them against the current accessibility tree
- Use role-based locators: page.getByRole(), page.getByText(), page.getByLabel()
- Plain JavaScript ONLY — NO TypeScript, NO imports, NO \`await import()\`
- Do NOT re-declare expect — it is provided as a parameter by the runner
- Use baseUrl for navigation (no hardcoded URLs)
- Keep stepLogger.log() calls for step descriptions
- Preserve existing test functionality while adding enhancements
- Output ONLY the enhanced code block, no explanations

${SELECTOR_ROBUSTNESS_RULES}`;

/**
 * Enhance an existing test using the PW Enhancer agent, on an
 * already-claimed browser session.
 */
export async function agentEnhanceTest(
  host: AuthoringAiHost,
  ai: AiCapability,
  session: BrowserSession,
  repositoryId: string,
  testId: string,
  userPrompt?: string,
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const test = await host.getTestForHealing(testId);
    if (!test) {
      return { success: false, error: "Test not found" };
    }

    const seed = await host.buildSeedFixture(repositoryId);

    const enhanceInstructions = userPrompt
      ? `\n\n**Enhancement request:**\n${userPrompt}`
      : "\n\n**Enhancement request:**\nImprove this test by adding better assertions, additional edge cases, and more robust selectors verified against the live page.";

    const prompt = `Enhance this Playwright test by inspecting the live page and improving it.

**Current test code:**
\`\`\`javascript
${test.code}
\`\`\`
${enhanceInstructions}

**Base URL:** ${seed.baseUrl}

Navigate to the relevant page using MCP tools, inspect the current UI state via browser_snapshot, and output the enhanced test code with verified selectors and improved coverage.

---

${seed.seedPrompt}`;

    const callLLM = async (userPrompt: string): Promise<string> => {
      const result = await ai.generate(userPrompt, {
        actionType: "enhance_test",
        repositoryId,
        systemPrompt: ENHANCER_SYSTEM_PROMPT,
        browserTools: session,
      });
      return extractCodeFromResponse(result.text) ?? "";
    };

    const initial = await callLLM(prompt);
    if (!initial) {
      return {
        success: false,
        error: "Enhancer agent produced no enhanced code",
      };
    }

    const validated = await runValidationWithRetry(
      host,
      initial,
      async (feedback, attempt) => {
        console.log(
          `[EnhancerAgent] Validation failed, retry ${attempt}/2 with feedback`,
        );
        const retryPrompt = `${prompt}\n\n---\n\nPrevious enhancement attempt failed validation. ${feedback}\n\nRegenerate the enhanced test code addressing the validation errors. Output ONLY the corrected code block.`;
        return callLLM(retryPrompt);
      },
    );

    if (!validated.valid) {
      return {
        success: false,
        error: `Validation failed after retries: ${validated.feedback}`,
      };
    }

    return { success: true, code: validated.code };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Enhancer agent failed";
    return { success: false, error: message };
  }
}
