'use server';

import * as queries from '@/lib/db/queries';
import { generateWithAI, createRouteScanPrompt, createMCPExploreRoutesPrompt, SYSTEM_PROMPT, MCP_SYSTEM_PROMPT } from '@/lib/ai';
import type { AIProviderConfig } from '@/lib/ai/types';
import { revalidatePath } from 'next/cache';
import { getRepoTree, getFileContent, type TreeEntry } from '@/lib/github/content';

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

// Read directory structure for AI context via GitHub API
async function getCodebaseContext(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
  maxDepth = 3
): Promise<string> {
  const context: string[] = [];

  // Fetch repo tree
  const repoTree = await getRepoTree(accessToken, owner, repo, branch);
  if (!repoTree || repoTree.tree.length === 0) {
    return '';
  }

  const tree = repoTree.tree;

  // Focus on routing-related directories
  const routeDirs = ['pages', 'app', 'src/pages', 'src/app', 'src/routes', 'routes', 'views'];

  for (const routeDir of routeDirs) {
    const filesInDir = tree.filter((entry) => {
      if (entry.type !== 'blob') return false;
      if (!entry.path.startsWith(routeDir + '/') && entry.path !== routeDir) return false;

      // Filter by depth
      const depth = entry.path.split('/').length - routeDir.split('/').length;
      if (depth > maxDepth) return false;

      // Skip node_modules, .git, dist, build
      if (entry.path.includes('node_modules') || entry.path.includes('.git')) return false;

      // Only include relevant extensions
      const ext = entry.path.split('.').pop();
      return ['tsx', 'ts', 'jsx', 'js', 'vue', 'svelte'].includes(ext || '');
    });

    if (filesInDir.length > 0) {
      context.push(`\n=== ${routeDir}/ ===`);
      for (const file of filesInDir) {
        const relativePath = file.path.replace(routeDir + '/', '');
        const indent = '  '.repeat(relativePath.split('/').length - 1);
        context.push(`${indent}${relativePath.split('/').pop()}`);
      }
    }
  }

  // Also include package.json for framework detection
  const packageJsonContent = await getFileContent(accessToken, owner, repo, 'package.json', branch);
  if (packageJsonContent) {
    try {
      const pkg = JSON.parse(packageJsonContent);
      context.push('\n=== package.json (dependencies) ===');
      context.push(
        JSON.stringify(
          {
            dependencies: Object.keys(pkg.dependencies || {}),
            devDependencies: Object.keys(pkg.devDependencies || {}),
          },
          null,
          2
        )
      );
    } catch {
      // Invalid JSON
    }
  }

  return context.join('\n');
}

export async function aiScanRoutes(
  repositoryId: string,
  branch: string
): Promise<{ success: boolean; routes?: DiscoveredRoute[]; error?: string }> {
  try {
    const account = await queries.getGithubAccount();
    if (!account) {
      return { success: false, error: 'GitHub account not connected' };
    }

    const repo = await queries.getRepository(repositoryId);
    if (!repo) {
      return { success: false, error: 'Repository not found' };
    }

    const config = await getAIConfig(repositoryId);
    const codebaseContext = await getCodebaseContext(
      account.accessToken,
      repo.owner,
      repo.name,
      branch
    );

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

export async function mcpExploreRoutes(
  repositoryId: string,
  baseURL: string
): Promise<{ success: boolean; routes?: DiscoveredRoute[]; error?: string }> {
  try {
    const config = await getAIConfig(repositoryId);

    // Get existing routes as seeds
    const existingRoutes = await queries.getRoutesByRepo(repositoryId);
    const existingPaths = existingRoutes.map((r) => r.path);

    const prompt = createMCPExploreRoutesPrompt(baseURL, existingPaths);
    const response = await generateWithAI(config, prompt, MCP_SYSTEM_PROMPT, {
      actionType: 'mcp_explore',
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
    const message = error instanceof Error ? error.message : 'Failed to explore routes';
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

    // Create routes with description
    const routeData = newRoutes.map((r) => ({
      repositoryId,
      path: r.path,
      type: r.type,
      description: r.description,
      scannedAt: new Date(),
    }));

    const createdRoutes = await queries.createRoutes(routeData);

    // Auto-create functional areas for each new route
    for (const route of createdRoutes) {
      const area = await queries.getOrCreateFunctionalAreaByRepo(
        repositoryId,
        route.path,
        `Auto-generated area for route ${route.path}`
      );
      await queries.linkRouteToFunctionalArea(route.id, area.id);
    }

    // Create test suggestions for each route
    const suggestionData: { routeId: string; suggestion: string }[] = [];
    for (let i = 0; i < newRoutes.length; i++) {
      const route = newRoutes[i];
      const createdRoute = createdRoutes[i];
      if (route.testSuggestions && route.testSuggestions.length > 0) {
        for (const suggestion of route.testSuggestions) {
          suggestionData.push({
            routeId: createdRoute.id,
            suggestion,
          });
        }
      }
    }

    if (suggestionData.length > 0) {
      await queries.createRouteTestSuggestions(suggestionData);
    }

    revalidatePath('/repo');
    revalidatePath('/tests');

    return { success: true, count: newRoutes.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save routes';
    return { success: false, error: message };
  }
}
