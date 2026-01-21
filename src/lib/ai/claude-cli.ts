import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import type { AIProvider, GenerateOptions, StreamCallbacks } from './types';

const execAsync = promisify(exec);

function escapePrompt(prompt: string): string {
  // Escape special characters for shell
  return prompt
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

export class ClaudeCLIProvider implements AIProvider {
  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt } = options;

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    }

    const escapedPrompt = escapePrompt(fullPrompt);

    try {
      const { stdout } = await execAsync(`claude -p "${escapedPrompt}"`, {
        timeout: 120000, // 2 minute timeout
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      return stdout.trim();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Claude CLI error: ${error.message}`);
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

    const escapedPrompt = escapePrompt(fullPrompt);

    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['-p', escapedPrompt], {
        shell: true,
      });

      let fullText = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        fullText += text;
        callbacks.onToken?.(text);
      });

      child.stderr.on('data', (data) => {
        console.error('Claude CLI stderr:', data.toString());
      });

      child.on('close', (code) => {
        if (code === 0) {
          callbacks.onComplete?.(fullText);
          resolve();
        } else {
          const error = new Error(`Claude CLI exited with code ${code}`);
          callbacks.onError?.(error);
          reject(error);
        }
      });

      child.on('error', (error) => {
        callbacks.onError?.(error);
        reject(error);
      });
    });
  }
}

export const claudeCliProvider = new ClaudeCLIProvider();
