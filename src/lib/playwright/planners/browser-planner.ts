/**
 * Browser Planner — explores the live app via Playwright MCP tools.
 * Wraps the existing agentDiscoverAreas() logic.
 */

import type { PlannerResult } from '@/lib/playwright/planner-types';
import { agentDiscoverAreas } from '@/lib/playwright/planner-agent';

export async function runBrowserPlanner(
  repositoryId: string,
  baseUrl: string,
): Promise<PlannerResult> {
  try {
    const result = await agentDiscoverAreas(repositoryId, baseUrl);

    if (!result.success || !result.functionalAreas?.length) {
      return {
        source: 'browser',
        areas: [],
        rawOutput: result.rawResponse,
        error: result.error || 'No areas discovered',
      };
    }

    // agentDiscoverAreas already saves agentPlan to DB — we just need the PlannerArea format
    const { default: queries } = await import('@/lib/db/queries');
    const dbAreas = await queries.getFunctionalAreasByRepo(repositoryId);

    const areas = result.functionalAreas.map(fa => {
      const dbArea = dbAreas.find(a => a.name === fa.name);
      return {
        name: fa.name,
        description: fa.description,
        routes: fa.routes.map(r => r.path),
        testPlan: dbArea?.agentPlan || '',
      };
    });

    return { source: 'browser', areas };
  } catch (error) {
    return {
      source: 'browser',
      areas: [],
      error: error instanceof Error ? error.message : 'Browser planner failed',
    };
  }
}
