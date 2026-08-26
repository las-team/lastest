/**
 * Healer Agent — auto-fixes failing tests by giving the AI provider live
 * MCP browser tools bound to a core-issued `BrowserSession`, so it can
 * inspect the live UI and patch broken selectors/assertions instead of
 * guessing.
 *
 * Uses the official Playwright Test Healer agent prompt.
 */

import type { AiCapability, BrowserSession } from "@lastest/contracts";
import {
  extractCodeFromResponse,
  SELECTOR_ROBUSTNESS_RULES,
} from "@lastest/ai-kit";

import type { AuthoringAiHost } from "./host";
import { runValidationWithRetry } from "./validation";

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
- Plain JavaScript ONLY — NO TypeScript, NO imports, NO \`await import()\`
- Do NOT re-declare expect — it is provided as a parameter by the runner
- Use baseUrl for navigation (no hardcoded URLs)
- Keep stepLogger.log() calls for step descriptions
- Output ONLY the fixed code block, no explanations
- Do not add test.fixme() — always attempt a real fix

PRESERVE THE TEST'S INTENT (do not "fix" a test by defeating its purpose):
- NEVER delete or loosen an assertion just to make the test pass. Fix broken SELECTORS and TIMING; if an assertion is correct but the app genuinely misbehaves, leave that assertion failing — a real product bug is a valid test result, not something to heal away.
- NEVER remove intentional failure injection (page.route(...).abort()/fulfill({ status: 500 })) or negative-input steps. Those tests are SUPPOSED to drive an error path; heal the assertion about the error UI, not the injection.
- "Flexible matchers for dynamic data" means matching a stable pattern (e.g. a currency/number shape), NOT weakening a specific expected value into an always-true check (toBeVisible on the body, .toBeTruthy(), removing the assertion).

${SELECTOR_ROBUSTNESS_RULES}`;

export interface HealOptions {
  signal?: AbortSignal;
  /** Caller-supplied statement of what the test is meant to prove (QA agent
   *  passes the plan item's coverage groups + end-state requirement) so the
   *  healer preserves that intent instead of loosening assertions to pass. */
  intent?: string;
}

/**
 * Heal a single failing test using the PW Healer agent, on an
 * already-claimed browser session.
 */
export async function agentHealTest(
  host: AuthoringAiHost,
  ai: AiCapability,
  session: BrowserSession,
  repositoryId: string,
  testId: string,
  options?: HealOptions,
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const test = await host.getTestForHealing(testId);
    if (!test) {
      return { success: false, error: "Test not found" };
    }

    // Latest result first — the healer must diagnose the most recent
    // failure's error/DOM snapshot, not a stale one.
    const latestResult = await host.getLatestTestResult(testId);
    const errorMessage =
      latestResult?.errorMessage || "Test failed with unknown error";

    const seed = await host.buildSeedFixture(repositoryId);

    let domDiffContext = "";
    if (test.domSnapshot && latestResult?.domSnapshot) {
      const summary = await host.summarizeDomChanges(
        test.domSnapshot,
        latestResult.domSnapshot,
      );
      if (summary) {
        domDiffContext = `\n**DOM changes since recording (selectors/elements that changed):**\n\`\`\`\n${summary}\n\`\`\`\n\nUse these DOM changes to understand what selectors broke and why. The removed/changed elements are likely the root cause of the failure.\n`;
      }
    }

    const prompt = `Fix this failing Playwright test.

**Test code:**
\`\`\`javascript
${test.code}
\`\`\`

**Error message:**
\`\`\`
${errorMessage}
\`\`\`
${domDiffContext}${
      options?.intent
        ? `\n**What this test must prove (preserve this intent — do not weaken assertions to force a pass):**\n${options.intent}\n`
        : ""
    }
**Base URL:** ${seed.baseUrl}

Navigate to the relevant page using MCP tools, inspect the current UI state via browser_snapshot, diagnose why the test fails, and output the fixed test code.

---

${seed.seedPrompt}`;

    const callLLM = async (userPrompt: string): Promise<string> => {
      const result = await ai.generate(userPrompt, {
        actionType: "agent_heal",
        repositoryId,
        systemPrompt: HEALER_SYSTEM_PROMPT,
        signal: options?.signal,
        browserTools: session,
      });
      return extractCodeFromResponse(result.text) ?? "";
    };

    const initial = await callLLM(prompt);
    if (!initial) {
      return { success: false, error: "Healer agent produced no fixed code" };
    }

    const validated = await runValidationWithRetry(
      host,
      initial,
      async (feedback, attempt) => {
        console.log(
          `[HealerAgent] Validation failed, retry ${attempt}/2 with feedback`,
        );
        const retryPrompt = `${prompt}\n\n---\n\nPrevious fix attempt failed validation. ${feedback}\n\nRegenerate the fixed test code addressing the validation errors. Output ONLY the corrected code block.`;
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
      error instanceof Error ? error.message : "Healer agent failed";
    return { success: false, error: message };
  }
}
