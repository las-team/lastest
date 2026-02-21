import { query, type PermissionMode, type McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { AIProvider, GenerateOptions, StreamCallbacks } from './types';

export interface ClaudeAgentSDKOptions {
  permissionMode?: PermissionMode;
  workingDirectory?: string;
  model?: string;
  mcpServers?: Record<string, McpStdioServerConfig>;
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

  constructor(options: ClaudeAgentSDKOptions = {}) {
    this.permissionMode = options.permissionMode || 'plan';
    this.workingDirectory = options.workingDirectory;
    this.model = options.model;
    this.mcpServers = options.mcpServers;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt } = options;

    let fullPrompt = truncatePrompt(prompt);
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${fullPrompt}`;
    }

    const messages: string[] = [];
    const stderrChunks: string[] = [];

    try {
      for await (const message of query({
        prompt: fullPrompt,
        options: {
          permissionMode: this.permissionMode,
          cwd: this.workingDirectory,
          model: this.model,
          ...(this.mcpServers && { mcpServers: this.mcpServers }),
          stderr: (data: string) => { stderrChunks.push(data); },
        },
      })) {
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
        const detail = stderr ? ` | stderr: ${stderr.slice(0, 500)}` : '';
        throw new Error(`Claude Agent SDK error: ${error.message}${detail}`);
      }
      throw error;
    }
  }

  async generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void> {
    const { prompt, systemPrompt } = options;

    let fullPrompt = truncatePrompt(prompt);
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${fullPrompt}`;
    }

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
          stderr: (data: string) => { stderrChunks.push(data); },
        },
      })) {
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
      if (stderr) {
        base.message = `${base.message} | stderr: ${stderr.slice(0, 500)}`;
      }
      callbacks.onError?.(base);
      throw base;
    }
  }
}
