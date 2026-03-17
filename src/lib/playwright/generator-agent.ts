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
import type { AIProviderConfig } from '@/lib/ai/types';
import type { TestGenerationContext } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Generator system prompt (derived from Playwright's generator agent definition)
// ---------------------------------------------------------------------------

const GENERATOR_SYSTEM_PROMPT = `You are a Playwright Test Generator, an expert in browser automation and end-to-end testing.
Your specialty is creating robust, reliable tests that accurately simulate user interactions and validate application behavior.

WORKFLOW:
1. Read the test plan/spec provided
2. Use browser_navigate to go to the target URL
3. Use browser_snapshot to discover the accessibility tree and element refs
4. For each test step, use browser_click, browser_type, browser_hover etc. to manually execute the step in real-time
5. Verify the result with browser_snapshot after each interaction
6. Identify the reliable selectors from the snapshots (role-based locators preferred)
7. Generate the final test code using discovered selectors

OUTPUT FORMAT:
Generate a single JavaScript function with this exact signature — NO imports, NO TypeScript:

\`\`\`javascript
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Step description');
  await page.goto(\`\${baseUrl}/path\`, { waitUntil: 'domcontentloaded' });
  // ... test steps using discovered selectors
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
\`\`\`

CRITICAL RULES:
- NEVER guess selectors — always verify via browser_snapshot first
- Element refs (e.g. "ref=s2e5") are for MCP exploration only, NOT for final test code
- Use role-based locators: page.getByRole(), page.getByText(), page.getByLabel()
- Plain JavaScript ONLY — NO TypeScript annotations, NO imports
- Use baseUrl for navigation (no hardcoded URLs)
- Capture at least one screenshot using screenshotPath
- Use stepLogger.log() for step descriptions
- ALWAYS use regex for URL checks: await expect(page).toHaveURL(/\\/path/)
- Every variable must use const or let
- Output ONLY the code block, no explanations`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAIConfig(settings: Awaited<ReturnType<typeof queries.getAISettings>>): AIProviderConfig {
  return {
    provider: settings.provider as AIProviderConfig['provider'],
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || 'anthropic/claude-sonnet-4',
    customInstructions: settings.customInstructions,
    agentSdkPermissionMode: settings.agentSdkPermissionMode as 'plan' | 'default' | 'acceptEdits' | undefined,
    agentSdkModel: settings.agentSdkModel || undefined,
    agentSdkWorkingDir: settings.agentSdkWorkingDir || undefined,
    anthropicApiKey: settings.anthropicApiKey,
    anthropicModel: settings.anthropicModel || undefined,
    openaiApiKey: settings.openaiApiKey,
    openaiModel: settings.openaiModel || undefined,
  };
}

// ---------------------------------------------------------------------------
// Server-action-compatible wrapper
// ---------------------------------------------------------------------------

/**
 * Generate a test using the PW Generator agent.
 * Uses the AI provider + Playwright MCP tools to verify selectors live.
 */
export async function agentCreateTest(
  repositoryId: string,
  context: TestGenerationContext,
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);

  try {
    const settings = await queries.getAISettings(repositoryId);
    const config = getAIConfig(settings);

    // Build spec/prompt from context
    let prompt = '';

    // Check if there's an agent plan from the functional area
    if (context.functionalAreaId) {
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

    // Get base URL
    const envConfig = await queries.getEnvironmentConfig(repositoryId);
    const baseUrl = context.targetUrl || context.baseUrl || envConfig?.baseUrl || 'http://localhost:3000';

    prompt += `\n\nTarget base URL: ${baseUrl}`;
    prompt += `\nNavigate to the page, explore it using MCP tools, then generate the test code.`;

    const response = await generateWithAI(config, prompt, GENERATOR_SYSTEM_PROMPT, {
      useMCP: true,
      repositoryId,
      actionType: 'test_create',
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
