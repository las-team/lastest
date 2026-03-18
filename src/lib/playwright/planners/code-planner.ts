/**
 * Code Planner — scans the repository's codebase to discover routes and areas.
 * Uses the existing aiScanRoutes() function.
 */

import type { PlannerResult } from '@/lib/playwright/planner-types';
import type { CodebaseIntelligenceContext } from '@/lib/ai/types';

export async function runCodePlanner(
  repositoryId: string,
  branch: string,
  intelligence?: CodebaseIntelligenceContext,
): Promise<PlannerResult> {
  try {
    const { aiScanRoutes } = await import('@/server/actions/ai-routes');
    const result = await aiScanRoutes(repositoryId, branch, intelligence);

    if (!result.success || !result.functionalAreas?.length) {
      return { source: 'code', areas: [], error: result.error || 'No routes found in codebase' };
    }

    const areas = result.functionalAreas.map(fa => ({
      name: fa.name,
      description: fa.description,
      routes: fa.routes.map(r => r.path),
      testPlan: buildCodeTestPlan(fa.name, fa.routes),
    }));

    return { source: 'code', areas };
  } catch (error) {
    return {
      source: 'code',
      areas: [],
      error: error instanceof Error ? error.message : 'Code planner failed',
    };
  }
}

function buildCodeTestPlan(
  areaName: string,
  routes: Array<{ path: string; description?: string; testSuggestions?: string[] }>,
): string {
  const lines: string[] = [`## ${areaName} (from codebase scan)\n`];

  for (const route of routes) {
    lines.push(`### Route: ${route.path}`);
    if (route.description) lines.push(route.description);

    if (route.testSuggestions?.length) {
      for (const suggestion of route.testSuggestions) {
        lines.push(`- ${suggestion}`);
      }
    } else {
      lines.push(`- Navigate to ${route.path} and verify page loads`);
      lines.push(`- Check for correct heading/content`);
      lines.push(`- Verify navigation elements are present`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
