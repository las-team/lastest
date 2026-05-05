'use server';

import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import type { AIProvider, AgentSdkPermissionMode } from '@/lib/db/schema';
import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return '••••••••';
  return '••••••••' + value.slice(-4);
}

export async function getAISettings(repositoryId?: string | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  const settings = await queries.getAISettings(repositoryId);
  return {
    ...settings,
    openrouterApiKey: maskSecret(settings.openrouterApiKey),
    aiDiffingApiKey: maskSecret(settings.aiDiffingApiKey),
    anthropicApiKey: maskSecret(settings.anthropicApiKey),
    openaiApiKey: maskSecret(settings.openaiApiKey),
    _hasOpenrouterKey: !!settings.openrouterApiKey,
    _hasAiDiffingKey: !!settings.aiDiffingApiKey,
    _hasAnthropicKey: !!settings.anthropicApiKey,
    _hasOpenaiKey: !!settings.openaiApiKey,
  };
}

export async function getAISettingsRaw(repositoryId?: string | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  return queries.getAISettings(repositoryId);
}

function isMaskedValue(value: string | null | undefined): boolean {
  return !!value && value.startsWith('••••••••');
}

export async function saveAISettings(data: {
  repositoryId?: string | null;
  provider?: AIProvider;
  openrouterApiKey?: string | null;
  openrouterModel?: string;
  agentSdkPermissionMode?: AgentSdkPermissionMode;
  agentSdkModel?: string | null;
  agentSdkWorkingDir?: string | null;
  ollamaBaseUrl?: string | null;
  ollamaModel?: string | null;
  customInstructions?: string | null;
  aiDiffingEnabled?: boolean;
  aiDiffingProvider?: string | null;
  aiDiffingApiKey?: string | null;
  aiDiffingModel?: string | null;
  aiDiffingOllamaBaseUrl?: string | null;
  aiDiffingOllamaModel?: string | null;
  anthropicApiKey?: string | null;
  anthropicModel?: string | null;
  openaiApiKey?: string | null;
  openaiModel?: string | null;
  pwAgentModel?: string | null;
  pwAgentTimeout?: number;
}) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  const { repositoryId, ...settingsData } = data;

  // Don't overwrite real keys with masked placeholders
  if (isMaskedValue(settingsData.openrouterApiKey)) delete settingsData.openrouterApiKey;
  if (isMaskedValue(settingsData.aiDiffingApiKey)) delete settingsData.aiDiffingApiKey;
  if (isMaskedValue(settingsData.anthropicApiKey)) delete settingsData.anthropicApiKey;
  if (isMaskedValue(settingsData.openaiApiKey)) delete settingsData.openaiApiKey;

  await queries.upsertAISettings(repositoryId || null, settingsData);

  revalidatePath('/settings');

  return { success: true };
}

export async function resetAISettings(repositoryId?: string | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  const settings = await queries.getAISettings(repositoryId);

  if (settings.id) {
    await queries.deleteAISettings(settings.id);
  }

  revalidatePath('/settings');

  return { success: true };
}

export async function testAIConnection(
  provider: AIProvider,
  apiKey?: string,
  permissionMode?: AgentSdkPermissionMode,
  ollamaBaseUrl?: string,
  ollamaModel?: string,
  anthropicApiKey?: string,
  openaiApiKey?: string
): Promise<{
  success: boolean;
  message: string;
}> {
  await requireTeamAccess();
  try {
    if (provider === 'claude-cli') {
      // Test claude CLI by running a simple command
      // Use shell: true and set PATH to include common locations for claude
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      const extendedPath = `${homeDir}/.local/bin:${process.env.PATH}`;

      const { stdout, stderr } = await execAsync('claude -p "Say hello in one word" < /dev/null', {
        timeout: 30000,
        shell: '/bin/bash',
        env: { ...process.env, PATH: extendedPath },
      });

      if (stderr && stderr.includes('error')) {
        return { success: false, message: stderr.trim() };
      }

      if (stdout && stdout.trim().length > 0) {
        return { success: true, message: 'Claude CLI connected successfully' };
      }
      return { success: false, message: 'Claude CLI returned empty response' };
    } else if (provider === 'openrouter') {
      if (!apiKey) {
        return { success: false, message: 'API key is required for OpenRouter' };
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-sonnet-4',
          messages: [{ role: 'user', content: 'Say hello in one word' }],
          max_tokens: 10,
        }),
      });

      if (response.ok) {
        return { success: true, message: 'OpenRouter API connected successfully' };
      }

      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      return { success: false, message: error.error?.message || 'OpenRouter connection failed' };
    } else if (provider === 'claude-agent-sdk') {
      // Test Claude Agent SDK by importing and running a simple query
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      const mode = permissionMode || 'plan';
      let result = '';

      for await (const message of query({
        prompt: 'Say hello in one word',
        options: {
          permissionMode: mode,
        },
      })) {
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              result += block.text;
            }
          }
        }
        if (message.type === 'result' && message.subtype === 'success' && message.result) {
          result += message.result;
        }
      }

      if (result.trim().length > 0) {
        return { success: true, message: 'Claude Agent SDK connected successfully' };
      }
      return { success: false, message: 'Claude Agent SDK returned empty response' };
    } else if (provider === 'ollama') {
      if (!ollamaModel) {
        return { success: false, message: 'Model name is required for Ollama' };
      }

      const baseUrl = ollamaBaseUrl || 'http://localhost:11434';

      try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: ollamaModel,
            messages: [{ role: 'user', content: 'Say hello in one word' }],
            max_tokens: 10,
          }),
        });

        if (response.ok) {
          return { success: true, message: `Ollama connected successfully (${ollamaModel})` };
        }

        const error = await response.json().catch(() => ({
          error: { message: response.statusText }
        }));
        return {
          success: false,
          message: error.error?.message || 'Ollama connection failed. Is the server running?'
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error
            ? error.message
            : 'Cannot reach Ollama server. Is it running on the configured URL?'
        };
      }
    } else if (provider === 'anthropic') {
      const key = anthropicApiKey || apiKey;
      if (!key) {
        return { success: false, message: 'API key is required for Anthropic' };
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say hello in one word' }],
        }),
      });

      if (response.ok) {
        return { success: true, message: 'Anthropic API connected successfully' };
      }

      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      return { success: false, message: error.error?.message || 'Anthropic connection failed' };
    } else if (provider === 'openai') {
      const key = openaiApiKey || apiKey;
      if (!key) {
        return { success: false, message: 'API key is required for OpenAI' };
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Say hello in one word' }],
          max_tokens: 10,
        }),
      });

      if (response.ok) {
        return { success: true, message: 'OpenAI API connected successfully' };
      }

      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      return { success: false, message: error.error?.message || 'OpenAI connection failed' };
    }

    return { success: false, message: 'Unknown provider' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection test failed';
    return { success: false, message };
  }
}
