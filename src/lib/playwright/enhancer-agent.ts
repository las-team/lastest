/**
 * Enhancer Agent — improves existing tests by using the AI provider
 * with Playwright MCP tools to inspect the live UI and enhance test
 * coverage, selectors, and assertions.
 *
 * Uses MCP browser tools to verify selectors live, avoiding blind
 * hallucination of selectors that may not exist.
 */

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { generateWithAI } from '@/lib/ai';
import { extractCodeFromResponse } from '@/lib/ai/prompts';
import { getAIConfig, buildSeedFixture } from './agent-context';

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
- Output ONLY the enhanced code block, no explanations`;

// ---------------------------------------------------------------------------
// Server-action-compatible wrappers
// ---------------------------------------------------------------------------

/**
 * Enhance an existing test using the PW Enhancer agent.
 * Uses the AI provider + Playwright MCP tools to inspect and improve.
 */
export async function agentEnhanceTest(
  repositoryId: string,
  testId: string,
  userPrompt?: string,
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);
  try {
    const test = await queries.getTest(testId);
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    const settings = await queries.getAISettings(repositoryId);
    const config = getAIConfig(settings);
    const seed = await buildSeedFixture(repositoryId);

    const enhanceInstructions = userPrompt
      ? `\n\n**Enhancement request:**\n${userPrompt}`
      : '\n\n**Enhancement request:**\nImprove this test by adding better assertions, additional edge cases, and more robust selectors verified against the live page.';

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

    const response = await generateWithAI(config, prompt, ENHANCER_SYSTEM_PROMPT, {
      useMCP: true,
      repositoryId,
      actionType: 'enhance_test',
    });

    const code = extractCodeFromResponse(response);
    if (!code) {
      return { success: false, error: 'Enhancer agent produced no enhanced code' };
    }

    return { success: true, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Enhancer agent failed';
    return { success: false, error: message };
  }
}
