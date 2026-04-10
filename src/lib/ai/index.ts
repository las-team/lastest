import path from 'path';
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
      allowedTools: config.agentSdkAllowedTools,
      disallowedTools: config.agentSdkDisallowedTools,
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
  /** Run the MCP browser in headless mode (default: true) */
  mcpHeadless?: boolean;
  /** CDP endpoint to connect to an existing browser (e.g. embedded browser) */
  cdpEndpoint?: string;
  signal?: AbortSignal;
  /** Called with the prompt log ID after the log entry is created (before AI call) */
  onLogCreated?: (logId: string) => void;
}

export async function generateWithAI(
  config: AIProviderConfig,
  prompt: string,
  systemPrompt?: string,
  options?: GenerateWithAIOptions
): Promise<string> {
  // When MCP tools are needed and provider is claude-agent-sdk, inject the Playwright MCP server
  const effectiveConfig = { ...config };
  if (options?.useMCP) {
    console.log(`[generateWithAI] provider=${config.provider} cdpEndpoint=${options?.cdpEndpoint ?? 'none'} headless=${options?.mcpHeadless}`);
  }
  if (options?.useMCP && config.provider === 'claude-agent-sdk') {
    const playwrightCli = path.join(path.dirname(require.resolve('playwright')), 'cli.js');
    const mcpServerName = options?.cdpEndpoint ? 'playwright' : 'playwright-test';

    if (options?.cdpEndpoint) {
      console.log(`[generateWithAI] Using Browser MCP with CDP endpoint: ${options.cdpEndpoint}`);
      // Use Browser MCP server connected to an existing browser via CDP
      // Note: --headless prevents MCP from also opening a local headed browser
      effectiveConfig.agentSdkMcpServers = {
        ...effectiveConfig.agentSdkMcpServers,
        [mcpServerName]: {
          command: 'node',
          args: [
            playwrightCli,
            'run-mcp-server',
            '--cdp-endpoint', options.cdpEndpoint,
            '--headless',
          ],
        },
      };
    } else {
      console.log('[generateWithAI] Using Test MCP server (no CDP endpoint, launching own browser)');
      // Use Test MCP server with its own browser
      effectiveConfig.agentSdkMcpServers = {
        ...effectiveConfig.agentSdkMcpServers,
        [mcpServerName]: {
          command: 'node',
          args: [
            playwrightCli,
            'run-test-mcp-server',
            ...(options?.mcpHeadless !== false ? ['--headless'] : []),
          ],
        },
      };
    }
    // Auto-allow all Playwright MCP tools without prompting (respects user's permission mode)
    effectiveConfig.agentSdkAllowedTools = [
      ...(effectiveConfig.agentSdkAllowedTools || []),
      `mcp__${mcpServerName}__*`,
    ];
    // Disable non-MCP tools so the agent focuses on browser exploration, not shell commands
    effectiveConfig.agentSdkDisallowedTools = [
      ...(effectiveConfig.agentSdkDisallowedTools || []),
      'Bash', 'Write', 'Edit', 'NotebookEdit',
    ];
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
    options?.onLogCreated?.(logId);
  }

  try {
    const response = await provider.generate({
      prompt,
      systemPrompt: finalSystemPrompt || undefined,
      signal: options?.signal,
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
