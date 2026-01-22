import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import type { AIProvider, GenerateOptions, StreamCallbacks } from './types';

const execAsync = promisify(exec);

// Extend PATH to include common locations for claude CLI
function getExtendedEnv(): NodeJS.ProcessEnv {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const extendedPath = `${homeDir}/.local/bin:${process.env.PATH}`;
  return { ...process.env, PATH: extendedPath };
}

function escapePromptForAnsiC(prompt: string): string {
  // Escape for ANSI-C quoting ($'...') which properly handles special characters
  return prompt
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export class ClaudeCLIProvider implements AIProvider {
  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt } = options;

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    }

    const escapedPrompt = escapePromptForAnsiC(fullPrompt);

    try {
      const { stdout } = await execAsync(`claude -p $'${escapedPrompt}' < /dev/null`, {
        timeout: 120000, // 2 minute timeout
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        shell: '/bin/bash',
        env: getExtendedEnv(),
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

    return new Promise((resolve, reject) => {
      // For spawn, we pass arguments directly without shell escaping
      const child = spawn('claude', ['-p', fullPrompt], {
        shell: false,
        env: getExtendedEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
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
