import type { AIProvider, AIProviderConfig } from './types';
import { ClaudeCLIProvider } from './claude-cli';
import { createOpenRouterProvider } from './openrouter';
import { createAIPromptLog } from '@/lib/db/queries';
import type { AIActionType, AILogStatus } from '@/lib/db/schema';

export * from './types';
export * from './prompts';

export function getAIProvider(config: AIProviderConfig): AIProvider {
  if (config.provider === 'openrouter') {
    if (!config.openrouterApiKey) {
      throw new Error('OpenRouter API key is required');
    }
    return createOpenRouterProvider({
      apiKey: config.openrouterApiKey,
      model: config.openrouterModel || 'anthropic/claude-sonnet-4',
    });
  }

  // Default to Claude CLI
  return new ClaudeCLIProvider();
}

export interface GenerateWithAIOptions {
  actionType?: AIActionType;
  repositoryId?: string | null;
}

export async function generateWithAI(
  config: AIProviderConfig,
  prompt: string,
  systemPrompt?: string,
  options?: GenerateWithAIOptions
): Promise<string> {
  const provider = getAIProvider(config);
  const startTime = Date.now();

  let finalSystemPrompt = systemPrompt || '';
  if (config.customInstructions) {
    finalSystemPrompt = finalSystemPrompt
      ? `${finalSystemPrompt}\n\nAdditional instructions:\n${config.customInstructions}`
      : config.customInstructions;
  }

  const { actionType, repositoryId } = options || {};

  try {
    const response = await provider.generate({
      prompt,
      systemPrompt: finalSystemPrompt || undefined,
    });

    // Log success
    if (repositoryId && actionType) {
      const durationMs = Date.now() - startTime;
      await createAIPromptLog({
        repositoryId,
        actionType,
        provider: config.provider,
        model: config.provider === 'openrouter' ? config.openrouterModel : undefined,
        systemPrompt: finalSystemPrompt || undefined,
        userPrompt: prompt,
        response,
        status: 'success' as AILogStatus,
        durationMs,
      });
    }

    return response;
  } catch (error) {
    // Log error
    if (repositoryId && actionType) {
      const durationMs = Date.now() - startTime;
      await createAIPromptLog({
        repositoryId,
        actionType,
        provider: config.provider,
        model: config.provider === 'openrouter' ? config.openrouterModel : undefined,
        systemPrompt: finalSystemPrompt || undefined,
        userPrompt: prompt,
        status: 'error' as AILogStatus,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs,
      });
    }
    throw error;
  }
}
