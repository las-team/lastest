'use server';

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { agentDiscoverAreas as runAgentDiscovery } from '@/lib/playwright/planner-agent';
import { aiScanRoutes, type DiscoveredArea } from './ai-routes';

/**
 * Unified area discovery server action.
 *
 * Routes to PW Planner agent when enabled, falls back to AI scan.
 * This is the primary entry point for the "Discover Areas" button.
 */
export async function discoverAreas(
  repositoryId: string,
  branch: string,
): Promise<{ success: boolean; functionalAreas?: DiscoveredArea[]; error?: string }> {
  await requireRepoAccess(repositoryId);

  const settings = await queries.getAISettings(repositoryId);

  if (settings.pwAgentEnabled) {
    // Get base URL for agent
    const envConfig = await queries.getEnvironmentConfig(repositoryId);
    const baseUrl = envConfig?.baseUrl || 'http://localhost:3000';

    const result = await runAgentDiscovery(repositoryId, baseUrl);

    if (result.success && result.functionalAreas) {
      revalidatePath('/areas');
      return {
        success: true,
        functionalAreas: result.functionalAreas.map(area => ({
          name: area.name,
          routes: area.routes.map(r => ({
            path: r.path,
            type: r.type as 'static' | 'dynamic',
            description: r.description,
          })),
        })),
      };
    }

    // If agent failed but we have a GitHub connection, fall back to AI scan
    if (result.error) {
      console.warn(`Planner agent failed: ${result.error}, falling back to AI scan`);
    }
  }

  // Fall back to AI scan
  return aiScanRoutes(repositoryId, branch);
}

/**
 * Verify that Playwright agents are available and configured.
 */
export async function verifyPwAgentSetup(
  repositoryId: string,
): Promise<{
  playwrightInstalled: boolean;
  agentsAvailable: boolean;
  version?: string;
  error?: string;
}> {
  await requireRepoAccess(repositoryId);

  try {
    const { spawn } = await import('child_process');

    // Check if playwright is installed
    const result = await new Promise<{ stdout: string; exitCode: number | null }>((resolve) => {
      const child = spawn('npx', ['playwright', '--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      });

      let stdout = '';
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.on('close', (code) => resolve({ stdout: stdout.trim(), exitCode: code }));
      child.on('error', () => resolve({ stdout: '', exitCode: 1 }));
    });

    if (result.exitCode !== 0) {
      return {
        playwrightInstalled: false,
        agentsAvailable: false,
        error: 'Playwright is not installed. Run: npx playwright install',
      };
    }

    const version = result.stdout.match(/Version\s+([\d.]+)/)?.[1] || result.stdout;

    return {
      playwrightInstalled: true,
      agentsAvailable: true,
      version,
    };
  } catch (error) {
    return {
      playwrightInstalled: false,
      agentsAvailable: false,
      error: error instanceof Error ? error.message : 'Failed to verify setup',
    };
  }
}
