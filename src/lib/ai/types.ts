export type AIProviderType = 'claude-cli' | 'openrouter' | 'claude-agent-sdk' | 'ollama';

export interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  images?: { base64: string; mediaType: string }[];
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

export interface AIProvider {
  generate(options: GenerateOptions): Promise<string>;
  generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void>;
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
  ollamaBaseUrl?: string;
  ollamaModel?: string;
}

export type DiscoverySource = 'file-scan' | 'nav-link' | 'spec-analysis' | 'mcp-explore' | 'manual';

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
  functionalAreaDescription?: string;
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
}

export interface GeneratedTest {
  code: string;
  name?: string;
  description?: string;
}
