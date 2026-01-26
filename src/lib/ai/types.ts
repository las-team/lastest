export type AIProviderType = 'claude-cli' | 'openrouter' | 'claude-agent-sdk';

export interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
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
  agentSdkWorkingDir?: string;
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
}

export interface GeneratedTest {
  code: string;
  name?: string;
  description?: string;
}
