import type { AIProvider, AIProviderConfig } from './types';
import { ClaudeCLIProvider } from './claude-cli';
import { createOpenRouterProvider } from './openrouter';
import { createOllamaProvider } from './ollama';
import { ClaudeAgentSDKProvider } from './claude-agent-sdk';
import { createOpenAIProvider } from './openai';
import { createAnthropicDirectProvider } from './anthropic-direct';
import { createAIPromptLog, updateAIPromptLog } from '@/lib/db/queries';
import type { AIActionType, AILogStatus } from '@/lib/db/schema';

export * from './types';
export * from './prompts';
export { gatherCodebaseIntelligence } from './codebase-intelligence';
export type { CodebaseIntelligence, DependencyInsight } from './codebase-intelligence';

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

  if (config.provider === 'claude-agent-sdk') {
    return new ClaudeAgentSDKProvider({
      permissionMode: config.agentSdkPermissionMode,
      model: config.agentSdkModel || undefined,
      workingDirectory: config.agentSdkWorkingDir,
      mcpServers: config.agentSdkMcpServers,
    });
  }

  if (config.provider === 'ollama') {
    if (!config.ollamaModel) {
      throw new Error('Ollama model is required');
    }
    return createOllamaProvider({
      baseUrl: config.ollamaBaseUrl || 'http://localhost:11434',
      model: config.ollamaModel,
    });
  }

  if (config.provider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('OpenAI API key is required');
    }
    return createOpenAIProvider({
      apiKey: config.openaiApiKey,
      model: config.openaiModel || 'gpt-4o',
    });
  }

  if (config.provider === 'anthropic') {
    if (!config.anthropicApiKey) {
      throw new Error('Anthropic API key is required');
    }
    return createAnthropicDirectProvider({
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel || 'claude-sonnet-4-5-20250929',
    });
  }

  // Default to Claude CLI
  return new ClaudeCLIProvider();
}

export interface GenerateWithAIOptions {
  actionType?: AIActionType;
  repositoryId?: string | null;
  useMCP?: boolean;
}

export async function generateWithAI(
  config: AIProviderConfig,
  prompt: string,
  systemPrompt?: string,
  options?: GenerateWithAIOptions
): Promise<string> {
  // When MCP tools are needed and provider is claude-agent-sdk, inject the Playwright MCP server
  const effectiveConfig = { ...config };
  if (options?.useMCP && config.provider === 'claude-agent-sdk') {
    effectiveConfig.agentSdkMcpServers = {
      ...effectiveConfig.agentSdkMcpServers,
      'playwright-test': {
        command: 'npx',
        args: ['playwright', 'run-test-mcp-server'],
      },
    };
    // MCP agents need tool execution — override permission mode
    effectiveConfig.agentSdkPermissionMode = 'acceptEdits';
  }

  const provider = getAIProvider(effectiveConfig);
  const startTime = Date.now();

  let finalSystemPrompt = systemPrompt || '';
  if (config.customInstructions) {
    finalSystemPrompt = finalSystemPrompt
      ? `${finalSystemPrompt}\n\nAdditional instructions:\n${config.customInstructions}`
      : config.customInstructions;
  }

  const { actionType, repositoryId } = options || {};

  // Create pending log entry before the call
  let logId: string | undefined;
  if (repositoryId && actionType) {
    const log = await createAIPromptLog({
      repositoryId,
      actionType,
      provider: config.provider,
      model: config.provider === 'openrouter'
        ? config.openrouterModel
        : config.provider === 'ollama'
          ? config.ollamaModel
          : config.provider === 'openai'
            ? config.openaiModel
            : config.provider === 'anthropic'
              ? config.anthropicModel
              : undefined,
      systemPrompt: finalSystemPrompt || undefined,
      userPrompt: prompt,
      status: 'pending' as AILogStatus,
    });
    logId = log.id;
  }

  try {
    const response = await provider.generate({
      prompt,
      systemPrompt: finalSystemPrompt || undefined,
    });

    // Update log with success
    if (logId) {
      const durationMs = Date.now() - startTime;
      await updateAIPromptLog(logId, {
        status: 'success' as AILogStatus,
        response,
        durationMs,
      });
    }

    return response;
  } catch (error) {
    // Update log with error
    if (logId) {
      const durationMs = Date.now() - startTime;
      await updateAIPromptLog(logId, {
        status: 'error' as AILogStatus,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs,
      });
    }
    throw error;
  }
}
