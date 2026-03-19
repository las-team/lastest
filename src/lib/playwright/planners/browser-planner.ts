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
  const start = Date.now();
  let promptLogId: string | undefined;

  try {
    const result = await agentDiscoverAreas(repositoryId, baseUrl, {
      onLogCreated: (id) => { promptLogId = id; },
    });
    const durationMs = Date.now() - start;

    if (!result.success || !result.functionalAreas?.length) {
      return {
        source: 'browser',
        areas: [],
        rawOutput: result.rawResponse,
        error: result.error || 'No areas discovered',
        promptLogId,
        durationMs,
        inputSummary: `baseUrl: ${baseUrl}`,
      };
    }

    // agentDiscoverAreas already saves agentPlan to DB — we just need the PlannerArea format
    const queries = await import('@/lib/db/queries');
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

    return {
      source: 'browser',
      areas,
      promptLogId,
      durationMs,
      inputSummary: `baseUrl: ${baseUrl}`,
    };
  } catch (error) {
    return {
      source: 'browser',
      areas: [],
      error: error instanceof Error ? error.message : 'Browser planner failed',
      promptLogId,
      durationMs: Date.now() - start,
      inputSummary: `baseUrl: ${baseUrl}`,
    };
  }
}
