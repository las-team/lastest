'use server';

import * as queries from '@/lib/db/queries';
import { generateWithAI, createRouteScanPrompt, createMCPExploreRoutesPrompt, createCodeDiffScanPrompt, SYSTEM_PROMPT, MCP_SYSTEM_PROMPT, ROUTE_SCAN_SYSTEM_PROMPT } from '@/lib/ai';
import type { AIProviderConfig, CodebaseIntelligenceContext } from '@/lib/ai/types';
import { revalidatePath } from 'next/cache';
import { getRepoTree, getFileContent, compareBranches } from '@/lib/github/content';
import { createJob, completeJob, failJob } from './jobs';
import { requireRepoAccess } from '@/lib/auth';

/** Extract first valid JSON array from text, handling nested brackets correctly */
function extractJsonArray(text: string): string | null {
  // 1. Try extracting from markdown code blocks first (```json ... ``` or ``` ... ```)
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const block = match[1].trim();
    if (block.startsWith('[')) {
      try {
        JSON.parse(block);
        return block;
      } catch { /* not valid JSON, try next block */ }
    }
  }

  // 2. Fallback: find first top-level [ and match its closing ]
  const start = text.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escape) { escape = false; continue; }
    if (char === '\\' && inString) { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (char === '[') depth++;
    else if (char === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/** Extract first valid JSON object from text, handling nested brackets correctly */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/** Group a flat array of routes (with optional functionalArea field) into DiscoveredArea[] */
function groupRoutesByArea(routes: (DiscoveredRoute & { functionalArea?: string })[]): DiscoveredArea[] {
  const areaMap = new Map<string, DiscoveredRoute[]>();
  for (const route of routes) {
    const areaName = route.functionalArea || 'Discovered Routes';
    if (!areaMap.has(areaName)) {
      areaMap.set(areaName, []);
    }
    // Strip functionalArea from the route object before storing
    const { functionalArea: _, ...routeData } = route;
    areaMap.get(areaName)!.push(routeData);
  }
  return Array.from(areaMap.entries()).map(([name, areaRoutes]) => ({
    name,
    routes: areaRoutes,
  }));
}

async function getAIConfig(repositoryId?: string | null): Promise<AIProviderConfig> {
  const settings = await queries.getAISettings(repositoryId);
  return {
    provider: settings.provider as 'claude-cli' | 'openrouter' | 'claude-agent-sdk',
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || 'anthropic/claude-sonnet-4',
    customInstructions: settings.customInstructions,
    agentSdkPermissionMode: settings.agentSdkPermissionMode as 'plan' | 'default' | 'acceptEdits' | undefined,
    agentSdkWorkingDir: settings.agentSdkWorkingDir || undefined,
  };
}

interface DiscoveredRoute {
  path: string;
  type: 'static' | 'dynamic';
  description?: string;
  testSuggestions?: string[];
}

export interface DiscoveredArea {
  name: string;
  description?: string;
  routes: DiscoveredRoute[];
}

// Read directory structure for AI context via GitHub API
interface CodebaseContextResult {
  context: string;
  hasRoutingDirs: boolean;
}

async function getCodebaseContext(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
  maxDepth = 3
): Promise<CodebaseContextResult> {
  const context: string[] = [];
  let hasRoutingDirs = false;

  // Fetch repo tree
  const repoTree = await getRepoTree(accessToken, owner, repo, branch);
  if (!repoTree || repoTree.tree.length === 0) {
    return { context: '', hasRoutingDirs: false };
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
      hasRoutingDirs = true;
      context.push(`\n=== ${routeDir}/ ===`);
      for (const file of filesInDir) {
        const relativePath = file.path.replace(routeDir + '/', '');
        context.push(`  ${relativePath}`);
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

  return { context: context.join('\n'), hasRoutingDirs };
}

export async function aiScanRoutes(
  repositoryId: string,
  branch: string,
  intelligence?: CodebaseIntelligenceContext,
): Promise<{ success: boolean; functionalAreas?: DiscoveredArea[]; error?: string }> {
  const { repo } = await requireRepoAccess(repositoryId);
  const jobId = await createJob('ai_scan', 'AI Route Scan', undefined, repositoryId);
  try {
    const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
    if (!account) {
      await failJob(jobId, 'GitHub account not connected');
      return { success: false, error: 'GitHub account not connected' };
    }

    const config = await getAIConfig(repositoryId);
    const { context: codebaseContext, hasRoutingDirs } = await getCodebaseContext(
      account.accessToken,
      repo.owner,
      repo.name,
      branch
    );

    if (!codebaseContext.trim()) {
      await failJob(jobId, 'Could not read codebase structure');
      return { success: false, error: 'Could not read codebase structure' };
    }

    // Guard: if no routing directories found (e.g. SPA, non-standard framework),
    // skip AI scan to prevent hallucinated routes from biasing downstream agents
    if (!hasRoutingDirs) {
      await completeJob(jobId);
      return { success: true, functionalAreas: [], error: 'No routing directories found in codebase — skipping AI route scan' };
    }

    const prompt = createRouteScanPrompt(codebaseContext, repo.fullName, intelligence);
    const response = await generateWithAI(config, prompt, ROUTE_SCAN_SYSTEM_PROMPT, {
      actionType: 'scan_routes',
      repositoryId,
    });

    // Parse JSON response - try object first (grouped or flat), fall back to flat array
    const objStr = extractJsonObject(response);
    if (objStr) {
      const parsed = JSON.parse(objStr);
      if (parsed.functionalAreas && Array.isArray(parsed.functionalAreas)) {
        await completeJob(jobId);
        return { success: true, functionalAreas: parsed.functionalAreas };
      }
      if (parsed.routes && Array.isArray(parsed.routes)) {
        await completeJob(jobId);
        return { success: true, functionalAreas: groupRoutesByArea(parsed.routes) };
      }
    }

    // Fallback: try flat array and wrap in a single area
    const arrStr = extractJsonArray(response);
    if (arrStr) {
      const routes: DiscoveredRoute[] = JSON.parse(arrStr);
      await completeJob(jobId);
      return { success: true, functionalAreas: [{ name: 'Discovered Routes', routes }] };
    }

    await failJob(jobId, 'AI did not return valid JSON');
    return { success: false, error: 'AI did not return valid JSON' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scan routes';
    await failJob(jobId, message);
    return { success: false, error: message };
  }
}

/**
 * Unified area discovery: routes to PW Planner agent when enabled,
 * falls back to AI scan or MCP explore.
 */
export async function discoverAreas(
  repositoryId: string,
  branch: string,
  baseURL?: string,
  intelligence?: CodebaseIntelligenceContext,
): Promise<{ success: boolean; functionalAreas?: DiscoveredArea[]; error?: string }> {
  if (baseURL) {
    const { agentDiscoverAreas } = await import('@/lib/playwright/planner-agent');
    return agentDiscoverAreas(repositoryId, baseURL);
  }
  return aiScanRoutes(repositoryId, branch, intelligence);
}

export async function mcpExploreRoutes(
  repositoryId: string,
  baseURL: string,
  intelligence?: CodebaseIntelligenceContext,
): Promise<{ success: boolean; functionalAreas?: DiscoveredArea[]; error?: string }> {
  await requireRepoAccess(repositoryId);
  try {
    const config = await getAIConfig(repositoryId);

    // Get existing routes as seeds
    const existingRoutes = await queries.getRoutesByRepo(repositoryId);
    const existingPaths = existingRoutes.map((r) => r.path);

    const prompt = createMCPExploreRoutesPrompt(baseURL, existingPaths, intelligence);
    const response = await generateWithAI(config, prompt, MCP_SYSTEM_PROMPT, {
      actionType: 'mcp_explore',
      repositoryId,
      useMCP: true,
    });

    // Parse JSON response - try object first (grouped or flat), fall back to flat array
    const objStr = extractJsonObject(response);
    if (objStr) {
      const parsed = JSON.parse(objStr);
      if (parsed.functionalAreas && Array.isArray(parsed.functionalAreas)) {
        return { success: true, functionalAreas: parsed.functionalAreas };
      }
      if (parsed.routes && Array.isArray(parsed.routes)) {
        return { success: true, functionalAreas: groupRoutesByArea(parsed.routes) };
      }
    }

    // Fallback: try flat array and wrap in a single area
    const arrStr = extractJsonArray(response);
    if (arrStr) {
      const routes: DiscoveredRoute[] = JSON.parse(arrStr);
      return { success: true, functionalAreas: [{ name: 'Discovered Routes', routes }] };
    }

    return { success: false, error: 'AI did not return valid JSON' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to explore routes';
    return { success: false, error: message };
  }
}

export interface SavedRouteInfo {
  path: string;
  routeId: string;
  areaId: string;
  areaName: string;
  testSuggestions: string[];
}

export async function saveDiscoveredRoutes(
  repositoryId: string,
  areas: DiscoveredArea[]
): Promise<{ success: boolean; count?: number; savedRoutes?: SavedRouteInfo[]; error?: string }> {
  await requireRepoAccess(repositoryId);
  try {
    // Get existing routes to avoid duplicates
    const existingRoutes = await queries.getRoutesByRepo(repositoryId);
    const existingPaths = new Set(existingRoutes.map((r) => r.path));

    const savedRoutes: SavedRouteInfo[] = [];
    const suggestionData: { routeId: string; suggestion: string }[] = [];
    let totalNew = 0;

    for (const area of areas) {
      // Filter out duplicate routes within this area
      const newRoutes = area.routes.filter((r) => !existingPaths.has(r.path));
      if (newRoutes.length === 0) continue;

      // Get or create the functional area with the AI-provided name
      const dbArea = await queries.getOrCreateFunctionalAreaByRepo(
        repositoryId,
        area.name,
        area.description
      );

      // Create routes with functionalAreaId set directly
      const routeData = newRoutes.map((r) => ({
        repositoryId,
        path: r.path,
        type: r.type,
        description: r.description,
        functionalAreaId: dbArea.id,
        scannedAt: new Date(),
      }));

      const createdRoutes = await queries.createRoutes(routeData);
      totalNew += createdRoutes.length;

      // Track created paths to avoid cross-area duplicates
      for (const r of newRoutes) {
        existingPaths.add(r.path);
      }

      for (let i = 0; i < createdRoutes.length; i++) {
        const createdRoute = createdRoutes[i];
        const originalRoute = newRoutes[i];
        savedRoutes.push({
          path: createdRoute.path,
          routeId: createdRoute.id,
          areaId: dbArea.id,
          areaName: dbArea.name,
          testSuggestions: originalRoute.testSuggestions || [],
        });

        if (originalRoute.testSuggestions && originalRoute.testSuggestions.length > 0) {
          for (const suggestion of originalRoute.testSuggestions) {
            suggestionData.push({ routeId: createdRoute.id, suggestion });
          }
        }
      }
    }

    if (totalNew === 0) {
      return { success: true, count: 0 };
    }

    if (suggestionData.length > 0) {
      await queries.createRouteTestSuggestions(suggestionData);
    }

    revalidatePath('/tests');

    return { success: true, count: totalNew, savedRoutes };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save routes';
    return { success: false, error: message };
  }
}

// --- Code Diff Scan ---

const IGNORED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'avif',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp4', 'mp3', 'wav', 'ogg', 'webm',
  'zip', 'tar', 'gz', 'br',
  'pdf', 'doc', 'docx',
  'lock', 'map',
]);

const IGNORED_PATHS = [
  'node_modules/', '.git/', 'dist/', 'build/', '.next/', 'coverage/',
  'public/screenshots/', 'public/baselines/', 'public/traces/',
  'storage/screenshots/', 'storage/baselines/', 'storage/traces/',
  '__snapshots__/', '.turbo/', '.cache/',
];

function filterRelevantSourceFiles(files: Array<{ filename: string; changes: number; status: string }>) {
  return files.filter((f) => {
    if (f.status === 'removed') return false;
    const ext = f.filename.split('.').pop()?.toLowerCase() || '';
    if (IGNORED_EXTENSIONS.has(ext)) return false;
    if (IGNORED_PATHS.some((p) => f.filename.startsWith(p) || f.filename.includes('/' + p))) return false;
    // Skip lock files by name
    if (f.filename.endsWith('-lock.json') || f.filename.endsWith('.lock') || f.filename === 'yarn.lock') return false;
    return true;
  });
}

async function buildChangedFilesContext(
  accessToken: string,
  owner: string,
  repo: string,
  headBranch: string,
  files: Array<{ filename: string; changes: number; status: string }>
): Promise<string> {
  // Sort by most changes, take top 20
  const sorted = [...files].sort((a, b) => b.changes - a.changes).slice(0, 20);
  const parts: string[] = [];

  for (const file of sorted) {
    const content = await getFileContent(accessToken, owner, repo, file.filename, headBranch);
    if (content) {
      const truncated = content.length > 5000 ? content.slice(0, 5000) + '\n... (truncated)' : content;
      parts.push(`=== ${file.filename} (${file.status}, +${file.changes} changes) ===\n${truncated}`);
    } else {
      parts.push(`=== ${file.filename} (${file.status}, +${file.changes} changes) ===\n[Could not fetch content]`);
    }
  }

  return parts.join('\n\n');
}

export async function scanBranchDiff(
  repositoryId: string
): Promise<{ success: boolean; functionalAreas?: DiscoveredArea[]; fileCount?: number; error?: string }> {
  const { repo } = await requireRepoAccess(repositoryId);
  const jobId = await createJob('ai_scan', 'Code Diff Scan', undefined, repositoryId);

  try {
    const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
    if (!account) {
      await failJob(jobId, 'GitHub account not connected');
      return { success: false, error: 'GitHub account not connected' };
    }

    const baseBranch = repo.defaultBranch || 'main';
    const headBranch = repo.selectedBranch || baseBranch;

    if (baseBranch === headBranch) {
      await failJob(jobId, 'Selected branch is the same as the default branch. Select a feature branch first.');
      return { success: false, error: 'Selected branch is the same as the default branch. Select a feature branch first.' };
    }

    const comparison = await compareBranches(account.accessToken, repo.owner, repo.name, baseBranch, headBranch);
    if (!comparison) {
      await failJob(jobId, 'Could not compare branches. Check that both branches exist.');
      return { success: false, error: 'Could not compare branches. Check that both branches exist.' };
    }

    const relevantFiles = filterRelevantSourceFiles(comparison.files);
    if (relevantFiles.length === 0) {
      await failJob(jobId, 'No relevant source files changed between branches');
      return { success: false, error: 'No relevant source files changed between branches' };
    }

    const context = await buildChangedFilesContext(
      account.accessToken,
      repo.owner,
      repo.name,
      headBranch,
      relevantFiles
    );

    const config = await getAIConfig(repositoryId);
    const prompt = createCodeDiffScanPrompt(context, baseBranch, headBranch, repo.fullName);
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      actionType: 'analyze_diff',
      repositoryId,
    });

    // Parse JSON response - try grouped object first, fall back to flat array
    const objStr = extractJsonObject(response);
    if (objStr) {
      const parsed = JSON.parse(objStr);
      if (parsed.functionalAreas && Array.isArray(parsed.functionalAreas)) {
        await completeJob(jobId);
        return { success: true, functionalAreas: parsed.functionalAreas, fileCount: relevantFiles.length };
      }
    }

    const arrStr = extractJsonArray(response);
    if (arrStr) {
      const routes: DiscoveredRoute[] = JSON.parse(arrStr);
      await completeJob(jobId);
      return { success: true, functionalAreas: [{ name: 'Changed Routes', routes }], fileCount: relevantFiles.length };
    }

    await failJob(jobId, 'AI did not return valid JSON');
    return { success: false, error: 'AI did not return valid JSON' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to analyze branch diff';
    await failJob(jobId, message);
    return { success: false, error: message };
  }
}
