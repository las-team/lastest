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
import type { AIProviderConfig } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Planner system prompt (derived from Playwright's planner agent definition)
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM_PROMPT = `You are an expert web test planner with extensive experience in quality assurance, user experience testing, and test scenario design.

You will:

1. **Navigate and Explore**
   - Use browser_navigate to go to the base URL
   - Use browser_snapshot to explore the accessibility tree
   - Use browser_click, browser_type, browser_hover to interact with the UI
   - Thoroughly explore the interface, identifying all interactive elements, forms, navigation paths, and functionality

2. **Analyze User Flows**
   - Map out the primary user journeys and identify critical paths
   - Consider different user types and their typical behaviors

3. **Design Comprehensive Scenarios**
   Create detailed test scenarios covering:
   - Happy path scenarios (normal user behavior)
   - Edge cases and boundary conditions
   - Error handling and validation

4. **Structure Test Plans**
   Each scenario must include:
   - Clear, descriptive title
   - Detailed step-by-step instructions
   - Expected outcomes where appropriate
   - Success criteria and failure conditions

5. **Output Format**
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
// Types
// ---------------------------------------------------------------------------

interface PlannerArea {
  name: string;
  description?: string;
  routes: string[];
  testPlan: string;
}

// ---------------------------------------------------------------------------
// Core
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

function parseAreasFromResponse(response: string): PlannerArea[] {
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
): Promise<{ success: boolean; functionalAreas?: Array<{ name: string; routes: Array<{ path: string; type: 'dynamic' | 'static'; description?: string }> }>; error?: string }> {
  await requireRepoAccess(repositoryId);

  try {
    const settings = await queries.getAISettings(repositoryId);
    const config = getAIConfig(settings);

    // Build the exploration prompt
    let prompt = `Explore the web application at ${baseUrl} and create a comprehensive test plan.\n\n`;
    prompt += `Start by navigating to ${baseUrl} and thoroughly exploring all pages, forms, and interactive elements.\n`;
    prompt += `Discover all functional areas and routes, then produce a structured test plan.\n`;

    // Include seed/setup context if available
    const setupSteps = await queries.getDefaultSetupSteps(repositoryId);
    if (setupSteps.length > 0) {
      const setupCode = setupSteps.map(s => s.code || s.scriptCode || '').filter(Boolean).join('\n');
      if (setupCode) {
        prompt += `\nSetup/seed test code (use this for authentication or initialization before exploring):\n\`\`\`javascript\n${setupCode}\n\`\`\`\n`;
      }
    }

    const response = await generateWithAI(config, prompt, PLANNER_SYSTEM_PROMPT, {
      useMCP: true,
      repositoryId,
      actionType: 'test_create',
    });

    const areas = parseAreasFromResponse(response);

    if (areas.length === 0) {
      return { success: false, error: 'Planner agent found no functional areas' };
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
