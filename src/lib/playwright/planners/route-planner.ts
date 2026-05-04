/**
 * Route Planner — uses known DB routes (from scan_and_template step) to
 * produce test plan areas. Pure DB logic, no AI calls.
 */

import * as queries from '@/lib/db/queries';
import type { PlannerResult } from '@/lib/playwright/planner-types';

export async function runRoutePlanner(
  repositoryId: string,
): Promise<PlannerResult> {
  const start = Date.now();
  try {
    const [routes, areas] = await Promise.all([
      queries.getRoutesByRepo(repositoryId),
      queries.getFunctionalAreasByRepo(repositoryId),
    ]);

    if (routes.length === 0) {
      return { source: 'routes', areas: [], durationMs: Date.now() - start, inputSummary: '0 routes in DB' };
    }

    // Build a map of area ID → area for quick lookup
    const areaMap = new Map(areas.map(a => [a.id, a]));

    // Group routes by their functional area (or 'uncategorized' if none)
    const groupedByArea = new Map<string, { name: string; description?: string; routes: typeof routes }>();

    for (const route of routes) {
      const area = route.functionalAreaId ? areaMap.get(route.functionalAreaId) : null;
      const key = area?.id || '__uncategorized__';

      if (!groupedByArea.has(key)) {
        if (area) {
          // The route-planner produces a transient runtime "description" hint that downstream
          // merging uses for fuzzy area dedup. Drawing it from agentPlan keeps that signal alive.
          groupedByArea.set(key, { name: area.name, description: area.agentPlan || undefined, routes: [] });
        } else {
          // Group uncategorized routes by first path segment
          const segments = route.path.split('/').filter(Boolean);
          const prefix = segments[0] || 'root';
          const groupKey = `__prefix_${prefix}`;
          if (!groupedByArea.has(groupKey)) {
            groupedByArea.set(groupKey, {
              name: prefix.charAt(0).toUpperCase() + prefix.slice(1),
              description: `Routes under /${prefix}`,
              routes: [],
            });
          }
          groupedByArea.get(groupKey)!.routes.push(route);
          continue;
        }
      }
      groupedByArea.get(key)!.routes.push(route);
    }

    const plannerAreas = Array.from(groupedByArea.values())
      .filter(g => g.routes.length > 0)
      .map(g => ({
        name: g.name,
        description: g.description,
        routes: g.routes.map(r => r.path),
        testPlan: buildRouteTestPlan(g.name, g.routes),
      }));

    return { source: 'routes', areas: plannerAreas, durationMs: Date.now() - start, inputSummary: `${routes.length} routes, ${areas.length} existing areas` };
  } catch (error) {
    return {
      source: 'routes',
      areas: [],
      error: error instanceof Error ? error.message : 'Route planner failed',
      durationMs: Date.now() - start,
      inputSummary: 'DB query failed',
    };
  }
}

function buildRouteTestPlan(
  groupName: string,
  groupRoutes: Array<{ path: string }>,
): string {
  const lines: string[] = [`## ${groupName} (from known routes)\n`];

  for (const route of groupRoutes) {
    lines.push(`### Route: ${route.path}`);
    lines.push(`- Navigate to ${route.path} and verify page loads without errors`);
    lines.push(`- Verify page heading/title is present`);
    lines.push(`- Check for broken links or missing assets`);
    lines.push('');
  }

  return lines.join('\n');
}
