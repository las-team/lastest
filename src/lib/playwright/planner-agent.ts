/**
 * Planner Agent — discovers functional areas and generates test plans
 * by exploring the live application via Playwright's built-in Planner agent.
 */

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import {
  spawnAgentProcess,
  createTempSpecDir,
  createTempTestDir,
  parsePlannerOutput,
  writeSeedTest,
  cleanupTempDir,
  type ParsedPlannerArea,
} from './agent-bridge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannerResult {
  areas: ParsedPlannerArea[];
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Run the Playwright Planner agent against a live application.
 *
 * The Planner explores the app starting from `baseUrl`, discovers routes
 * and functional areas, and produces markdown test plans in `specs/`.
 */
export async function runPlannerAgent(
  baseUrl: string,
  options?: {
    seedTestCode?: string;
    timeout?: number;
    stepLogger?: (line: string) => void;
    signal?: AbortSignal;
  },
): Promise<PlannerResult> {
  const specsDir = await createTempSpecDir('planner');
  const testsDir = options?.seedTestCode ? await createTempTestDir('planner-seed') : undefined;

  try {
    // Write seed test if provided (e.g. login script)
    if (testsDir && options?.seedTestCode) {
      await writeSeedTest(testsDir, options.seedTestCode);
    }

    const extraArgs: string[] = [
      `--base-url=${baseUrl}`,
      `--output=${specsDir}`,
    ];

    if (testsDir) {
      extraArgs.push(`--seed=${testsDir}`);
    }

    const result = await spawnAgentProcess('planner', extraArgs, {
      timeout: options?.timeout ?? 300_000,
      stepLogger: options?.stepLogger,
      signal: options?.signal,
    });

    if (result.exitCode !== 0 && result.exitCode !== null) {
      // Try to parse partial output even on non-zero exit
      const areas = await parsePlannerOutput(specsDir);
      if (areas.length > 0) {
        return { areas };
      }
      throw new Error(`Planner agent exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
    }

    const areas = await parsePlannerOutput(specsDir);
    return { areas };
  } finally {
    await cleanupTempDir(specsDir);
    if (testsDir) await cleanupTempDir(testsDir);
  }
}

// ---------------------------------------------------------------------------
// Server-action-compatible wrapper
// ---------------------------------------------------------------------------

/**
 * Discover functional areas for a repository using the Planner agent.
 * Creates/updates areas and routes in the database.
 */
export async function agentDiscoverAreas(
  repositoryId: string,
  baseUrl: string,
): Promise<{ success: boolean; functionalAreas?: Array<{ name: string; routes: Array<{ path: string; type: string; description?: string }> }>; error?: string }> {
  await requireRepoAccess(repositoryId);

  try {
    const settings = await queries.getAISettings(repositoryId);

    // Get default setup steps as seed if available
    let seedTestCode: string | undefined;
    const setupSteps = await queries.getDefaultSetupSteps(repositoryId);
    if (setupSteps.length > 0) {
      seedTestCode = setupSteps.map(s => s.code).join('\n');
    }

    const result = await runPlannerAgent(baseUrl, {
      seedTestCode,
      timeout: settings.pwAgentTimeout ?? 300_000,
    });

    // Map to DiscoveredArea format for compatibility with saveDiscoveredRoutes
    const functionalAreas = result.areas.map(area => ({
      name: area.name,
      description: area.description,
      routes: area.routes.map(routePath => ({
        path: routePath,
        type: routePath.includes('[') || routePath.includes(':') ? 'dynamic' as const : 'static' as const,
        description: undefined,
      })),
    }));

    // Save agent plans to functional areas
    for (const area of result.areas) {
      if (area.testPlan) {
        const dbArea = await queries.getOrCreateFunctionalAreaByRepo(
          repositoryId,
          area.name,
          area.description,
        );
        // Update the area with the agent plan
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
