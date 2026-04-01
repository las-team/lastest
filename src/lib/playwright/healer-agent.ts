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
import { getAIConfig, buildSeedFixture } from './agent-context';

// ---------------------------------------------------------------------------
// Healer system prompt (derived from Playwright's healer agent definition)
// ---------------------------------------------------------------------------

const HEALER_SYSTEM_PROMPT = `You are the Playwright Test Healer, an expert test automation engineer specializing in debugging and resolving test failures.

Your workflow:
1. **Run the Seed Test First** — if a seed fixture is provided, execute it step-by-step using MCP browser tools to set up auth/login BEFORE debugging
2. **Understand the Failure**: Read the failing test code and error message carefully
3. **Inspect the Live UI**: Use browser_navigate to go to the page, then browser_snapshot to see the current state
4. **Diagnose the Issue**: Compare what the test expects vs what the page actually shows
   - Element selectors that may have changed
   - Timing and synchronization issues
   - Data dependencies or test environment problems
   - Application changes that broke test assumptions
5. **Fix the Code**: Update the test code to match the current UI state
   - Update selectors to match current elements
   - Fix assertions and expected values
   - Improve test reliability
   - For dynamic data, use flexible matchers
6. **Verify**: Use MCP tools to confirm your fix would work on the live page

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
// Server-action-compatible wrappers
// ---------------------------------------------------------------------------

/**
 * Heal a single failing test using the PW Healer agent.
 * Uses the AI provider + Playwright MCP tools to inspect and fix.
 */
export async function agentHealTestCore(
  repositoryId: string,
  testId: string,
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const test = await queries.getTest(testId);
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    // Get latest error
    const results = await queries.getTestResultsByTest(testId);
    const latestResult = results[results.length - 1];
    const errorMessage = latestResult?.errorMessage || 'Test failed with unknown error';

    const settings = await queries.getAISettings(repositoryId);
    const config = getAIConfig(settings);
    const seed = await buildSeedFixture(repositoryId);

    const prompt = `Fix this failing Playwright test.

**Test code:**
\`\`\`javascript
${test.code}
\`\`\`

**Error message:**
\`\`\`
${errorMessage}
\`\`\`

**Base URL:** ${seed.baseUrl}

Navigate to the relevant page using MCP tools, inspect the current UI state via browser_snapshot, diagnose why the test fails, and output the fixed test code.

---

${seed.seedPrompt}`;

    const response = await generateWithAI(config, prompt, HEALER_SYSTEM_PROMPT, {
      useMCP: true,
      repositoryId,
      actionType: 'agent_heal',
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

export async function agentHealTest(
  repositoryId: string,
  testId: string,
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);
  return agentHealTestCore(repositoryId, testId);
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
