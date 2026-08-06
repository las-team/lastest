import type { AISettings } from "@/lib/db/schema";
import type { AIProviderType } from "./types";

/** Actionable hint shown when a team has no runnable AI configuration. */
export const AI_NOT_CONFIGURED_MESSAGE =
  "AI is not configured for this team — choose a provider and add its API key in Settings → AI.";

export const CLAUDE_CLI_UNAVAILABLE_MESSAGE =
  "The Claude CLI provider is not available in this deployment (AI_HOST_CLI_DISABLED) — use the Claude Agent SDK or an API-key provider (Anthropic, OpenAI, OpenRouter) instead.";

export const AGENT_SDK_NO_CREDENTIALS_MESSAGE =
  "The Claude Agent SDK has no credentials in this deployment — set ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN) for the app, or configure an API-key provider in Settings → AI.";

/**
 * True on images that ship no `claude` binary on PATH and offer no interactive
 * `claude login` (the split-services k8s image built from Dockerfile.app, which
 * sets AI_HOST_CLI_DISABLED=1).
 *
 * This gates ONLY the 'claude-cli' provider. The Agent SDK ships in every image
 * with its platform-native runtime and stays available — it just has to take
 * its credentials from the environment there (see agentSdkReadiness).
 */
export function hostClaudeCliUnavailable(): boolean {
  const v = (process.env.AI_HOST_CLI_DISABLED || "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * The Agent SDK reads credentials from the environment
 * (ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN); deployments without an
 * interactive `claude login` must inject one of them (see k8s/app.yaml).
 */
export function sdkAmbientCredentialsPresent(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN,
  );
}

/**
 * Can the Agent SDK provider actually run here? On a developer machine the
 * on-disk `claude login` credentials count, so only headless deployments need
 * ambient env credentials. Failing here yields one actionable message instead
 * of a cryptic SDK auth error at query time.
 */
export function agentSdkReadiness(): AiReadiness {
  return hostClaudeCliUnavailable() && !sdkAmbientCredentialsPresent()
    ? { runnable: false, reason: AGENT_SDK_NO_CREDENTIALS_MESSAGE }
    : { runnable: true };
}

/**
 * Default AI provider for teams with no saved AI-settings row. The Agent SDK is
 * the natural default wherever it can run; a deployment that ships no
 * credentials for it must default to a BYOK provider instead, otherwise every
 * fresh team's first AI call fails. Pass `agentSdkAvailable` explicitly from
 * client components (server env is not visible there).
 */
export function defaultAiProvider(
  agentSdkAvailable: boolean = agentSdkReadiness().runnable,
): AIProviderType {
  return agentSdkAvailable ? "claude-agent-sdk" : "anthropic";
}

/** The subset of settings/config this gate reads. */
export interface AiReadinessInput {
  provider: string;
  openrouterApiKey?: string | null;
  anthropicApiKey?: string | null;
  openaiApiKey?: string | null;
  ollamaBaseUrl?: string | null;
  ollamaModel?: string | null;
}

export type AiReadiness =
  | { runnable: true }
  | { runnable: false; reason: string };

/**
 * Single gate answering "can this AI configuration actually run?". Used before
 * any provider construction so fresh/unconfigured teams get one actionable
 * message instead of a hard throw deep in provider code.
 */
export function checkAiConfigReadiness(input: AiReadinessInput): AiReadiness {
  const provider = input.provider as AIProviderType;
  switch (provider) {
    case "claude-cli":
      return hostClaudeCliUnavailable()
        ? { runnable: false, reason: CLAUDE_CLI_UNAVAILABLE_MESSAGE }
        : { runnable: true };
    case "claude-agent-sdk":
      return agentSdkReadiness();
    case "openrouter":
      return input.openrouterApiKey
        ? { runnable: true }
        : { runnable: false, reason: AI_NOT_CONFIGURED_MESSAGE };
    case "anthropic":
      return input.anthropicApiKey
        ? { runnable: true }
        : { runnable: false, reason: AI_NOT_CONFIGURED_MESSAGE };
    case "openai":
      return input.openaiApiKey
        ? { runnable: true }
        : { runnable: false, reason: AI_NOT_CONFIGURED_MESSAGE };
    case "ollama":
      return input.ollamaModel
        ? { runnable: true }
        : {
            runnable: false,
            reason:
              "Ollama is not fully configured — set a model (and base URL) in Settings → AI.",
          };
    default:
      return { runnable: false, reason: AI_NOT_CONFIGURED_MESSAGE };
  }
}

/**
 * In-product AI ("BYOK" — bring your own key) is considered *configured* only
 * when the team has explicitly saved an AI-settings row whose selected provider
 * has the credential/config it needs to actually run. A bare default row (no
 * saved id) does NOT count — otherwise every team would look configured and the
 * in-product agent functions would show even though nothing can run.
 *
 * This is the gate for the MCP-first model: when BYOK is not configured we hide
 * the in-product agent functions and steer the user to drive Lastest from their
 * own AI agent over MCP instead.
 *
 * NOTE: quickstart deliberately does NOT use this gate — it runs server-side AI
 * silently regardless (see docs/specs/25-mcp-first.md, Part E).
 */
export function isByokConfigured(
  settings:
    | Pick<
        AISettings,
        | "id"
        | "provider"
        | "openrouterApiKey"
        | "anthropicApiKey"
        | "openaiApiKey"
        | "ollamaBaseUrl"
        | "ollamaModel"
      >
    | null
    | undefined,
): boolean {
  // No persisted row → defaults only → not configured.
  if (!settings || !settings.id) return false;
  return checkAiConfigReadiness(settings).runnable;
}
