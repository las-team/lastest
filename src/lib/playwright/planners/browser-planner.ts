/**
 * Browser Planner — two-phase approach:
 * 1. Scout (fast, no MCP): classifies areas as skip/explore based on code+route planner results
 * 2. Deep-Dive (MCP, parallel): focused browser exploration of only complex areas
 *
 * Falls back to monolithic exploration if scout fails.
 */

import type { PlannerArea, PlannerResult, ScoutOutput } from '@/lib/playwright/planner-types';

const DEEP_DIVE_CONCURRENCY = 3;

export interface BrowserPlannerOptions {
  otherPlannerAreas?: PlannerArea[];
  onScoutComplete?: (scout: ScoutOutput) => void;
  onDeepDiveStart?: (areaName: string) => void;
  onDeepDiveComplete?: (areaName: string, areasFound: number, durationMs: number, promptLogId?: string) => void;
  signal?: AbortSignal;
  onLogCreated?: (logId: string) => void;
}

export async function runBrowserPlanner(
  repositoryId: string,
  baseUrl: string,
  options?: BrowserPlannerOptions,
): Promise<PlannerResult> {
  const start = Date.now();
  const otherAreas = options?.otherPlannerAreas || [];

  // If no other planner data, fall back to monolithic exploration
  if (otherAreas.length === 0) {
    return runFallbackExploration(repositoryId, baseUrl, options);
  }

  // Phase 1: Scout classification (no MCP, fast)
  let scoutOutput: ScoutOutput;
  try {
    const { runScoutClassification } = await import('@/lib/playwright/planner-agent');
    scoutOutput = await runScoutClassification(repositoryId, otherAreas, {
      onLogCreated: options?.onLogCreated,
    });
  } catch {
    // Scout failed — fall back to monolithic
    return runFallbackExploration(repositoryId, baseUrl, options);
  }

  if (scoutOutput.areas.length === 0) {
    return runFallbackExploration(repositoryId, baseUrl, options);
  }

  options?.onScoutComplete?.(scoutOutput);

  if (options?.signal?.aborted) {
    return { source: 'browser', areas: [], durationMs: Date.now() - start, inputSummary: 'Aborted' };
  }

  // Collect skip areas directly from scout
  const skipAreas: PlannerArea[] = scoutOutput.areas
    .filter(a => a.classification === 'skip' && a.testPlan)
    .map(a => ({
      name: a.name,
      routes: a.routes,
      testPlan: a.testPlan!,
    }));

  // Phase 2: Deep-dive for explore areas (MCP, parallel batches)
  const exploreAreas = scoutOutput.areas.filter(a => a.classification === 'explore');
  const deepDiveResults: PlannerArea[] = [];

  if (exploreAreas.length > 0) {
    const { runDeepDiveExploration } = await import('@/lib/playwright/planner-agent');

    for (let batch = 0; batch < exploreAreas.length; batch += DEEP_DIVE_CONCURRENCY) {
      if (options?.signal?.aborted) break;

      const chunk = exploreAreas.slice(batch, batch + DEEP_DIVE_CONCURRENCY);

      const batchResults = await Promise.allSettled(
        chunk.map(async (area) => {
          options?.onDeepDiveStart?.(area.name);
          const diveStart = Date.now();
          let diveLogId: string | undefined;

          try {
            const areas = await runDeepDiveExploration(
              area.name,
              area.routes,
              area.focusPoints,
              repositoryId,
              baseUrl,
              { onLogCreated: (id) => { diveLogId = id; } },
            );
            const diveDuration = Date.now() - diveStart;
            options?.onDeepDiveComplete?.(area.name, areas.length, diveDuration, diveLogId);
            return areas;
          } catch (err) {
            const diveDuration = Date.now() - diveStart;
            options?.onDeepDiveComplete?.(area.name, 0, diveDuration, diveLogId);
            // On failure, create a basic plan from scout's focus points
            return [{
              name: area.name,
              routes: area.routes,
              testPlan: buildFallbackPlanFromFocusPoints(area.name, area.routes, area.focusPoints),
            }] as PlannerArea[];
          }
        }),
      );

      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          deepDiveResults.push(...r.value);
        }
      }
    }
  }

  const allAreas = [...skipAreas, ...deepDiveResults];

  return {
    source: 'browser',
    areas: allAreas,
    durationMs: Date.now() - start,
    promptLogId: scoutOutput.promptLogId,
    inputSummary: `Scout: ${skipAreas.length} skip, ${exploreAreas.length} explore. Deep-dived ${deepDiveResults.length} areas.`,
  };
}

/** Fallback: use the original monolithic browser exploration */
async function runFallbackExploration(
  repositoryId: string,
  baseUrl: string,
  options?: BrowserPlannerOptions,
): Promise<PlannerResult> {
  const start = Date.now();
  let promptLogId: string | undefined;

  try {
    const { agentDiscoverAreas } = await import('@/lib/playwright/planner-agent');
    const result = await agentDiscoverAreas(repositoryId, baseUrl, {
      onLogCreated: (id) => { promptLogId = id; options?.onLogCreated?.(id); },
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
        inputSummary: `Fallback: baseUrl=${baseUrl}`,
      };
    }

    const dbQueries = await import('@/lib/db/queries');
    const dbAreas = await dbQueries.getFunctionalAreasByRepo(repositoryId);
    const areas = result.functionalAreas.map(fa => {
      const dbArea = dbAreas.find(a => a.name === fa.name);
      return {
        name: fa.name,
        description: fa.description,
        routes: fa.routes.map(r => r.path),
        testPlan: dbArea?.agentPlan || '',
      };
    });

    return { source: 'browser', areas, promptLogId, durationMs, inputSummary: `Fallback: baseUrl=${baseUrl}` };
  } catch (error) {
    return {
      source: 'browser',
      areas: [],
      error: error instanceof Error ? error.message : 'Browser planner failed',
      promptLogId,
      durationMs: Date.now() - start,
      inputSummary: `Fallback: baseUrl=${baseUrl}`,
    };
  }
}

/** Generate a basic test plan from scout focus points when deep-diver fails */
function buildFallbackPlanFromFocusPoints(name: string, routes: string[], focusPoints?: string[]): string {
  const lines = [`## ${name}\n`];
  for (const route of routes) {
    lines.push(`### Route: ${route}`);
    lines.push(`- Navigate to ${route} and verify page loads`);
    lines.push(`- Verify page heading/content is present`);
  }
  if (focusPoints?.length) {
    lines.push(`\n### Focus Areas (from scout — deep-dive failed)`);
    for (const fp of focusPoints) {
      lines.push(`- ${fp}`);
    }
  }
  return lines.join('\n');
}
