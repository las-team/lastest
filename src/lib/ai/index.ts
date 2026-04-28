import path from 'path';
import type { AIProvider, AIProviderConfig, AIProviderType } from './types';
import { ClaudeCLIProvider } from './claude-cli';
import { createOpenRouterProvider } from './openrouter';
import { createOllamaProvider } from './ollama';
import { ClaudeAgentSDKProvider } from './claude-agent-sdk';
import { createOpenAIProvider } from './openai';
import { createAnthropicDirectProvider } from './anthropic-direct';
import { MCPBridge, createPlaywrightMCPBridge } from './mcp-bridge';
import type { MCPServerConfig } from './mcp-bridge';
import { createAIPromptLog, updateAIPromptLog } from '@/lib/db/queries';
import type { AIActionType, AILogStatus } from '@/lib/db/schema';

export * from './types';
export * from './prompts';
export { gatherCodebaseIntelligence } from './codebase-intelligence';
export type { CodebaseIntelligence, DependencyInsight } from './codebase-intelligence';

/** Providers that support tool/function calling via their API */
const TOOL_CALLING_PROVIDERS: AIProviderType[] = ['openrouter', 'openai', 'anthropic'];

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
      strictMcpConfig: config.agentSdkStrictMcpConfig,
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
  /** When true, enables MCP tool calling. For claude-agent-sdk this uses native MCP;
   *  for other tool-calling providers (openrouter, openai, anthropic) it uses the MCP bridge. */
  useMCP?: boolean;
  /** MCP configuration for non-SDK providers. When omitted, defaults to Playwright MCP (headless). */
  mcpConfig?: {
    /** Custom MCP servers to spawn (key = server name) */
    servers?: Record<string, MCPServerConfig>;
    /** CDP endpoint for Playwright MCP (e.g. from embedded browser) */
    cdpEndpoint?: string;
  };
  signal?: AbortSignal;
  /** Called with the prompt log ID after the log entry is created (before AI call) */
  onLogCreated?: (logId: string) => void;
  /** Request structured JSON output. Forwarded to providers that support
   *  `response_format: { type: 'json_object' }` (OpenRouter, OpenAI). Ignored elsewhere. */
  responseFormat?: 'json_object';
}

export async function generateWithAI(
  config: AIProviderConfig,
  prompt: string,
  systemPrompt?: string,
  options?: GenerateWithAIOptions
): Promise<string> {
  // When MCP tools are needed and provider is claude-agent-sdk, inject the Playwright MCP server
  // Note: generator-agent.ts configures MCP servers directly on config for CDP support.
  // This fallback handles other callers that pass useMCP: true (planner, healer, ai-routes, etc.)
  const effectiveConfig = { ...config };
  if (options?.useMCP && config.provider === 'claude-agent-sdk') {
    const playwrightCli = path.join(path.dirname(require.resolve('playwright')), 'cli.js');
    effectiveConfig.agentSdkMcpServers = {
      ...effectiveConfig.agentSdkMcpServers,
      'playwright-test': {
        command: 'node',
        args: [
          playwrightCli,
          'run-test-mcp-server',
          '--headless',
        ],
      },
    };
    effectiveConfig.agentSdkAllowedTools = [
      ...(effectiveConfig.agentSdkAllowedTools || []),
      'mcp__playwright-test__*',
    ];
    effectiveConfig.agentSdkDisallowedTools = [
      ...(effectiveConfig.agentSdkDisallowedTools || []),
      'Bash', 'Write', 'Edit', 'NotebookEdit',
    ];
  }

  // For non-SDK providers with tool calling support, use MCP bridge
  const useToolCallingBridge = options?.useMCP
    && config.provider !== 'claude-agent-sdk'
    && TOOL_CALLING_PROVIDERS.includes(config.provider);

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
    let response: string;

    if (useToolCallingBridge && provider.generateWithTools) {
      // MCP bridge path: spawn MCP server, list tools, run agentic tool-calling loop
      response = await generateWithMCPBridge(provider, {
        prompt,
        systemPrompt: finalSystemPrompt || undefined,
        signal: options?.signal,
        cdpEndpoint: options?.mcpConfig?.cdpEndpoint,
        customServers: options?.mcpConfig?.servers,
        responseFormat: options?.responseFormat,
      });
    } else {
      response = await provider.generate({
        prompt,
        systemPrompt: finalSystemPrompt || undefined,
        signal: options?.signal,
        responseFormat: options?.responseFormat,
      });
    }

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

/**
 * Run an AI provider through the MCP bridge: spawn MCP server(s), list their
 * tools, then use the provider's generateWithTools() for the agentic loop.
 */
async function generateWithMCPBridge(
  provider: AIProvider,
  options: {
    prompt: string;
    systemPrompt?: string;
    signal?: AbortSignal;
    cdpEndpoint?: string;
    customServers?: Record<string, MCPServerConfig>;
    responseFormat?: 'json_object';
  },
): Promise<string> {
  if (!provider.generateWithTools) {
    throw new Error('Provider does not support tool calling');
  }

  // Determine which MCP bridges to create
  const bridges: MCPBridge[] = [];

  if (options.customServers) {
    // Custom MCP server configs (e.g. from generator-agent)
    for (const config of Object.values(options.customServers)) {
      bridges.push(new MCPBridge(config));
    }
  } else {
    // Default: Playwright MCP
    bridges.push(createPlaywrightMCPBridge({
      cdpEndpoint: options.cdpEndpoint,
      headless: true,
    }));
  }

  try {
    // Connect all bridges and collect tools
    await Promise.all(bridges.map(b => b.connect()));
    const allTools = (await Promise.all(bridges.map(b => b.listTools()))).flat();

    if (allTools.length === 0) {
      throw new Error('MCP bridge: no tools available from MCP server(s)');
    }

    // Build a lookup for routing tool calls to the right bridge
    const toolToBridge = new Map<string, MCPBridge>();
    for (let i = 0; i < bridges.length; i++) {
      const tools = await bridges[i].listTools();
      for (const tool of tools) {
        toolToBridge.set(tool.name, bridges[i]);
      }
    }

    return await provider.generateWithTools({
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      signal: options.signal,
      responseFormat: options.responseFormat,
      tools: allTools,
      onToolCall: async (call) => {
        const bridge = toolToBridge.get(call.name);
        if (!bridge) {
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
        }
        return bridge.callTool(call);
      },
    });
  } finally {
    // Always clean up MCP subprocesses
    await Promise.all(bridges.map(b => b.close().catch(() => {})));
  }
}
