/**
 * Generator Agent — generates Playwright test code from specs/plans by
 * giving the AI provider live MCP browser tools bound to a core-issued
 * `BrowserSession`, so it can verify selectors against the real page
 * instead of hallucinating them.
 *
 * Uses the official Playwright Test Generator agent prompt.
 */

import type { AiCapability, BrowserSession } from "@lastest/contracts";
import {
  extractCodeFromResponse,
  SELECTOR_ROBUSTNESS_RULES,
} from "@lastest/ai-kit";

import type { AuthoringAiHost } from "./host";
import {
  groupScenariosForGeneration,
  parseScenariosFromPlan,
  type ScenarioGroup,
} from "./scenario-grouping";
import { runValidationWithRetry } from "./validation";

export { parseScenariosFromPlan, groupScenariosForGeneration };
export type { ScenarioGroup };

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

SCENARIO / CHECKPOINT STRUCTURE:
You are usually given ONE scenario made of numbered steps. Take a screenshot checkpoint after each KEY state the scenario reaches — the initial page, and each state a later check layer needs to see (an opened dialog, an error/validation state, the post-submit confirmation). The platform runs axe / Core Web Vitals / visual diffing on EVERY captured state, so a state that is never screenshotted is never checked. Use a unique filename per checkpoint and the original screenshotPath for the final one:
  await page.screenshot({ path: screenshotPath.replace('.png', '-step-1.png'), fullPage: true });
If given multiple independent scenarios, cover them in one test function in sequence.
Group related interactions (same page/route) together for efficiency — don't navigate away and back unnecessarily.

OVERLAYS: If a cookie/consent banner, newsletter, or intro modal is present and would intercept clicks, dismiss it first (accept/close) via a verified selector before interacting with the page under test.

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
- UNIQUE TEST DATA: when the test creates a record (signup, new item, invite), build the uniqueness-constrained field at runtime with a unique suffix — e.g. const email = \`user-\${Date.now().toString(36)}@example.com\`. Never hardcode a value that a unique constraint will reject on the second run.
- Output ONLY the code block, no explanations

${SELECTOR_ROBUSTNESS_RULES}`;

// ---------------------------------------------------------------------------
// Context passed in by the caller (matches the pre-plugin TestGenerationContext)
// ---------------------------------------------------------------------------

export interface GeneratorContext {
  functionalAreaId?: string;
  testName?: string;
  /** Not read by the generator itself — carried for parity with callers'
   *  broader `TestGenerationContext` shape. */
  targetUrl?: string;
  /** Not read either — the generator derives its base URL from the seed
   *  fixture's env config, not from caller input. */
  baseUrl?: string;
  routePath?: string;
  userPrompt?: string;
  scanContext?: {
    specDescription?: string;
    testSuggestions?: string[];
  };
  preAuthenticated?: boolean;
  scenarioGroup?: ScenarioGroup;
}

/**
 * Generate a test using the PW Generator agent, on an already-claimed
 * browser session (`ctx.browser.withBrowser`'s callback argument).
 *
 * When `scenarioGroup` is provided, generates a multi-step test covering
 * all scenarios in the group. Otherwise generates a test from the full
 * area plan (legacy behavior).
 */
export async function agentCreateTest(
  host: AuthoringAiHost,
  ai: AiCapability,
  session: BrowserSession,
  repositoryId: string,
  context: GeneratorContext,
  options?: { signal?: AbortSignal },
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const seed = await host.buildSeedFixture(repositoryId);

    let prompt = "";

    if (context.scenarioGroup) {
      const g = context.scenarioGroup;
      prompt = `Generate a Playwright test that covers ${g.scenarioCount} scenarios in one multi-step test.\n`;
      prompt += `After verifying each scenario, take a screenshot checkpoint.\n\n`;
      prompt += g.combinedSteps + "\n\n";
      prompt += `Create ONE test function that walks through all ${g.scenarioCount} scenarios in sequence.\n`;
      prompt += `Group interactions on the same page together for efficiency.\n`;
    } else if (context.functionalAreaId) {
      const agentPlan = await host.getFunctionalAreaPlan(
        context.functionalAreaId,
      );
      if (agentPlan) {
        prompt = `Generate a Playwright test based on this test plan:\n\n${agentPlan}\n\n`;
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
        parts.push(
          `Test Suggestions:\n${context.scanContext.testSuggestions.map((s) => `- ${s}`).join("\n")}`,
        );
      }
      prompt =
        parts.join("\n") || "Generate a comprehensive test for this page.";
    }

    prompt += `\n\nTarget base URL: ${seed.baseUrl}`;
    prompt += `\nNavigate to the page, explore it using MCP tools, then generate the test code.`;
    // The QA agent may have injected an authenticated session directly into
    // the exploration browser (context.preAuthenticated) even when the repo
    // has no login-bearing default setup step (seed.hasLoginSetup is false
    // for a per-test storage_state override). Honor either signal so the
    // generator's auth story matches the browser it is actually driving.
    if (seed.hasLoginSetup || context.preAuthenticated) {
      prompt += `\n\n**IMPORTANT: Do NOT include login/auth/setup steps in your generated test code. Authentication is applied automatically before the test runs (an injected session or a setup script), and your MCP exploration browser is already signed in. Your test should assume the user is already logged in — start directly on the page being tested. If exploration lands on a login page, the session lapsed: report it rather than scripting a manual login.**`;
    }
    prompt += `\n\n---\n\n${seed.seedPrompt}`;

    const callLLM = async (userPrompt: string): Promise<string> => {
      const result = await ai.generate(userPrompt, {
        actionType: "agent_generate",
        repositoryId,
        systemPrompt: GENERATOR_SYSTEM_PROMPT,
        signal: options?.signal,
        browserTools: session,
      });
      return extractCodeFromResponse(result.text) ?? "";
    };

    const initial = await callLLM(prompt);
    if (!initial) {
      return { success: false, error: "Generator agent produced no test code" };
    }

    const validated = await runValidationWithRetry(
      host,
      initial,
      async (feedback, attempt) => {
        console.log(
          `[GeneratorAgent] Validation failed, retry ${attempt}/2 with feedback`,
        );
        const retryPrompt = `${prompt}\n\n---\n\nPrevious attempt failed validation. ${feedback}\n\nRegenerate the test code addressing the validation errors. Output ONLY the corrected code block.`;
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
      error instanceof Error ? error.message : "Generator agent failed";
    return { success: false, error: message };
  }
}
