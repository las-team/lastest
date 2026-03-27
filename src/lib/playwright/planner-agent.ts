/**
 * Planner Agent — discovers functional areas and generates test plans
 * by using the AI provider with Playwright MCP tools to explore the live app.
 *
 * Uses the official Playwright Test Planner agent prompt with the
 * `playwright-test` MCP server (npx playwright run-test-mcp-server).
 */

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { generateWithAI } from '@/lib/ai';
import { getAIConfig, buildSeedFixture } from './agent-context';
import type { PlannerArea, ScoutArea, ScoutOutput } from './planner-types';

// ---------------------------------------------------------------------------
// Planner system prompt (derived from Playwright's planner agent definition)
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM_PROMPT = `You are an expert web test planner with extensive experience in quality assurance, user experience testing, and test scenario design.

You will:

1. **Run the Seed Test First**
   If a seed test is provided below, execute it step-by-step using MCP browser tools BEFORE exploring.
   This sets up authentication, login, or other prerequisites.

2. **Navigate and Explore**
   - Use browser_navigate to go to the base URL
   - Use browser_snapshot to explore the accessibility tree
   - Use browser_click, browser_type, browser_hover to interact with the UI
   - Thoroughly explore the interface, identifying all interactive elements, forms, navigation paths, and functionality
   - Use the known routes list (if provided) as starting points — visit each one

3. **Analyze User Flows**
   - Map out the primary user journeys and identify critical paths
   - Consider different user types and their typical behaviors

4. **Design Comprehensive Scenarios**
   Create detailed test scenarios covering:
   - Happy path scenarios (normal user behavior)
   - Edge cases and boundary conditions
   - Error handling and validation

5. **Structure Test Plans**
   Each scenario must include:
   - Clear, descriptive title
   - Detailed step-by-step instructions
   - Expected outcomes where appropriate
   - Success criteria and failure conditions

6. **Output Format**
   Output your test plan as structured JSON (no markdown, no extra text):

\`\`\`json
{
  "areas": [
    {
      "name": "Area Name",
      "description": "Brief description of this functional area",
      "routes": ["/path1", "/path2"],
      "testPlan": "## Area Name\\n\\n### Scenario 1\\n1. Step one\\n2. Step two\\n\\n### Scenario 2\\n..."
    }
  ]
}
\`\`\`

Quality Standards:
- Write steps specific enough for any tester to follow
- Include negative testing scenarios
- Ensure scenarios are independent and can be run in any order
- Group related functionality into functional areas`;

// ---------------------------------------------------------------------------
// Types (re-exported from shared module)
// ---------------------------------------------------------------------------

export type { PlannerArea } from './planner-types';

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export function parseAreasFromResponse(response: string): PlannerArea[] {
  // Extract JSON from response (may be wrapped in markdown code fences)
  const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || [null, response];
  const jsonStr = jsonMatch[1]?.trim() || response.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const rawAreas = parsed.areas || parsed;
    if (!Array.isArray(rawAreas)) return [];

    return rawAreas
      .filter((a: Record<string, unknown>) => a.name)
      .map((a: Record<string, unknown>) => ({
        name: String(a.name),
        description: a.description ? String(a.description) : undefined,
        routes: Array.isArray(a.routes) ? a.routes.map(String) : [],
        testPlan: a.testPlan ? String(a.testPlan) : '',
      }));
  } catch {
    // Try to extract areas from non-JSON structured response
    const areas: PlannerArea[] = [];
    const areaBlocks = response.split(/(?=^## )/m).filter(Boolean);
    for (const block of areaBlocks) {
      const nameMatch = block.match(/^## (.+)/m);
      if (!nameMatch) continue;
      const routes: string[] = [];
      for (const line of block.split('\n')) {
        const routeMatch = line.match(/^\s*[-*]\s*(\/\S+)/);
        if (routeMatch) routes.push(routeMatch[1]);
      }
      areas.push({
        name: nameMatch[1].trim(),
        routes,
        testPlan: block.trim(),
      });
    }
    return areas;
  }
}

// ---------------------------------------------------------------------------
// Server-action-compatible wrapper
// ---------------------------------------------------------------------------

/**
 * Discover functional areas for a repository using the Planner agent.
 * Uses the AI provider + Playwright MCP tools to explore the live app.
 */
export async function agentDiscoverAreas(
  repositoryId: string,
  baseUrl: string,
  options?: { onLogCreated?: (logId: string) => void },
): Promise<{ success: boolean; functionalAreas?: Array<{ name: string; description?: string; routes: Array<{ path: string; type: 'dynamic' | 'static'; description?: string }> }>; rawResponse?: string; error?: string }> {
  await requireRepoAccess(repositoryId);

  try {
    const settings = await queries.getAISettings(repositoryId);
    const config = getAIConfig(settings);
    const seed = await buildSeedFixture(repositoryId);

    // Build the exploration prompt with seed fixture
    let prompt = `Explore the web application at ${seed.baseUrl} and create a comprehensive test plan.\n\n`;
    prompt += `Start by navigating to ${seed.baseUrl} and thoroughly exploring all pages, forms, and interactive elements.\n`;
    prompt += `Discover all functional areas and routes, then produce a structured test plan.\n`;
    prompt += `\n---\n\n${seed.seedPrompt}`;

    const response = await generateWithAI(config, prompt, PLANNER_SYSTEM_PROMPT, {
      useMCP: true,
      repositoryId,
      actionType: 'agent_discover',
      onLogCreated: options?.onLogCreated,
    });

    const areas = parseAreasFromResponse(response);

    if (areas.length === 0) {
      return { success: false, rawResponse: response, error: 'Planner agent found no functional areas' };
    }

    // Map to DiscoveredArea format
    const functionalAreas = areas.map(area => ({
      name: area.name,
      description: area.description,
      routes: area.routes.map(routePath => ({
        path: routePath,
        type: (routePath.includes('[') || routePath.includes(':') ? 'dynamic' : 'static') as 'dynamic' | 'static',
        description: undefined,
      })),
    }));

    // Save agent plans to functional areas
    for (const area of areas) {
      if (area.testPlan) {
        const dbArea = await queries.getOrCreateFunctionalAreaByRepo(
          repositoryId,
          area.name,
          area.description,
        );
        await queries.updateFunctionalArea(dbArea.id, {
          agentPlan: area.testPlan,
          planGeneratedAt: new Date(),
        });
      }
    }

    revalidatePath('/areas');
    return { success: true, functionalAreas };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Planner agent failed';
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Scout — fast classification of areas (no MCP)
// ---------------------------------------------------------------------------

const SCOUT_SYSTEM_PROMPT = `You are an expert test planning classifier. You receive a list of functional areas discovered from a web application's codebase and route structure.

Classify each area as either:
- "skip" — Simple/static enough that basic test suggestions are sufficient. Examples: about pages, static docs, simple list views with no complex interactions.
- "explore" — Needs live browser exploration for a good test plan. Examples: forms with validation, multi-step workflows, dynamic JS content, auth flows, drag-and-drop, modals, real-time updates, interactive tables.

For "skip" areas: write a basic test plan with page load verification, key content checks, and navigation checks.
For "explore" areas: list 2-4 specific focus points for what a browser agent should test.

CLASSIFICATION HEURISTICS:
- Routes with dynamic segments ([id], :id) → likely "explore"
- Routes containing "new", "create", "edit", "record" → "explore"
- Auth-related areas (login, register, password) → "explore"
- Dashboard/home pages → "explore" (complex widgets)
- Settings pages with forms → "explore"
- Simple list/detail pages where code planner has suggestions → "skip"

OUTPUT FORMAT (JSON only, no markdown):
{
  "areas": [
    {
      "name": "Area Name",
      "classification": "skip",
      "routes": ["/path1"],
      "testPlan": "## Area Name\\n\\n### Scenario 1: Page Load\\n1. Navigate to /path1\\n2. Verify heading\\n\\n**Expected**: Page loads correctly"
    },
    {
      "name": "Area Name",
      "classification": "explore",
      "routes": ["/path1", "/path2"],
      "focusPoints": ["Test form validation on /path1", "Check dynamic content loading", "Verify error states"]
    }
  ]
}`;

export async function runScoutClassification(
  repositoryId: string,
  otherPlannerAreas: PlannerArea[],
  options?: { onLogCreated?: (logId: string) => void },
): Promise<ScoutOutput> {
  const start = Date.now();
  let promptLogId: string | undefined;

  const settings = await queries.getAISettings(repositoryId);
  const config = getAIConfig(settings);

  // Build input from other planners' results
  const areasSummary = otherPlannerAreas.map(a => ({
    name: a.name,
    routes: a.routes,
    hasTestSuggestions: !!a.testPlan && a.testPlan.length > 100,
    testPlanPreview: a.testPlan?.slice(0, 200),
  }));

  // Get codebase intelligence from active session
  const activeSession = await queries.getActiveAgentSession(repositoryId);
  const intelligence = activeSession?.metadata?.codebaseIntelligence as Record<string, unknown> | undefined;

  const prompt = `Classify these ${areasSummary.length} functional areas discovered from the codebase.

## Areas to Classify
${JSON.stringify(areasSummary, null, 2)}

${intelligence ? `## Codebase Intelligence\n${JSON.stringify(intelligence, null, 2)}` : ''}

Classify each area as "skip" or "explore" and output JSON.`;

  try {
    const response = await generateWithAI(config, prompt, SCOUT_SYSTEM_PROMPT, {
      repositoryId,
      actionType: 'agent_discover',
      onLogCreated: (id) => { promptLogId = id; options?.onLogCreated?.(id); },
    });

    // Parse scout output
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || [null, response];
    const jsonStr = jsonMatch[1]?.trim() || response.trim();
    const parsed = JSON.parse(jsonStr);
    const rawAreas = parsed.areas || parsed;

    if (!Array.isArray(rawAreas)) {
      return { areas: [], durationMs: Date.now() - start, promptLogId };
    }

    const areas: ScoutArea[] = rawAreas.map((a: Record<string, unknown>) => ({
      name: String(a.name || ''),
      classification: a.classification === 'explore' ? 'explore' as const : 'skip' as const,
      routes: Array.isArray(a.routes) ? a.routes.map(String) : [],
      testPlan: a.testPlan ? String(a.testPlan) : undefined,
      focusPoints: Array.isArray(a.focusPoints) ? a.focusPoints.map(String) : undefined,
    }));

    return { areas, durationMs: Date.now() - start, promptLogId };
  } catch {
    return { areas: [], durationMs: Date.now() - start, promptLogId };
  }
}

// ---------------------------------------------------------------------------
// Deep-Diver — focused browser exploration of one area (MCP)
// ---------------------------------------------------------------------------

const DEEP_DIVER_SYSTEM_PROMPT = `You are an expert web test planner exploring a specific functional area of a web application.

WORKFLOW:
1. **Run the Seed Test First** — if a seed fixture is provided, execute it using MCP browser tools to set up auth
2. Navigate to the target routes assigned to you
3. Use browser_snapshot to discover the page structure
4. Interact with forms, buttons, dropdowns using MCP tools
5. Create detailed test scenarios based on what you find

CONSTRAINTS:
- ONLY explore routes in your assigned area — do NOT wander to other sections
- Spend no more than 30 seconds per route
- If a route requires specific data/IDs, note this in the test plan
- Do NOT include login/setup steps in test plans — assume authenticated

OUTPUT FORMAT (JSON only):
{
  "areas": [{
    "name": "Area Name",
    "description": "What this area does based on exploration",
    "routes": ["/actual/routes/found"],
    "testPlan": "## Area Name\\n\\n### Scenario 1: Title\\n1. Navigate to...\\n2. ...\\n\\n**Expected**: ..."
  }]
}`;

export async function runDeepDiveExploration(
  areaName: string,
  routes: string[],
  focusPoints: string[] | undefined,
  repositoryId: string,
  baseUrl: string,
  options?: { onLogCreated?: (logId: string) => void },
): Promise<PlannerArea[]> {
  const settings = await queries.getAISettings(repositoryId);
  const config = getAIConfig(settings);
  const seed = await buildSeedFixture(repositoryId);

  let prompt = `Explore the "${areaName}" area of the web application at ${baseUrl}.\n\n`;
  prompt += `Target routes:\n${routes.map(r => `- ${r}`).join('\n')}\n\n`;

  if (focusPoints && focusPoints.length > 0) {
    prompt += `Focus your exploration on:\n${focusPoints.map(fp => `- ${fp}`).join('\n')}\n\n`;
  }

  prompt += `Navigate to each route, interact with the UI using MCP tools, and create detailed test scenarios.\n`;

  if (seed.hasLoginSetup) {
    prompt += `\n**The user is already authenticated. Do NOT include login steps in test plans.**\n`;
  }

  prompt += `\n---\n\n${seed.seedPrompt}`;

  const response = await generateWithAI(config, prompt, DEEP_DIVER_SYSTEM_PROMPT, {
    useMCP: true,
    repositoryId,
    actionType: 'agent_discover',
    onLogCreated: options?.onLogCreated,
  });

  return parseAreasFromResponse(response);
}
