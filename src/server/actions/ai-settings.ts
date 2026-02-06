'use server';

import * as queries from '@/lib/db/queries';
import type { AIProvider, AgentSdkPermissionMode } from '@/lib/db/schema';
import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function getAISettings(repositoryId?: string | null) {
  return queries.getAISettings(repositoryId);
}

export async function saveAISettings(data: {
  repositoryId?: string | null;
  provider?: AIProvider;
  openrouterApiKey?: string | null;
  openrouterModel?: string;
  agentSdkPermissionMode?: AgentSdkPermissionMode;
  agentSdkWorkingDir?: string | null;
  customInstructions?: string | null;
  aiDiffingEnabled?: boolean;
  aiDiffingProvider?: string | null;
  aiDiffingApiKey?: string | null;
  aiDiffingModel?: string | null;
}) {
  const { repositoryId, ...settingsData } = data;

  await queries.upsertAISettings(repositoryId || null, settingsData);

  revalidatePath('/settings');

  return { success: true };
}

export async function resetAISettings(repositoryId?: string | null) {
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
  permissionMode?: AgentSdkPermissionMode
): Promise<{
  success: boolean;
  message: string;
}> {
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
    }

    return { success: false, message: 'Unknown provider' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection test failed';
    return { success: false, message };
  }
}
