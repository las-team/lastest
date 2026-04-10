/**
 * Generator Agent — generates Playwright test code from specs/plans
 * by using the AI provider with Playwright MCP tools to verify selectors live.
 *
 * Uses the official Playwright Test Generator agent prompt with the
 * `playwright-test` MCP server (npx playwright run-test-mcp-server).
 */

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { generateWithAI } from '@/lib/ai';
import { extractCodeFromResponse } from '@/lib/ai/prompts';
import type { TestGenerationContext } from '@/lib/ai/types';
import { getAIConfig, buildSeedFixture } from './agent-context';

// ---------------------------------------------------------------------------
// Generator system prompt (derived from Playwright's generator agent definition)
// ---------------------------------------------------------------------------

const GENERATOR_SYSTEM_PROMPT = `You are a Playwright Test Generator, an expert in browser automation and end-to-end testing.
Your specialty is creating robust, multi-step tests that validate user scenarios with screenshot checkpoints.

WORKFLOW:
1. **Run the Seed Test First** — if a seed fixture is provided, execute it step-by-step using MCP browser tools to set up auth/login BEFORE generating the test
2. Use browser_navigate to go to the target URL
3. Use browser_snapshot to discover the accessibility tree and element refs
4. For each test step, use browser_click, browser_type, browser_hover etc. to manually execute the step in real-time
5. Verify the result with browser_snapshot after each interaction
6. Identify the reliable selectors from the snapshots (role-based locators preferred)
7. Generate the final test code using discovered selectors

MULTI-SCENARIO TESTS:
When given multiple scenarios, create ONE test function that covers all of them in sequence.
After verifying each scenario, take a screenshot as a checkpoint using a unique filename:
  await page.screenshot({ path: screenshotPath.replace('.png', '-scenario-1.png'), fullPage: true });
The final screenshot should use the original screenshotPath.
Group related interactions (same page/route) together for efficiency — don't navigate away and back unnecessarily.

OUTPUT FORMAT:
Generate a single JavaScript function with this exact signature — NO imports, NO TypeScript:

\`\`\`javascript
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Scenario 1: Description');
  await page.goto(\`\${baseUrl}/path\`, { waitUntil: 'domcontentloaded' });
  // ... verify scenario 1
  await page.screenshot({ path: screenshotPath.replace('.png', '-scenario-1.png'), fullPage: true });

  stepLogger.log('Scenario 2: Description');
  // ... verify scenario 2
  await page.screenshot({ path: screenshotPath.replace('.png', '-scenario-2.png'), fullPage: true });

  // Final screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
\`\`\`

CRITICAL RULES:
- NEVER guess selectors — always verify via browser_snapshot first
- Element refs (e.g. "ref=s2e5") are for MCP exploration only, NOT for final test code
- Use role-based locators: page.getByRole(), page.getByText(), page.getByLabel()
- Plain JavaScript ONLY — NO TypeScript annotations, NO imports, NO \`await import()\`
- Do NOT re-declare expect — it is provided as a parameter by the runner
- Use baseUrl for navigation (no hardcoded URLs)
- Take a screenshot after EACH scenario as a checkpoint
- Use stepLogger.log() for step descriptions — prefix with "Scenario N:" for multi-scenario tests
- ALWAYS use regex for URL checks: await expect(page).toHaveURL(/\\/path/)
- Every variable must use const or let
- Output ONLY the code block, no explanations`;

// ---------------------------------------------------------------------------
// Scenario parser — extracts individual test scenarios from an area's plan
// ---------------------------------------------------------------------------

// Re-export pure parsing/grouping functions from shared module (usable in client components)
import { parseScenariosFromPlan, groupScenariosForGeneration } from './scenario-grouping';
import type { ParsedScenario, ScenarioGroup } from './scenario-grouping';
export { parseScenariosFromPlan, groupScenariosForGeneration };
export type { ParsedScenario, ScenarioGroup };

// ---------------------------------------------------------------------------
// Server-action-compatible wrapper
// ---------------------------------------------------------------------------

/**
 * Generate a test using the PW Generator agent.
 * Uses the AI provider + Playwright MCP tools to verify selectors live.
 *
 * When `scenarioGroup` is provided, generates a multi-step test covering all scenarios in the group.
 * Otherwise generates a test from the full area plan (legacy behavior).
 */
export async function agentCreateTest(
  repositoryId: string,
  context: TestGenerationContext & { scenarioGroup?: ScenarioGroup },
  options?: { signal?: AbortSignal; headless?: boolean; cdpEndpoint?: string },
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);

  try {
    const settings = await queries.getAISettings(repositoryId);
    const config = getAIConfig(settings);
    const seed = await buildSeedFixture(repositoryId);

    let prompt = '';

    if (context.scenarioGroup) {
      const g = context.scenarioGroup;
      prompt = `Generate a Playwright test that covers ${g.scenarioCount} scenarios in one multi-step test.\n`;
      prompt += `After verifying each scenario, take a screenshot checkpoint.\n\n`;
      prompt += g.combinedSteps + '\n\n';
      prompt += `Create ONE test function that walks through all ${g.scenarioCount} scenarios in sequence.\n`;
      prompt += `Group interactions on the same page together for efficiency.\n`;
    } else if (context.functionalAreaId) {
      const area = await queries.getFunctionalArea(context.functionalAreaId);
      if (area?.agentPlan) {
        prompt = `Generate a Playwright test based on this test plan:\n\n${area.agentPlan}\n\n`;
      }
    }

    // Fall back to constructing prompt from context fields
    if (!prompt) {
      const parts: string[] = [];
      if (context.testName) parts.push(`Test: ${context.testName}`);
      if (context.routePath) parts.push(`Route: ${context.routePath}`);
      if (context.userPrompt) parts.push(context.userPrompt);
      if (context.scanContext?.specDescription) {
        parts.push(`Spec Description: ${context.scanContext.specDescription}`);
      }
      if (context.scanContext?.testSuggestions?.length) {
        parts.push(`Test Suggestions:\n${context.scanContext.testSuggestions.map(s => `- ${s}`).join('\n')}`);
      }
      prompt = parts.join('\n') || 'Generate a comprehensive test for this page.';
    }

    prompt += `\n\nTarget base URL: ${seed.baseUrl}`;
    prompt += `\nNavigate to the page, explore it using MCP tools, then generate the test code.`;
    if (seed.hasLoginSetup) {
      prompt += `\n\n**IMPORTANT: Do NOT include login/auth/setup steps in your generated test code. The seed fixture handles authentication during your MCP exploration, but at runtime a separate setup script logs in BEFORE the test runs. Your test should assume the user is already logged in — start directly on the page being tested.**`;
    }
    prompt += `\n\n---\n\n${seed.seedPrompt}`;

    const response = await generateWithAI(config, prompt, GENERATOR_SYSTEM_PROMPT, {
      useMCP: true,
      mcpHeadless: options?.headless,
      cdpEndpoint: options?.cdpEndpoint,
      repositoryId,
      actionType: 'agent_generate',
      signal: options?.signal,
    });

    const code = extractCodeFromResponse(response);
    if (!code) {
      return { success: false, error: 'Generator agent produced no test code' };
    }

    return { success: true, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generator agent failed';
    return { success: false, error: message };
  }
}
