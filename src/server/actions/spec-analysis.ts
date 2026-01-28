'use server';

import * as queries from '@/lib/db/queries';
import { generateWithAI, createSpecAnalysisPrompt, createTestPrompt, extractCodeFromResponse, SYSTEM_PROMPT } from '@/lib/ai';
import type { AIProviderConfig } from '@/lib/ai/types';
import { revalidatePath } from 'next/cache';
import { getRepoTree, getFileContent } from '@/lib/github/content';
import { extractTextFromFile } from '@/lib/file-parser';
import { createJob, updateJobProgress, completeJob, failJob } from './jobs';

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

const SPEC_PATTERNS = ['docs/', 'specs/', 'specifications/', 'requirements/'];
const SPEC_FILES = ['README.md', 'SPEC.md', 'PRD.md', 'SPECIFICATION.md'];

interface SpecAnalysisRoute {
  path: string;
  type: 'static' | 'dynamic';
  description?: string;
}

interface SpecAnalysisArea {
  name: string;
  description?: string;
  routes: SpecAnalysisRoute[];
}

interface SpecAnalysisResult {
  functionalAreas: SpecAnalysisArea[];
  testScenarios: { route: string; suggestions: string[] }[];
}

export interface SpecAnalysisResponse {
  success: boolean;
  result?: SpecAnalysisResult;
  error?: string;
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

function isSpecFile(path: string): boolean {
  const lower = path.toLowerCase();
  // Check known spec file names
  if (SPEC_FILES.some(f => lower === f.toLowerCase())) return true;
  // Check if in spec directories with .md or .txt extension
  if (SPEC_PATTERNS.some(p => lower.startsWith(p))) {
    return lower.endsWith('.md') || lower.endsWith('.txt');
  }
  return false;
}

export async function scanRepoSpecs(
  repositoryId: string,
  branch: string
): Promise<SpecAnalysisResponse> {
  const jobId = await createJob('spec_analysis', 'Scan Repo Specs', undefined, repositoryId);
  try {
    const account = await queries.getGithubAccount();
    if (!account) {
      await failJob(jobId, 'GitHub account not connected');
      return { success: false, error: 'GitHub account not connected' };
    }

    const repo = await queries.getRepository(repositoryId);
    if (!repo) {
      await failJob(jobId, 'Repository not found');
      return { success: false, error: 'Repository not found' };
    }

    // Get repo tree and find spec files
    const repoTree = await getRepoTree(account.accessToken, repo.owner, repo.name, branch);
    if (!repoTree || repoTree.tree.length === 0) {
      await failJob(jobId, 'Could not read repository tree');
      return { success: false, error: 'Could not read repository tree' };
    }

    const specEntries = repoTree.tree.filter(
      entry => entry.type === 'blob' && isSpecFile(entry.path)
    );

    if (specEntries.length === 0) {
      await failJob(jobId, 'No specification files found in repository');
      return { success: false, error: 'No specification files found in repository' };
    }

    // Fetch content of spec files (limit to 10 to avoid token overflow)
    const filesToFetch = specEntries.slice(0, 10);
    const contents: string[] = [];

    for (let i = 0; i < filesToFetch.length; i++) {
      const entry = filesToFetch[i];
      const content = await getFileContent(account.accessToken, repo.owner, repo.name, entry.path, branch);
      if (content) {
        contents.push(`--- ${entry.path} ---\n${content}`);
      }
      await updateJobProgress(jobId, i + 1, filesToFetch.length);
    }

    if (contents.length === 0) {
      await failJob(jobId, 'Could not read any specification files');
      return { success: false, error: 'Could not read any specification files' };
    }

    const specContent = contents.join('\n\n');
    const result = await analyzeSpecContent(specContent, repositoryId);
    if (result.success) {
      await completeJob(jobId);
    } else {
      await failJob(jobId, result.error || 'Analysis failed');
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scan specs';
    await failJob(jobId, message);
    return { success: false, error: message };
  }
}

export async function analyzeUploadedSpecs(
  formData: FormData,
  repositoryId: string
): Promise<SpecAnalysisResponse> {
  const jobId = await createJob('spec_analysis', 'Analyze Uploaded Specs', undefined, repositoryId);
  try {
    const files = formData.getAll('files') as File[];
    if (files.length === 0) {
      await failJob(jobId, 'No files uploaded');
      return { success: false, error: 'No files uploaded' };
    }

    const contents: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const text = await extractTextFromFile(file);
      if (text.trim()) {
        contents.push(`--- ${file.name} ---\n${text}`);
      }
      await updateJobProgress(jobId, i + 1, files.length);
    }

    if (contents.length === 0) {
      await failJob(jobId, 'Could not extract text from uploaded files');
      return { success: false, error: 'Could not extract text from uploaded files' };
    }

    const specContent = contents.join('\n\n');
    const result = await analyzeSpecContent(specContent, repositoryId);
    if (result.success) {
      await completeJob(jobId);
    } else {
      await failJob(jobId, result.error || 'Analysis failed');
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to analyze uploaded specs';
    await failJob(jobId, message);
    return { success: false, error: message };
  }
}

async function analyzeSpecContent(
  specContent: string,
  repositoryId: string
): Promise<SpecAnalysisResponse> {
  const config = await getAIConfig(repositoryId);
  const prompt = createSpecAnalysisPrompt(specContent);
  const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
    actionType: 'analyze_specs',
    repositoryId,
  });

  // Parse JSON response - extract first valid JSON object
  const jsonStr = extractJsonObject(response);
  if (!jsonStr) {
    return { success: false, error: 'AI did not return valid JSON' };
  }

  const result: SpecAnalysisResult = JSON.parse(jsonStr);
  return { success: true, result };
}

export async function saveSpecAnalysisResult(
  repositoryId: string,
  result: SpecAnalysisResult
): Promise<{ success: boolean; error?: string }> {
  try {
    const existingRoutes = await queries.getRoutesByRepo(repositoryId);
    const existingPaths = new Set(existingRoutes.map(r => r.path));

    for (const area of result.functionalAreas) {
      // Create or get functional area
      const functionalArea = await queries.getOrCreateFunctionalAreaByRepo(
        repositoryId,
        area.name,
        area.description
      );

      // Create routes for this area
      for (const route of area.routes) {
        if (existingPaths.has(route.path)) continue;

        const createdRoutes = await queries.createRoutes([{
          repositoryId,
          path: route.path,
          type: route.type,
          description: route.description,
          functionalAreaId: functionalArea.id,
          scannedAt: new Date(),
        }]);

        if (createdRoutes.length > 0) {
          existingPaths.add(route.path);

          // Find test scenarios for this route
          const scenarios = result.testScenarios.find(s => s.route === route.path);
          if (scenarios && scenarios.suggestions.length > 0) {
            await queries.createRouteTestSuggestions(
              scenarios.suggestions.map(suggestion => ({
                routeId: createdRoutes[0].id,
                suggestion,
              }))
            );
          }
        }
      }
    }

    revalidatePath('/repo');
    revalidatePath('/tests');

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save results';
    return { success: false, error: message };
  }
}

export async function saveAndBuildTests(
  repositoryId: string,
  result: SpecAnalysisResult
): Promise<{ success: boolean; testsCreated: number; error?: string }> {
  const totalRoutes = result.functionalAreas.reduce((sum, a) => sum + a.routes.length, 0);
  const jobId = await createJob('build_tests', 'Building Tests from Specs', totalRoutes, repositoryId);
  try {
    // First save the areas/routes
    const saveResult = await saveSpecAnalysisResult(repositoryId, result);
    if (!saveResult.success) {
      await failJob(jobId, saveResult.error || 'Failed to save results');
      return { success: false, testsCreated: 0, error: saveResult.error };
    }

    const config = await getAIConfig(repositoryId);
    let testsCreated = 0;
    let routeIndex = 0;

    // Generate tests for each route
    for (const area of result.functionalAreas) {
      const functionalArea = await queries.getOrCreateFunctionalAreaByRepo(
        repositoryId,
        area.name,
        area.description
      );

      for (const route of area.routes) {
        routeIndex++;
        await updateJobProgress(jobId, routeIndex, totalRoutes);

        const scenarios = result.testScenarios.find(s => s.route === route.path);
        const testDescription = scenarios?.suggestions?.[0] || `Visual test for ${route.path}`;

        const prompt = createTestPrompt({
          routePath: route.path,
          isDynamicRoute: route.type === 'dynamic',
          userPrompt: testDescription,
        });

        try {
          const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
            actionType: 'create_test',
            repositoryId,
          });
          const code = extractCodeFromResponse(response);

          if (code) {
            await queries.createTest({
              repositoryId,
              functionalAreaId: functionalArea.id,
              name: `${area.name}: ${route.path}`,
              code,
              targetUrl: route.path,
            });
            testsCreated++;
          }
        } catch {
          // Continue generating other tests if one fails
        }
      }
    }

    await completeJob(jobId);
    revalidatePath('/tests');
    return { success: true, testsCreated };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build tests';
    await failJob(jobId, message);
    return { success: false, testsCreated: 0, error: message };
  }
}
