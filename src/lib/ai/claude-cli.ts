import { spawn } from "child_process";
import type { AIProvider, GenerateOptions, StreamCallbacks } from "./types";

// Extend PATH to include common locations for claude CLI
function getExtendedEnv(): NodeJS.ProcessEnv {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const extendedPath = `${homeDir}/.local/bin:${process.env.PATH}`;
  return { ...process.env, PATH: extendedPath };
}

// Per-call wall-clock cap. Agent-scale prompts (QA planner with a discovery
// digest + existing-coverage section) legitimately run past the old 120s cap,
// so the default is 4 minutes; override with CLAUDE_CLI_TIMEOUT_MS.
function cliTimeoutMs(): number {
  const raw = Number(process.env.CLAUDE_CLI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 240_000;
}

export class ClaudeCLIProvider implements AIProvider {
  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt, signal } = options;

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    }

    if (signal?.aborted) throw new Error("Aborted");

    return new Promise((resolve, reject) => {
      const child = spawn("claude", ["-p", "-"], {
        shell: false,
        env: getExtendedEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      const onAbort = () => {
        child.kill("SIGTERM");
        reject(new Error("Aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timeoutMs = cliTimeoutMs();
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(
          new Error(
            `Claude CLI error: timed out after ${Math.round(timeoutMs / 1000)}s`,
          ),
        );
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(
            new Error(
              `Claude CLI error: exited with code ${code}${stderr ? ` \u2014 ${stderr.trim()}` : ""}`,
            ),
          );
        }
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error(`Claude CLI error: ${error.message}`));
      });

      // Write prompt via stdin to avoid E2BIG on large prompts
      child.stdin.write(fullPrompt);
      child.stdin.end();
    });
  }

  async generateStream(
    options: GenerateOptions,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const { prompt, systemPrompt, signal } = options;

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    }

    if (signal?.aborted) throw new Error("Aborted");

    return new Promise((resolve, reject) => {
      const child = spawn("claude", ["-p", "-"], {
        shell: false,
        env: getExtendedEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let fullText = "";

      const onAbort = () => {
        child.kill("SIGTERM");
        const error = new Error("Aborted");
        callbacks.onError?.(error);
        reject(error);
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (data) => {
        const text = data.toString();
        fullText += text;
        callbacks.onToken?.(text);
      });

      child.stderr.on("data", (data) => {
        console.error("Claude CLI stderr:", data.toString());
      });

      child.on("close", (code) => {
        signal?.removeEventListener("abort", onAbort);
        if (code === 0) {
          callbacks.onComplete?.(fullText);
          resolve();
        } else {
          const error = new Error(`Claude CLI exited with code ${code}`);
          callbacks.onError?.(error);
          reject(error);
        }
      });

      child.on("error", (error) => {
        signal?.removeEventListener("abort", onAbort);
        callbacks.onError?.(error);
        reject(error);
      });

      // Write prompt via stdin to avoid E2BIG on large prompts
      child.stdin.write(fullPrompt);
      child.stdin.end();
    });
  }
}

export const claudeCliProvider = new ClaudeCLIProvider();
