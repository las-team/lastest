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
- Plain JavaScript ONLY — NO TypeScript annotations, NO imports
- Use baseUrl for navigation (no hardcoded URLs)
- Take a screenshot after EACH scenario as a checkpoint
- Use stepLogger.log() for step descriptions — prefix with "Scenario N:" for multi-scenario tests
- ALWAYS use regex for URL checks: await expect(page).toHaveURL(/\\/path/)
- Every variable must use const or let
- Output ONLY the code block, no explanations`;

// ---------------------------------------------------------------------------
// Scenario parser — extracts individual test scenarios from an area's plan
// ---------------------------------------------------------------------------

export interface ParsedScenario {
  name: string;
  description: string;
  steps: string;
  /** Primary route this scenario tests (extracted from steps) */
  route?: string;
}

/**
 * A group of related scenarios that should be generated as a single multi-step test.
 * Grouped by route proximity so the test navigates efficiently.
 */
export interface ScenarioGroup {
  /** Test name */
  name: string;
  /** Test description — one-line summary of what this test covers */
  description: string;
  /** Combined prompt with all scenarios in this group */
  combinedSteps: string;
  /** Number of scenarios in this group */
  scenarioCount: number;
}

/**
 * Parse an agentPlan (markdown) into individual scenarios.
 */
function parseScenariosFromPlan(agentPlan: string, areaName: string): ParsedScenario[] {
  const scenarios: ParsedScenario[] = [];

  // Split by "### Scenario N: Title" headings
  const parts = agentPlan.split(/(?=###\s+Scenario\s+\d+:)/);
  for (const part of parts) {
    const headerMatch = part.match(/^###\s+Scenario\s+\d+:\s*(.+)/);
    if (!headerMatch) continue;
    const name = headerMatch[1].trim();
    const lines = part.split('\n').slice(1);
    const expectedIdx = lines.findIndex(l => /^\*\*Expected\*\*/.test(l));
    const expectedLine = expectedIdx >= 0 ? lines[expectedIdx] : '';
    const description = expectedLine.replace(/^\*\*Expected\*\*:\s*/, '').trim() || name;

    // Extract route from scenario steps (look for "Navigate to /path")
    const routeMatch = part.match(/Navigate to\s+(\/\S+)/i) || part.match(/\/[a-z][\w\-/[\]]*(?=\s|$)/i);
    const route = routeMatch ? routeMatch[1] || routeMatch[0] : undefined;

    scenarios.push({ name, description, steps: part.trim(), route });
  }

  if (scenarios.length > 0) return scenarios;

  // Fallback: split by "### Title" blocks
  const fallbackParts = agentPlan.split(/(?=###\s+(?!Source:))/);
  for (const part of fallbackParts) {
    const hMatch = part.match(/^###\s+(.+)/);
    if (!hMatch) continue;
    const name = hMatch[1].trim().replace(/^Route:\s*/, '');
    if (part.includes('\n-') || part.includes('\n1.')) {
      const routeMatch = part.match(/Navigate to\s+(\/\S+)/i) || part.match(/\/[a-z][\w\-/[\]]*(?=\s|$)/i);
      scenarios.push({
        name: `${areaName} - ${name}`,
        description: name,
        steps: part.trim(),
        route: routeMatch ? routeMatch[1] || routeMatch[0] : undefined,
      });
    }
  }

  if (scenarios.length > 0) return scenarios;

  return [{ name: areaName, description: `Test the ${areaName} functionality`, steps: agentPlan }];
}

/**
 * Group scenarios by route proximity into multi-step test groups.
 * Scenarios sharing the same base route are grouped together.
 * Each group becomes one test that covers multiple scenarios with intermediate screenshots.
 */
export function groupScenariosForGeneration(agentPlan: string, areaName: string, areaRoutes: string[]): ScenarioGroup[] {
  const scenarios = parseScenariosFromPlan(agentPlan, areaName);

  // If 3 or fewer scenarios, keep as one test
  if (scenarios.length <= 3) {
    return [{
      name: areaName,
      description: scenarios.map(s => s.name).join('; '),
      combinedSteps: agentPlan,
      scenarioCount: scenarios.length,
    }];
  }

  // Group by base route (first path segment after /)
  const groups = new Map<string, ParsedScenario[]>();

  for (const scenario of scenarios) {
    let routeKey = '_general';

    if (scenario.route) {
      // Normalize route to base path: /builds/[buildId]/diff/[diffId] → /builds
      const segments = scenario.route.replace(/\[.*?\]/g, '_').split('/').filter(Boolean);
      routeKey = segments[0] || '_general';
    } else {
      // Try to match against known area routes
      for (const r of areaRoutes) {
        const base = r.split('/').filter(Boolean)[0];
        if (base && scenario.steps.includes(r)) {
          routeKey = base;
          break;
        }
      }
    }

    if (!groups.has(routeKey)) groups.set(routeKey, []);
    groups.get(routeKey)!.push(scenario);
  }

  // Build groups, splitting large groups (>8 scenarios) into chunks
  const MAX_SCENARIOS_PER_TEST = 8;
  const result: ScenarioGroup[] = [];

  for (const [routeKey, groupScenarios] of groups) {
    for (let i = 0; i < groupScenarios.length; i += MAX_SCENARIOS_PER_TEST) {
      const chunk = groupScenarios.slice(i, i + MAX_SCENARIOS_PER_TEST);
      const isMultiChunk = groupScenarios.length > MAX_SCENARIOS_PER_TEST;
      const chunkIdx = Math.floor(i / MAX_SCENARIOS_PER_TEST) + 1;

      const groupName = routeKey === '_general'
        ? areaName
        : `${areaName} - /${routeKey}`;
      const name = isMultiChunk ? `${groupName} (Part ${chunkIdx})` : groupName;

      const combinedSteps = chunk.map((s, idx) => (
        `--- Scenario ${idx + 1}: ${s.name} ---\n${s.steps}\n\n**Take a screenshot after verifying this scenario.**`
      )).join('\n\n');

      result.push({
        name,
        description: chunk.map(s => s.name).join('; '),
        combinedSteps,
        scenarioCount: chunk.length,
      });
    }
  }

  return result;
}

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
      repositoryId,
      actionType: 'agent_generate',
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
