/**
 * Healer Agent — auto-fixes failing tests by using the AI provider
 * with Playwright MCP tools to inspect the live UI and patch broken
 * selectors/assertions.
 *
 * Uses the official Playwright Test Healer agent prompt with the
 * `playwright-test` MCP server (npx playwright run-test-mcp-server).
 */

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { getCurrentBranchForRepo } from '@/lib/git-utils';
import { generateWithAI } from '@/lib/ai';
import { extractCodeFromResponse } from '@/lib/ai/prompts';
import type { AIProviderConfig } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Healer system prompt (derived from Playwright's healer agent definition)
// ---------------------------------------------------------------------------

const HEALER_SYSTEM_PROMPT = `You are the Playwright Test Healer, an expert test automation engineer specializing in debugging and resolving test failures.

Your workflow:
1. **Understand the Failure**: Read the failing test code and error message carefully
2. **Inspect the Live UI**: Use browser_navigate to go to the page, then browser_snapshot to see the current state
3. **Diagnose the Issue**: Compare what the test expects vs what the page actually shows
   - Element selectors that may have changed
   - Timing and synchronization issues
   - Data dependencies or test environment problems
   - Application changes that broke test assumptions
4. **Fix the Code**: Update the test code to match the current UI state
   - Update selectors to match current elements
   - Fix assertions and expected values
   - Improve test reliability
   - For dynamic data, use flexible matchers
5. **Verify**: Use MCP tools to confirm your fix would work on the live page

OUTPUT FORMAT:
Output the complete fixed test function — NO imports, NO TypeScript, plain JavaScript only:

\`\`\`javascript
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // ... fixed test code
}
\`\`\`

CRITICAL RULES:
- ALWAYS inspect the live page via browser_snapshot before fixing
- NEVER guess selectors — verify them against the current accessibility tree
- Use role-based locators: page.getByRole(), page.getByText(), page.getByLabel()
- Plain JavaScript ONLY — NO TypeScript, NO imports
- Use baseUrl for navigation (no hardcoded URLs)
- Keep stepLogger.log() calls for step descriptions
- Output ONLY the fixed code block, no explanations
- Do not add test.fixme() — always attempt a real fix`;

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
// Server-action-compatible wrappers
// ---------------------------------------------------------------------------

/**
 * Heal a single failing test using the PW Healer agent.
 * Uses the AI provider + Playwright MCP tools to inspect and fix.
 */
export async function agentHealTest(
  repositoryId: string,
  testId: string,
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);

  try {
    const test = await queries.getTest(testId);
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    // Get latest error
    const results = await queries.getTestResultsByTest(testId);
    const latestResult = results[results.length - 1];
    const errorMessage = latestResult?.errorMessage || 'Test failed with unknown error';

    // Get base URL
    const envConfig = await queries.getEnvironmentConfig(repositoryId);
    const baseUrl = test.targetUrl || envConfig?.baseUrl || 'http://localhost:3000';

    const settings = await queries.getAISettings(repositoryId);
    const config = getAIConfig(settings);

    const prompt = `Fix this failing Playwright test.

**Test code:**
\`\`\`javascript
${test.code}
\`\`\`

**Error message:**
\`\`\`
${errorMessage}
\`\`\`

**Base URL:** ${baseUrl}

Navigate to the relevant page using MCP tools, inspect the current UI state via browser_snapshot, diagnose why the test fails, and output the fixed test code.`;

    const response = await generateWithAI(config, prompt, HEALER_SYSTEM_PROMPT, {
      useMCP: true,
      repositoryId,
      actionType: 'test_fix',
    });

    const code = extractCodeFromResponse(response);
    if (!code) {
      return { success: false, error: 'Healer agent produced no fixed code' };
    }

    return { success: true, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Healer agent failed';
    return { success: false, error: message };
  }
}

/**
 * Heal multiple failing tests in bulk.
 */
export async function agentHealTests(
  testIds: string[],
  repositoryId: string,
): Promise<{ success: boolean; fixed: number; failed: number; errors: string[] }> {
  await requireRepoAccess(repositoryId);
  const branch = await getCurrentBranchForRepo(repositoryId);
  const errors: string[] = [];
  let fixed = 0;
  let failed = 0;

  // Process with concurrency limit of 3
  const CONCURRENCY = 3;
  for (let i = 0; i < testIds.length; i += CONCURRENCY) {
    const batch = testIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (testId) => {
        const result = await agentHealTest(repositoryId, testId);
        if (result.success && result.code) {
          await queries.updateTestWithVersion(testId, { code: result.code }, 'ai_fix', branch ?? undefined);
          return { testId, success: true };
        }
        return { testId, success: false, error: result.error };
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.success) {
        fixed++;
      } else {
        failed++;
        const error = r.status === 'fulfilled' ? r.value.error : r.reason?.message;
        errors.push(error || 'Unknown error');
      }
    }
  }

  revalidatePath('/tests');
  return { success: true, fixed, failed, errors };
}
