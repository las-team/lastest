import type {
  query as sdkQuery,
  PermissionMode,
  McpStdioServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type { AIProvider, GenerateOptions, StreamCallbacks } from "./types";

/**
 * The SDK is loaded lazily so importing this module never requires the
 * package to be installed. API-key-only images (Dockerfile.app) don't ship
 * @anthropic-ai/claude-agent-sdk (it's a serverExternalPackage, pruned from
 * the standalone build and deliberately not copied back in) — a top-level
 * import would crash every consumer of @/lib/ai at load time, even when a
 * different provider is selected.
 */
async function loadQuery(): Promise<typeof sdkQuery> {
  try {
    const mod = await import("@anthropic-ai/claude-agent-sdk");
    return mod.query;
  } catch (err) {
    throw new Error(
      "Claude Agent SDK is not available in this deployment (API-key-only image?). " +
        `Configure an API-key provider (Anthropic, OpenAI, OpenRouter) instead. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

export interface ClaudeAgentSDKOptions {
  permissionMode?: PermissionMode;
  workingDirectory?: string;
  model?: string;
  mcpServers?: Record<string, McpStdioServerConfig>;
  strictMcpConfig?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
}

/** Bridge an AbortSignal into an AbortController the SDK can use. */
function abortControllerFromSignal(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
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
  private strictMcpConfig?: boolean;
  private allowedTools?: string[];
  private disallowedTools?: string[];

  constructor(options: ClaudeAgentSDKOptions = {}) {
    this.permissionMode = options.permissionMode || "plan";
    this.workingDirectory = options.workingDirectory;
    this.model = options.model;
    this.mcpServers = options.mcpServers;
    this.strictMcpConfig = options.strictMcpConfig;
    this.allowedTools = options.allowedTools;
    this.disallowedTools = options.disallowedTools;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const { prompt, systemPrompt, signal } = options;

    if (signal?.aborted) throw new Error("Aborted");

    let fullPrompt = truncatePrompt(prompt);
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${fullPrompt}`;
    }

    // Convert AbortSignal to AbortController for the SDK
    const abortController = signal
      ? abortControllerFromSignal(signal)
      : undefined;

    // The SDK emits the model's final turn twice: once as an `assistant`
    // message text block, and again as the terminal `result` (subtype
    // "success") whose `.result` is that same text verbatim. Appending both
    // yields a doubled reply (e.g. `{json}\n{json}`) that then fails
    // JSON.parse. Keep the two sources separate and prefer the authoritative
    // `result`; fall back to the assistant text only if no result arrives.
    const assistantChunks: string[] = [];
    let resultText: string | null = null;
    const stderrChunks: string[] = [];

    const query = await loadQuery();

    try {
      for await (const message of query({
        prompt: fullPrompt,
        options: {
          permissionMode: this.permissionMode,
          cwd: this.workingDirectory,
          model: this.model,
          ...(this.mcpServers && { mcpServers: this.mcpServers }),
          ...(this.strictMcpConfig && { strictMcpConfig: true }),
          ...(this.allowedTools && { allowedTools: this.allowedTools }),
          ...(this.disallowedTools && {
            disallowedTools: this.disallowedTools,
          }),
          ...(abortController && { abortController }),
          stderr: (data: string) => {
            stderrChunks.push(data);
          },
        },
      })) {
        // Check abort between iterations
        if (signal?.aborted) throw new Error("Aborted");

        // Collect text content from assistant messages
        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text") {
              assistantChunks.push(block.text);
            }
          }
        }
        // The terminal success result — the authoritative final answer.
        if (message.type === "result" && message.subtype === "success") {
          if (message.result) {
            resultText = message.result;
          }
        }
        // Capture error results with more detail
        if (message.type === "result" && message.subtype.startsWith("error")) {
          const msg = message as Record<string, unknown>;
          const errMsg =
            (msg.error as string) || (msg.result as string) || message.subtype;
          const exitCode =
            msg.exitCode != null ? ` (exit code ${msg.exitCode})` : "";
          throw new Error(
            `Claude Agent SDK returned error: ${errMsg}${exitCode}`,
          );
        }
      }

      return (resultText ?? assistantChunks.join("\n")).trim();
    } catch (error) {
      const stderr = stderrChunks.join("").trim();
      if (error instanceof Error) {
        if (error.message === "Aborted") throw error;
        const parts = [`Claude Agent SDK error: ${error.message}`];
        if (stderr) parts.push(`stderr: ${stderr.slice(0, 1000)}`);
        const lastOutput = resultText ?? assistantChunks.slice(-2).join("\n");
        if (lastOutput) parts.push(`last output: ${lastOutput.slice(0, 500)}`);
        throw new Error(parts.join(" | "));
      }
      throw error;
    }
  }

  async generateStream(
    options: GenerateOptions,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const { prompt, systemPrompt, signal } = options;

    if (signal?.aborted) throw new Error("Aborted");

    let fullPrompt = truncatePrompt(prompt);
    if (systemPrompt) {
      fullPrompt = `${systemPrompt}\n\n---\n\n${fullPrompt}`;
    }

    // Convert AbortSignal to AbortController for the SDK
    const abortController = signal
      ? abortControllerFromSignal(signal)
      : undefined;

    let fullText = "";
    // Tracks whether any assistant text was already streamed this turn. The
    // SDK's terminal success `result` repeats that same final text, so we only
    // emit it as a fallback when no assistant text arrived — otherwise the
    // stream (and fullText) would be doubled. See generate() for the details.
    let streamedAssistant = false;
    const stderrChunks: string[] = [];

    try {
      // Inside the try so a missing SDK reaches callbacks.onError like any
      // other provider failure.
      const query = await loadQuery();
      for await (const message of query({
        prompt: fullPrompt,
        options: {
          permissionMode: this.permissionMode,
          cwd: this.workingDirectory,
          model: this.model,
          ...(this.mcpServers && { mcpServers: this.mcpServers }),
          ...(this.strictMcpConfig && { strictMcpConfig: true }),
          ...(this.allowedTools && { allowedTools: this.allowedTools }),
          ...(this.disallowedTools && {
            disallowedTools: this.disallowedTools,
          }),
          ...(abortController && { abortController }),
          stderr: (data: string) => {
            stderrChunks.push(data);
          },
        },
      })) {
        if (signal?.aborted) throw new Error("Aborted");

        // Stream text content from assistant messages
        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text") {
              fullText += block.text;
              streamedAssistant = true;
              callbacks.onToken?.(block.text);
            }
          }
        }
        // Terminal success result — only use it if no assistant text streamed,
        // since it otherwise duplicates the already-streamed final turn.
        if (
          message.type === "result" &&
          message.subtype === "success" &&
          message.result &&
          !streamedAssistant
        ) {
          fullText += message.result;
          callbacks.onToken?.(message.result);
        }
        // Capture error results with more detail
        if (message.type === "result" && message.subtype.startsWith("error")) {
          const msg = message as Record<string, unknown>;
          const errMsg =
            (msg.error as string) || (msg.result as string) || message.subtype;
          const exitCode =
            msg.exitCode != null ? ` (exit code ${msg.exitCode})` : "";
          throw new Error(
            `Claude Agent SDK returned error: ${errMsg}${exitCode}`,
          );
        }
      }

      callbacks.onComplete?.(fullText.trim());
    } catch (error) {
      const stderr = stderrChunks.join("").trim();
      const base = error instanceof Error ? error : new Error(String(error));
      if (base.message !== "Aborted" && stderr) {
        base.message = `${base.message} | stderr: ${stderr.slice(0, 500)}`;
      }
      callbacks.onError?.(base);
      throw base;
    }
  }
}
