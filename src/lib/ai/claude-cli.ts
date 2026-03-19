import { spawn } from 'child_process';
import type { AIProvider, GenerateOptions, StreamCallbacks } from './types';

// Extend PATH to include common locations for claude CLI
function getExtendedEnv(): NodeJS.ProcessEnv {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const extendedPath = `${homeDir}/.local/bin:${process.env.PATH}`;
  return { ...process.env, PATH: extendedPath };
}

export class ClaudeCLIProvider implements AIProvider {
  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt, signal } = options;

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    }

    if (signal?.aborted) throw new Error('Aborted');

    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['-p', fullPrompt], {
        shell: false,
        env: getExtendedEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const onAbort = () => {
        child.kill('SIGTERM');
        reject(new Error('Aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Claude CLI error: exited with code ${code}${stderr ? ` \u2014 ${stderr.trim()}` : ''}`));
        }
      });

      child.on('error', (error) => {
        signal?.removeEventListener('abort', onAbort);
        reject(new Error(`Claude CLI error: ${error.message}`));
      });

      // 2 minute timeout
      setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Claude CLI error: timed out after 120s'));
      }, 120000);
    });
  }

  async generateStream(options: GenerateOptions, callbacks: StreamCallbacks): Promise<void> {
    const { prompt, systemPrompt, signal } = options;

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    }

    if (signal?.aborted) throw new Error('Aborted');

    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['-p', fullPrompt], {
        shell: false,
        env: getExtendedEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let fullText = '';

      const onAbort = () => {
        child.kill('SIGTERM');
        const error = new Error('Aborted');
        callbacks.onError?.(error);
        reject(error);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (data) => {
        const text = data.toString();
        fullText += text;
        callbacks.onToken?.(text);
      });

      child.stderr.on('data', (data) => {
        console.error('Claude CLI stderr:', data.toString());
      });

      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
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
        signal?.removeEventListener('abort', onAbort);
        callbacks.onError?.(error);
        reject(error);
      });
    });
  }
}

export const claudeCliProvider = new ClaudeCLIProvider();
