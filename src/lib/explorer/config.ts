import type { AIProviderConfig } from "@/lib/ai";
import { getAIConfig } from "@/lib/playwright/agent-context";
import type * as queries from "@/lib/db/queries";

/**
 * Explorer AI config: the repo's normal AI config with the optional
 * `explorerModel` override applied to the active provider. The explorer loop
 * makes many small calls (one per tester turn), so pointing it at a cheaper,
 * faster model than test generation is often the right trade — explorbot's
 * "cheap workers" principle.
 */
export function explorerConfigFromSettings(
  settings: Awaited<ReturnType<typeof queries.getAISettings>>,
): AIProviderConfig {
  const config = getAIConfig(settings);
  const model = settings.explorerModel?.trim();
  if (!model) return config;
  switch (config.provider) {
    case "openrouter":
      return { ...config, openrouterModel: model };
    case "anthropic":
      return { ...config, anthropicModel: model };
    case "openai":
      return { ...config, openaiModel: model };
    case "ollama":
      return { ...config, ollamaModel: model };
    case "claude-agent-sdk":
      return { ...config, agentSdkModel: model };
    default:
      return config;
  }
}
