import { query, type PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { AIProvider, GenerateOptions, StreamCallbacks } from './types';

export interface ClaudeAgentSDKOptions {
  permissionMode?: PermissionMode;
  workingDirectory?: string;
}

export class ClaudeAgentSDKProvider implements AIProvider {
  private permissionMode: PermissionMode;
  private workingDirectory?: string;

  constructor(options: ClaudeAgentSDKOptions = {}) {
    this.permissionMode = options.permissionMode || 'plan';
    this.workingDirectory = options.workingDirectory;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt } = options;

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    }

    const messages: string[] = [];

    try {
      for await (const message of query({
        prompt: fullPrompt,
        options: {
          permissionMode: this.permissionMode,
          cwd: this.workingDirectory,
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
      }

      return messages.join('\n').trim();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Claude Agent SDK error: ${error.message}`);
      }
      throw error;
    }
  }

  async generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void> {
    const { prompt, systemPrompt } = options;

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    }

    let fullText = '';

    try {
      for await (const message of query({
        prompt: fullPrompt,
        options: {
          permissionMode: this.permissionMode,
          cwd: this.workingDirectory,
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
      }

      callbacks.onComplete?.(fullText.trim());
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks.onError?.(err);
      throw err;
    }
  }
}
