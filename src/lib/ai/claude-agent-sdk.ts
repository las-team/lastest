import { query, type PermissionMode, type McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { AIProvider, GenerateOptions, StreamCallbacks } from './types';

export interface ClaudeAgentSDKOptions {
  permissionMode?: PermissionMode;
  workingDirectory?: string;
  model?: string;
  mcpServers?: Record<string, McpStdioServerConfig>;
  allowedTools?: string[];
  disallowedTools?: string[];
}

/** Bridge an AbortSignal into an AbortController the SDK can use. */
function abortControllerFromSignal(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller;
}

/** Max prompt size (in chars) the Agent SDK handles reliably. */
const MAX_PROMPT_CHARS = 100_000;

function truncatePrompt(prompt: string): string {
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  const truncated = prompt.slice(0, MAX_PROMPT_CHARS);
  return `${truncated}\n\n[TRUNCATED — original prompt was ${(prompt.length / 1024).toFixed(0)}KB, exceeding the ${(MAX_PROMPT_CHARS / 1024).toFixed(0)}KB limit for this provider. Please work with the content above.]`;
}

export class ClaudeAgentSDKProvider implements AIProvider {
  private permissionMode: PermissionMode;
  private workingDirectory?: string;
  private model?: string;
  private mcpServers?: Record<string, McpStdioServerConfig>;
  private allowedTools?: string[];
  private disallowedTools?: string[];

  constructor(options: ClaudeAgentSDKOptions = {}) {
    this.permissionMode = options.permissionMode || 'plan';
    this.workingDirectory = options.workingDirectory;
    this.model = options.model;
    this.mcpServers = options.mcpServers;
    this.allowedTools = options.allowedTools;
    this.disallowedTools = options.disallowedTools;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt, signal } = options;

    if (signal?.aborted) throw new Error('Aborted');

    let fullPrompt = truncatePrompt(prompt);
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${fullPrompt}`;
    }

    // Convert AbortSignal to AbortController for the SDK
    const abortController = signal ? abortControllerFromSignal(signal) : undefined;

    const messages: string[] = [];
    const stderrChunks: string[] = [];

    console.log('[claude-agent-sdk] generate() starting', {
      permissionMode: this.permissionMode,
      cwd: this.workingDirectory,
      model: this.model,
      hasMcpServers: !!this.mcpServers,
      mcpServerNames: this.mcpServers ? Object.keys(this.mcpServers) : [],
      allowedTools: this.allowedTools,
      disallowedTools: this.disallowedTools,
      promptLength: fullPrompt.length,
    });

    try {
      for await (const message of query({
        prompt: fullPrompt,
        options: {
          permissionMode: this.permissionMode,
          cwd: this.workingDirectory,
          model: this.model,
          ...(this.mcpServers && { mcpServers: this.mcpServers }),
          ...(this.allowedTools && { allowedTools: this.allowedTools }),
          ...(this.disallowedTools && { disallowedTools: this.disallowedTools }),
          ...(abortController && { abortController }),
          stderr: (data: string) => { stderrChunks.push(data); },
        },
      })) {
        // Check abort between iterations
        if (signal?.aborted) throw new Error('Aborted');

        // Collect text content from assistant messages
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              messages.push(block.text);
            }
          }
        }
        // Also collect result messages (success only)
        if (message.type === 'result' && message.subtype === 'success') {
          if (message.result) {
            messages.push(message.result);
          }
        }
        // Capture error results with more detail
        if (message.type === 'result' && message.subtype.startsWith('error')) {
          const msg = message as Record<string, unknown>;
          const errMsg = (msg.error as string) || (msg.result as string) || message.subtype;
          const exitCode = msg.exitCode != null ? ` (exit code ${msg.exitCode})` : '';
          throw new Error(`Claude Agent SDK returned error: ${errMsg}${exitCode}`);
        }
      }

      return messages.join('\n').trim();
    } catch (error) {
      const stderr = stderrChunks.join('').trim();
      if (error instanceof Error) {
        if (error.message === 'Aborted') throw error;
        const parts = [`Claude Agent SDK error: ${error.message}`];
        if (stderr) parts.push(`stderr: ${stderr.slice(0, 1000)}`);
        if (messages.length > 0) parts.push(`last output: ${messages.slice(-2).join('\n').slice(0, 500)}`);
        const fullError = parts.join(' | ');
        console.error('[claude-agent-sdk]', fullError);
        throw new Error(fullError);
      }
      throw error;
    }
  }

  async generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void> {
    const { prompt, systemPrompt, signal } = options;

    if (signal?.aborted) throw new Error('Aborted');

    let fullPrompt = truncatePrompt(prompt);
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${fullPrompt}`;
    }

    // Convert AbortSignal to AbortController for the SDK
    const abortController = signal ? abortControllerFromSignal(signal) : undefined;

    let fullText = '';
    const stderrChunks: string[] = [];

    try {
      for await (const message of query({
        prompt: fullPrompt,
        options: {
          permissionMode: this.permissionMode,
          cwd: this.workingDirectory,
          model: this.model,
          ...(this.mcpServers && { mcpServers: this.mcpServers }),
          ...(this.allowedTools && { allowedTools: this.allowedTools }),
          ...(this.disallowedTools && { disallowedTools: this.disallowedTools }),
          ...(abortController && { abortController }),
          stderr: (data: string) => { stderrChunks.push(data); },
        },
      })) {
        if (signal?.aborted) throw new Error('Aborted');

        // Stream text content from assistant messages
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              fullText += block.text;
              callbacks.onToken?.(block.text);
            }
          }
        }
        // Also handle result messages (success only)
        if (message.type === 'result' && message.subtype === 'success' && message.result) {
          fullText += message.result;
          callbacks.onToken?.(message.result);
        }
        // Capture error results with more detail
        if (message.type === 'result' && message.subtype.startsWith('error')) {
          const msg = message as Record<string, unknown>;
          const errMsg = (msg.error as string) || (msg.result as string) || message.subtype;
          const exitCode = msg.exitCode != null ? ` (exit code ${msg.exitCode})` : '';
          throw new Error(`Claude Agent SDK returned error: ${errMsg}${exitCode}`);
        }
      }

      callbacks.onComplete?.(fullText.trim());
    } catch (error) {
      const stderr = stderrChunks.join('').trim();
      const base = error instanceof Error ? error : new Error(String(error));
      if (base.message !== 'Aborted' && stderr) {
        base.message = `${base.message} | stderr: ${stderr.slice(0, 500)}`;
      }
      callbacks.onError?.(base);
      throw base;
    }
  }
}
