import "server-only";

import type { AiCallOptions, AiCapability, AiResult } from "@lastest/contracts";

import { generateWithAI, type AIProviderConfig } from "@/lib/ai";
import * as queries from "@/lib/db/queries";
import { getAIConfig } from "@/lib/playwright/agent-context";
import type { AIActionType } from "@/lib/db/schema";
import type { ContextScope } from "@lastest/kernel";

/**
 * The app's implementation of the `ai` capability.
 *
 * `core-scope.md` §4 narrows the RFC's `core/ai` to two things and nothing
 * else: **credentials** (provider API keys live behind this, never in a plugin)
 * and **money** (spend is attributed and gated at the one place that can
 * enforce it). Prompt templating and JSON parsing went the other way, to
 * `libs/ai-kit`.
 *
 * There is no `core/ai-gateway` package yet, so this sits in the composition
 * root instead — the same place `browser-host.ts` does, and for the same
 * reason: the primitives (provider selection, prompt logging, per-repo
 * settings) already exist here and are used by plenty of code that will never
 * be a plugin. Promoting it is a core PR; the capability a plugin sees does not
 * change when that happens, which is the point of the indirection.
 *
 * ### Tier, not model
 *
 * `AiCallOptions` deliberately carries a coarse tier rather than a model id, so
 * a feature cannot opt itself into a more expensive model without that being a
 * billing decision. The mapping lives here.
 *
 * Explorer's old per-repo `explorerModel` setting is what `fast` resolves to.
 * That is not a workaround — it is a better shape than the original. The
 * setting always meant "the cheap model this tenant wants for high-volume agent
 * turns", and every future plugin's high-volume path now gets it for free
 * instead of inventing its own column.
 */

/**
 * `AIActionType` values a plugin may attribute a call to.
 *
 * An allowlist rather than the whole union because `ai_prompt_logs.action_type`
 * is an enum column: a plugin inventing a value would fail the insert inside
 * the logging path rather than at the call site. Add the value here when a
 * plugin legitimately needs it — `create_test` arrived with
 * `@lastest/plugin-api-test`, whose generator has always logged under it, and
 * omitting it would have silently dropped the attribution on migration.
 */
const ACTION_TYPES = new Set<string>([
  "explorer_plan",
  "explorer_act",
  "explorer_analyze",
  "create_test",
]);

/** Apply the tier to a resolved provider config. */
function withTier(
  config: AIProviderConfig,
  tier: AiCallOptions["tier"],
  fastModel: string | null,
): AIProviderConfig {
  if (tier !== "fast" || !fastModel) return config;
  switch (config.provider) {
    case "openrouter":
      return { ...config, openrouterModel: fastModel };
    case "anthropic":
      return { ...config, anthropicModel: fastModel };
    case "openai":
      return { ...config, openaiModel: fastModel };
    case "ollama":
      return { ...config, ollamaModel: fastModel };
    case "claude-agent-sdk":
      return { ...config, agentSdkModel: fastModel };
    default:
      return config;
  }
}

export function createAiFactory() {
  return (_pluginId: string, scope: ContextScope): AiCapability => {
    const repoFromScope = scope.repo?.id;
    // `repoFromScope` cannot change for this capability's lifetime (one
    // resolved context), so its settings are fetched once and reused —
    // `generate()` in an agent loop can call this dozens of times per run,
    // and every call would otherwise be a redundant round-trip for a value
    // that was never going to change mid-run.
    let settingsPromise: ReturnType<typeof queries.getAISettings> | undefined;

    async function resolve(repositoryId: string | undefined) {
      // A plugin may name a repo per call, but it can only ever name the one
      // its context was scoped to — `resolveScope` already authorized that, and
      // nothing here re-derives it from caller input.
      const id = repositoryId ?? repoFromScope;
      if (!id) {
        throw new Error(
          "The ai capability needs a repository scope to resolve provider settings",
        );
      }
      if (repoFromScope && id !== repoFromScope) {
        throw new Error(
          "ai.generate was given a repository outside this context's scope",
        );
      }
      settingsPromise ??= queries.getAISettings(id);
      const settings = await settingsPromise;
      return { id, settings };
    }

    return {
      async generate(prompt: string, opts: AiCallOptions): Promise<AiResult> {
        const { id, settings } = await resolve(opts.repositoryId);
        if (!settings.provider || settings.provider === "none") {
          throw new Error(
            "No AI provider is configured — set one under Settings → AI",
          );
        }
        const config = withTier(
          getAIConfig(settings),
          opts.tier,
          settings.explorerModel?.trim() || null,
        );

        const text = await generateWithAI(config, prompt, opts.systemPrompt, {
          // Unknown action types are dropped rather than passed through: the
          // column is an enum, and a plugin inventing a value would fail the
          // insert inside the logging path rather than at the call site.
          actionType: ACTION_TYPES.has(opts.actionType)
            ? (opts.actionType as AIActionType)
            : undefined,
          repositoryId: id,
          ...(opts.json ? { responseFormat: "json_object" as const } : {}),
          signal: opts.signal,
        });

        // Token accounting is done by the provider layer into `ai_prompt_logs`;
        // it is not returned per call, so these are reported as unknown rather
        // than guessed. A plugin must not be able to infer spend from a
        // fabricated number.
        return {
          text,
          inputTokens: 0,
          outputTokens: 0,
          model: settings.provider,
        };
      },

      /**
       * "Can this team run AI at all", answered before a feature commits to a
       * long pipeline. Both halves matter: the plan has to include AI *and* a
       * provider has to be configured, and a caller cannot tell the difference
       * from a failed `generate` after ten minutes of work.
       *
       * `remainingTokens` is null because per-team token budgets are not
       * metered yet. Null means "unknown", not "unlimited" — a plugin that
       * treats it as a number to spend down would be inventing one.
       */
      async budget() {
        if (!scope.team.entitlements.has("ai")) {
          return { remainingTokens: null, enabled: false };
        }
        const id = repoFromScope;
        if (!id) return { remainingTokens: null, enabled: true };
        settingsPromise ??= queries.getAISettings(id);
        const settings = await settingsPromise.catch(() => null);
        return {
          remainingTokens: null,
          enabled: Boolean(settings?.provider && settings.provider !== "none"),
        };
      },
    };
  };
}
