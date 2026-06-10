/**
 * Single source of truth for mapping persisted AI settings → AIProviderConfig.
 * Previously copy-pasted across failure-triage, app-fix-advisor and the
 * api-test generator; centralized here so provider/field changes land once.
 */

import type { AIProviderConfig } from './types';

/** The subset of `getAISettings()` output this mapping reads. */
export interface AISettingsLike {
  provider: string;
  openrouterApiKey?: string | null;
  openrouterModel?: string | null;
  anthropicApiKey?: string | null;
  anthropicModel?: string | null;
  ollamaBaseUrl?: string | null;
  ollamaModel?: string | null;
  openaiApiKey?: string | null;
  openaiModel?: string | null;
}

export function aiConfigFromSettings(
  settings: AISettingsLike,
  opts?: { readOnly?: boolean },
): AIProviderConfig {
  const config: AIProviderConfig = {
    provider: settings.provider as AIProviderConfig['provider'],
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel ?? undefined,
    anthropicApiKey: settings.anthropicApiKey,
    anthropicModel: settings.anthropicModel ?? undefined,
    ollamaBaseUrl: settings.ollamaBaseUrl ?? undefined,
    ollamaModel: settings.ollamaModel ?? undefined,
    openaiApiKey: settings.openaiApiKey,
    openaiModel: settings.openaiModel ?? undefined,
  };
  // Read-only callers (advisors/generators that must never touch the
  // filesystem) force plan mode and disallow file-mutating agent-SDK tools.
  if (opts?.readOnly) {
    config.agentSdkPermissionMode = 'plan';
    config.agentSdkDisallowedTools = ['Bash', 'Write', 'Edit', 'NotebookEdit'];
  }
  return config;
}

/** Stable `provider:model` identifier for logging/attribution. */
export function aiModelId(config: AIProviderConfig): string {
  switch (config.provider) {
    case 'openrouter': return `openrouter:${config.openrouterModel ?? 'default'}`;
    case 'anthropic': return `anthropic:${config.anthropicModel ?? 'default'}`;
    case 'openai': return `openai:${config.openaiModel ?? 'default'}`;
    case 'ollama': return `ollama:${config.ollamaModel ?? 'default'}`;
    default: return config.provider;
  }
}
