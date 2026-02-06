import { query, type PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { AIProvider, GenerateOptions, StreamCallbacks } from './types';

export interface ClaudeAgentSDKOptions {
  permissionMode?: PermissionMode;
  workingDirectory?: string;
  model?: string;
}

export class ClaudeAgentSDKProvider implements AIProvider {
  private permissionMode: PermissionMode;
  private workingDirectory?: string;
  private model?: string;

  constructor(options: ClaudeAgentSDKOptions = {}) {
    this.permissionMode = options.permissionMode || 'plan';
    this.workingDirectory = options.workingDirectory;
    this.model = options.model;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt } = options;

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
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
          maxTurns: 3,
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
        // Capture error results
        if (message.type === 'result' && message.subtype.startsWith('error')) {
          const errMsg = (message as { error?: string }).error || message.subtype;
          throw new Error(`Claude Agent SDK returned error: ${errMsg}`);
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

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
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
          maxTurns: 3,
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
        // Capture error results
        if (message.type === 'result' && message.subtype.startsWith('error')) {
          const errMsg = (message as { error?: string }).error || message.subtype;
          throw new Error(`Claude Agent SDK returned error: ${errMsg}`);
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
