'use server';

import * as queries from '@/lib/db/queries';
import {
  generateWithAI,
  SYSTEM_PROMPT,
  createTestPrompt,
  createFixPrompt,
  createEnhancePrompt,
  extractCodeFromResponse,
} from '@/lib/ai';
import type { AIProviderConfig, TestGenerationContext } from '@/lib/ai/types';
import { revalidatePath } from 'next/cache';

async function getAIConfig(repositoryId?: string | null): Promise<AIProviderConfig> {
  const settings = await queries.getAISettings(repositoryId);
  return {
    provider: settings.provider as 'claude-cli' | 'openrouter',
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || 'anthropic/claude-sonnet-4',
    customInstructions: settings.customInstructions,
  };
}

export async function aiCreateTest(
  repositoryId: string,
  context: TestGenerationContext
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const config = await getAIConfig(repositoryId);
    const prompt = createTestPrompt(context);
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT);
    const code = extractCodeFromResponse(response);

    return { success: true, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate test';
    return { success: false, error: message };
  }
}

export async function aiFixTest(
  repositoryId: string,
  testId: string,
  errorMessage: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const test = await queries.getTest(testId);
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    const config = await getAIConfig(repositoryId);
    const prompt = createFixPrompt({
      existingCode: test.code,
      errorMessage,
    });
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT);
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
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT);
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
  pathType?: string;
}): Promise<{ success: boolean; testId?: string; error?: string }> {
  try {
    const test = await queries.createTest({
      repositoryId: data.repositoryId,
      functionalAreaId: data.functionalAreaId || null,
      name: data.name,
      code: data.code,
      targetUrl: data.targetUrl || null,
      pathType: data.pathType || 'happy',
    });

    revalidatePath('/tests');

    return { success: true, testId: test.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save test';
    return { success: false, error: message };
  }
}

export async function updateTestCode(
  testId: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await queries.updateTest(testId, { code });
    revalidatePath('/tests');
    revalidatePath(`/tests/${testId}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update test';
    return { success: false, error: message };
  }
}
