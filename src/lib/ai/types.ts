export type AIProviderType = 'claude-cli' | 'openrouter' | 'claude-agent-sdk' | 'ollama' | 'openai' | 'anthropic';

export interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  images?: { base64: string; mediaType: string }[];
  signal?: AbortSignal;
  /** Request structured JSON output. Forwarded as `response_format: { type: 'json_object' }`
   *  to providers that support it (OpenRouter, OpenAI). Other providers ignore it. */
  responseFormat?: 'json_object';
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

export interface AIProvider {
  generate(options: GenerateOptions): Promise<string>;
  generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void>;
  generateWithTools?(options: GenerateWithToolsOptions): Promise<string>;
}

// ---------------------------------------------------------------------------
// Tool calling types (used by MCP bridge + providers that support function calling)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface GenerateWithToolsOptions extends GenerateOptions {
  tools: ToolDefinition[];
  maxToolRounds?: number;
  onToolCall: (call: ToolCall) => Promise<ToolResult>;
}

export interface AIProviderConfig {
  provider: AIProviderType;
  openrouterApiKey?: string | null;
  openrouterModel?: string;
  customInstructions?: string | null;
  agentSdkPermissionMode?: 'plan' | 'default' | 'acceptEdits';
  agentSdkModel?: string;
  agentSdkWorkingDir?: string;
  agentSdkMcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  agentSdkStrictMcpConfig?: boolean;
  agentSdkAllowedTools?: string[];
  agentSdkDisallowedTools?: string[];
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  anthropicApiKey?: string | null;
  anthropicModel?: string;
  openaiApiKey?: string | null;
  openaiModel?: string;
}

export type DiscoverySource = 'file-scan' | 'nav-link' | 'mcp-explore' | 'manual';

export interface ScanContext {
  discoverySource: DiscoverySource;
  sourceFilePath?: string;
  framework?: string;
  routerType?: 'hash' | 'browser';
  navLabel?: string;
  navSourceFile?: string;
  specDescription?: string;
  testSuggestions?: string[];
  functionalAreaName?: string;
  functionalAreaPlan?: string;
}

export interface CodebaseIntelligenceContext {
  framework?: string;
  cssFramework?: string;
  selectorStrategy?: string;
  authMechanism?: string;
  projectDescription?: string;
  testingRecommendations?: string[];
  stateManagement?: string;
  apiLayer?: string;
}

export interface TestGenerationContext {
  targetUrl?: string;
  routePath?: string;
  existingCode?: string;
  errorMessage?: string;
  userPrompt?: string;
  useMCP?: boolean;
  isDynamicRoute?: boolean;
  siblingRoutes?: string[];
  scanContext?: ScanContext;
  codebaseIntelligence?: CodebaseIntelligenceContext;
  availableRoutes?: string[];
  functionalAreaId?: string;
  testName?: string;
  baseUrl?: string;
}

export interface GeneratedTest {
  code: string;
  name?: string;
  description?: string;
}
