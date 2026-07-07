import type { AISettings } from "@/lib/db/schema";

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

  switch (settings.provider) {
    case "openrouter":
      return !!settings.openrouterApiKey;
    case "anthropic":
      return !!settings.anthropicApiKey;
    case "openai":
      return !!settings.openaiApiKey;
    case "ollama":
      return !!settings.ollamaBaseUrl && !!settings.ollamaModel;
    // Host-side credentials (CLI login / SDK env) — treated as configured once
    // the team has explicitly selected the provider and saved the row.
    case "claude-cli":
    case "claude-agent-sdk":
      return true;
    default:
      return false;
  }
}
