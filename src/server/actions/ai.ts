'use server';

import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import {
  generateWithAI,
  SYSTEM_PROMPT,
  MCP_SYSTEM_PROMPT,
  createTestPrompt,
  createFixPrompt,
  createEnhancePrompt,
  extractCodeFromResponse,
} from '@/lib/ai';
import type { AIProviderConfig, TestGenerationContext, ScanContext, DiscoverySource, CodebaseIntelligenceContext } from '@/lib/ai/types';
import { revalidatePath } from 'next/cache';
import { getCurrentBranchForRepo } from '@/lib/git-utils';

async function getAIConfig(repositoryId?: string | null): Promise<AIProviderConfig> {
  const settings = await queries.getAISettings(repositoryId);
  return {
    provider: settings.provider as 'claude-cli' | 'openrouter' | 'claude-agent-sdk',
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || 'anthropic/claude-sonnet-4',
    customInstructions: settings.customInstructions,
    agentSdkPermissionMode: settings.agentSdkPermissionMode as 'plan' | 'default' | 'acceptEdits' | undefined,
    agentSdkModel: settings.agentSdkModel || undefined,
    agentSdkWorkingDir: settings.agentSdkWorkingDir || undefined,
  };
}

// Build ScanContext from route data
function buildScanContextFromRoute(
  route: queries.RouteWithContext,
  discoverySource: DiscoverySource = 'file-scan'
): ScanContext {
  return {
    discoverySource,
    sourceFilePath: route.filePath ?? undefined,
    framework: route.framework ?? undefined,
    routerType: route.routerType as 'hash' | 'browser' | undefined,
    specDescription: route.description ?? undefined,
    testSuggestions: route.testSuggestions.length > 0 ? route.testSuggestions : undefined,
    functionalAreaName: route.functionalAreaName ?? undefined,
    functionalAreaDescription: route.functionalAreaDescription ?? undefined,
  };
}

export async function aiCreateTestCore(
  repositoryId: string,
  context: TestGenerationContext,
  routeId?: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    // Enrich context with route information if routeId is provided
    const enrichedContext = { ...context };

    if (routeId) {
      const routeWithContext = await queries.getRouteWithContext(routeId);
      if (routeWithContext) {
        // Determine discovery source based on available data
        let discoverySource: DiscoverySource = 'file-scan';
        if (routeWithContext.description && routeWithContext.testSuggestions.length > 0) {
          discoverySource = 'spec-analysis';
        }

        enrichedContext.scanContext = buildScanContextFromRoute(routeWithContext, discoverySource);

        // Also set routePath if not already set
        if (!enrichedContext.routePath && !enrichedContext.targetUrl) {
          enrichedContext.routePath = routeWithContext.path;
        }

        // Set isDynamicRoute based on route type
        if (routeWithContext.type === 'dynamic') {
          enrichedContext.isDynamicRoute = true;
        }
      }
    }

    const config = await getAIConfig(repositoryId);
    const prompt = createTestPrompt(enrichedContext);
    const systemPrompt = enrichedContext.useMCP ? MCP_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const response = await generateWithAI(config, prompt, systemPrompt, {
      actionType: 'create_test',
      repositoryId,
      useMCP: enrichedContext.useMCP,
    });
    const code = extractCodeFromResponse(response);

    return { success: true, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate test';
    return { success: false, error: message };
  }
}

export async function aiCreateTest(
  repositoryId: string,
  context: TestGenerationContext,
  routeId?: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);
  return aiCreateTestCore(repositoryId, context, routeId);
}

export async function aiFixTest(
  repositoryId: string,
  testId: string,
  errorMessage: string,
  codebaseIntelligence?: CodebaseIntelligenceContext,
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);
  try {
    const test = await queries.getTest(testId);
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    const config = await getAIConfig(repositoryId);
    const prompt = createFixPrompt({
      existingCode: test.code,
      errorMessage,
      codebaseIntelligence,
    });
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      actionType: 'fix_test',
      repositoryId,
    });
    const code = extractCodeFromResponse(response);

    return { success: true, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fix test';
    return { success: false, error: message };
  }
}

export async function aiEnhanceTest(
  repositoryId: string,
  testId: string,
  userPrompt?: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);
  try {
    const test = await queries.getTest(testId);
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    const config = await getAIConfig(repositoryId);
    const prompt = createEnhancePrompt({
      existingCode: test.code,
      userPrompt,
    });
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      actionType: 'enhance_test',
      repositoryId,
    });
    const code = extractCodeFromResponse(response);

    return { success: true, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enhance test';
    return { success: false, error: message };
  }
}

export async function saveGeneratedTest(data: {
  repositoryId: string;
  functionalAreaId?: string;
  name: string;
  code: string;
  targetUrl?: string;
  description?: string;
}): Promise<{ success: boolean; testId?: string; error?: string }> {
  await requireRepoAccess(data.repositoryId);
  try {
    const test = await queries.createTest({
      repositoryId: data.repositoryId,
      functionalAreaId: data.functionalAreaId || null,
      name: data.name,
      code: data.code,
      targetUrl: data.targetUrl || null,
      description: data.description || null,
    });

    revalidatePath('/tests');

    return { success: true, testId: test.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save test';
    return { success: false, error: message };
  }
}

export async function aiFixAllFailedTests(
  repositoryId: string,
): Promise<{ success: boolean; fixed: number; failed: number; errors: string[] }> {
  await requireRepoAccess(repositoryId);
  const allTests = await queries.getTestsByRepo(repositoryId);
  const branch = await getCurrentBranchForRepo(repositoryId);
  const errors: string[] = [];
  let fixed = 0;
  let failed = 0;

  for (const test of allTests) {
    const results = await queries.getTestResultsByTest(test.id);
    const latestResult = results[results.length - 1];

    if (latestResult?.status !== 'failed') continue;

    const errorMessage = latestResult.errorMessage || 'Test failed with unknown error';
    const result = await aiFixTest(repositoryId, test.id, errorMessage);

    if (result.success && result.code) {
      await queries.updateTestWithVersion(test.id, { code: result.code }, 'ai_fix', branch ?? undefined);
      fixed++;
    } else {
      failed++;
      errors.push(`${test.name}: ${result.error || 'Unknown error'}`);
    }
  }

  revalidatePath('/tests');
  return { success: true, fixed, failed, errors };
}

export async function updateTestCode(
  testId: string,
  code: string,
  changeReason: 'ai_fix' | 'ai_enhance' = 'ai_fix'
): Promise<{ success: boolean; error?: string }> {
  await requireTeamAccess();
  try {
    const test = await queries.getTest(testId);
    const branch = await getCurrentBranchForRepo(test?.repositoryId);
    await queries.updateTestWithVersion(testId, { code }, changeReason, branch ?? undefined);
    revalidatePath('/tests');
    revalidatePath(`/tests/${testId}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update test';
    return { success: false, error: message };
  }
}

export async function aiFixTests(
  testIds: string[],
  repositoryId: string
): Promise<{ success: boolean; fixed: number; failed: number; errors: string[] }> {
  await requireRepoAccess(repositoryId);
  const branch = await getCurrentBranchForRepo(repositoryId);
  const errors: string[] = [];
  let fixed = 0;
  let failed = 0;

  for (const testId of testIds) {
    const test = await queries.getTest(testId);
    if (!test) {
      failed++;
      errors.push(`Test ${testId}: Not found`);
      continue;
    }

    const results = await queries.getTestResultsByTest(testId);
    const latestResult = results[results.length - 1];

    if (latestResult?.status !== 'failed') {
      continue;
    }

    const errorMessage = latestResult.errorMessage || 'Test failed with unknown error';
    const result = await aiFixTest(repositoryId, testId, errorMessage);

    if (result.success && result.code) {
      await queries.updateTestWithVersion(testId, { code: result.code }, 'ai_fix', branch ?? undefined);
      fixed++;
    } else {
      failed++;
      errors.push(`${test.name}: ${result.error || 'Unknown error'}`);
    }
  }

  revalidatePath('/tests');
  return { success: true, fixed, failed, errors };
}

/**
 * Unified fix: routes to PW Healer agent when enabled, falls back to prompt-based fix.
 */
export async function fixTest(
  repositoryId: string,
  testId: string,
  errorMessage: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  const settings = await queries.getAISettings(repositoryId);
  if (settings.pwAgentEnabled) {
    // Dynamic import to avoid circular deps / loading cost when not needed
    const { agentHealTest } = await import('@/lib/playwright/healer-agent');
    return agentHealTest(repositoryId, testId);
  }
  return aiFixTest(repositoryId, testId, errorMessage);
}

/**
 * Unified bulk fix: routes to PW Healer agent when enabled.
 */
export async function fixTests(
  testIds: string[],
  repositoryId: string
): Promise<{ success: boolean; fixed: number; failed: number; errors: string[] }> {
  const settings = await queries.getAISettings(repositoryId);
  if (settings.pwAgentEnabled) {
    const { agentHealTests } = await import('@/lib/playwright/healer-agent');
    return agentHealTests(testIds, repositoryId);
  }
  return aiFixTests(testIds, repositoryId);
}

/**
 * Unified create test: routes to PW Generator agent when enabled.
 */
export async function createTest(
  repositoryId: string,
  context: TestGenerationContext,
  routeId?: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  const settings = await queries.getAISettings(repositoryId);
  if (settings.pwAgentEnabled) {
    const { agentCreateTest } = await import('@/lib/playwright/generator-agent');
    return agentCreateTest(repositoryId, context);
  }
  return aiCreateTest(repositoryId, context, routeId);
}
