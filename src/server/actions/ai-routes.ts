'use server';

import * as queries from '@/lib/db/queries';
import { generateWithAI, createRouteScanPrompt, SYSTEM_PROMPT } from '@/lib/ai';
import type { AIProviderConfig } from '@/lib/ai/types';
import { revalidatePath } from 'next/cache';
import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';

async function getAIConfig(repositoryId?: string | null): Promise<AIProviderConfig> {
  const settings = await queries.getAISettings(repositoryId);
  return {
    provider: settings.provider as 'claude-cli' | 'openrouter',
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || 'anthropic/claude-sonnet-4',
    customInstructions: settings.customInstructions,
  };
}

interface DiscoveredRoute {
  path: string;
  type: 'static' | 'dynamic';
  description?: string;
  testSuggestions?: string[];
}

// Read directory structure for AI context
async function getCodebaseContext(localPath: string, maxDepth = 3): Promise<string> {
  const context: string[] = [];

  async function scanDir(dir: string, depth: number, prefix = ''): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const relevantEntries = entries.filter((e) => {
        // Skip node_modules, .git, dist, build, etc.
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') {
          return false;
        }
        // For files, only include relevant extensions
        if (e.isFile()) {
          const ext = extname(e.name);
          return ['.tsx', '.ts', '.jsx', '.js', '.vue', '.svelte'].includes(ext);
        }
        return e.isDirectory();
      });

      for (const entry of relevantEntries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          context.push(`${prefix}${entry.name}/`);
          await scanDir(fullPath, depth + 1, `${prefix}  `);
        } else {
          context.push(`${prefix}${entry.name}`);
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  // Focus on routing-related directories
  const routeDirs = ['pages', 'app', 'src/pages', 'src/app', 'src/routes', 'routes', 'views'];

  for (const routeDir of routeDirs) {
    const fullPath = join(localPath, routeDir);
    try {
      await readdir(fullPath);
      context.push(`\n=== ${routeDir}/ ===`);
      await scanDir(fullPath, 0, '  ');
    } catch {
      // Directory doesn't exist
    }
  }

  // Also include package.json for framework detection
  try {
    const packageJson = await readFile(join(localPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(packageJson);
    context.push('\n=== package.json (dependencies) ===');
    context.push(JSON.stringify({
      dependencies: Object.keys(pkg.dependencies || {}),
      devDependencies: Object.keys(pkg.devDependencies || {}),
    }, null, 2));
  } catch {
    // No package.json
  }

  return context.join('\n');
}

export async function aiScanRoutes(
  repositoryId: string,
  localPath: string
): Promise<{ success: boolean; routes?: DiscoveredRoute[]; error?: string }> {
  try {
    const config = await getAIConfig(repositoryId);
    const codebaseContext = await getCodebaseContext(localPath);

    if (!codebaseContext.trim()) {
      return { success: false, error: 'Could not read codebase structure' };
    }

    const prompt = createRouteScanPrompt(codebaseContext);
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      actionType: 'scan_routes',
      repositoryId,
    });

    // Parse JSON response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return { success: false, error: 'AI did not return valid JSON' };
    }

    const routes: DiscoveredRoute[] = JSON.parse(jsonMatch[0]);
    return { success: true, routes };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scan routes';
    return { success: false, error: message };
  }
}

export async function saveDiscoveredRoutes(
  repositoryId: string,
  routes: DiscoveredRoute[]
): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    // Get existing routes to avoid duplicates
    const existingRoutes = await queries.getRoutesByRepo(repositoryId);
    const existingPaths = new Set(existingRoutes.map((r) => r.path));

    // Filter out duplicates
    const newRoutes = routes.filter((r) => !existingPaths.has(r.path));

    if (newRoutes.length === 0) {
      return { success: true, count: 0 };
    }

    // Create routes
    const routeData = newRoutes.map((r) => ({
      repositoryId,
      path: r.path,
      type: r.type,
      scannedAt: new Date(),
    }));

    await queries.createRoutes(routeData);

    revalidatePath('/repo');
    revalidatePath('/tests');

    return { success: true, count: newRoutes.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save routes';
    return { success: false, error: message };
  }
}
