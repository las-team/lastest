import "server-only";

import type { AiCallOptions, AiCapability, AiResult } from "@lastest/contracts";
import { resolveSessionCdpUrl } from "@lastest/core-browser/internal";

import {
  generateWithAI,
  type AIProviderConfig,
  type GenerateWithAIOptions,
} from "@/lib/ai";
import type { MCPServerConfig } from "@/lib/ai/mcp-bridge";
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
 *
 * ### Browser tools
 *
 * `AiCallOptions.browserTools` is the second thing this file resolves that a
 * plugin may not: a `BrowserSession` back into the CDP endpoint
 * `@playwright/mcp` is spawned against. It sits here for the same reason the
 * provider keys do — this is the only layer that can hold the address without
 * a feature seeing it. `applyBrowserTools` below is the whole implementation;
 * `@lastest/core-browser/internal` is the only import in this repo that can
 * perform the lookup, and `pnpm arch` forbids it to plugins.
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
  // Arrived with `@lastest/plugin-quickstart-scout`, whose two AI calls have
  // always logged under it. Omitting it would have silently dropped the
  // attribution on migration — the exact failure mode this allowlist's header
  // warns about, hit for the second time.
  "agent_discover",
]);

/**
 * Turn a plugin-supplied `BrowserSession` into live MCP browser tools.
 *
 * This is the whole of `AiCallOptions.browserTools`, and the reason it can
 * exist without weakening `BrowserSession`: the resolution happens *here*, in
 * the composition root, and the endpoint is never returned to the caller. A
 * plugin holds an opaque object at every point in the flow.
 *
 * Two refusals, both deliberate:
 *
 *   - **An unresolvable session throws.** A forged object, or a real one whose
 *     `withBrowser` scope already ended, resolves to `undefined`. Falling back
 *     to `useMCP: true` with no endpoint would spawn `@playwright/mcp` against
 *     a Chromium in *this* process — running agent-driven browser actions
 *     outside the sandbox. `generateWithAI` already throws for that case; this
 *     throws earlier, with a message that says which of the two happened.
 *   - **Strict tool allowlists on the agent-SDK path.** Without
 *     `agentSdkStrictMcpConfig` the SDK falls back to `WebFetch` when a browser
 *     tool fails, which silently turns a browser session into an HTTP fetch and
 *     produces confidently wrong answers about a JS-rendered page. This mirrors
 *     what the pre-migration scout/generator/healer code did by hand in four
 *     separate files — now in one place, so a fifth caller cannot forget it.
 *
 * Mutates `config` for the agent-SDK branch, matching `generateWithAI`'s own
 * expectations; `config` is already a per-call object built by `getAIConfig`.
 */
function applyBrowserTools(
  config: AIProviderConfig,
  session: NonNullable<AiCallOptions["browserTools"]>,
): Pick<GenerateWithAIOptions, "useMCP" | "mcpConfig"> {
  const cdpEndpoint = resolveSessionCdpUrl(session);
  if (!cdpEndpoint) {
    throw new Error(
      "ai.generate({ browserTools }) was given a browser session core did not " +
        "issue, or one whose withBrowser scope has already ended. Refusing to " +
        "run browser tools without a claimed Embedded Browser.",
    );
  }

  const playwrightServer: MCPServerConfig = {
    command: "npx",
    args: [
      "@playwright/mcp@latest",
      "--cdp-endpoint",
      cdpEndpoint,
      "--headless",
    ],
  };

  if (config.provider === "claude-agent-sdk") {
    config.agentSdkStrictMcpConfig = true;
    config.agentSdkMcpServers = { playwright: playwrightServer };
    config.agentSdkAllowedTools = ["mcp__playwright__*"];
    config.agentSdkDisallowedTools = [
      "Bash",
      "Write",
      "Edit",
      "NotebookEdit",
      "WebFetch",
    ];
    // The SDK consumes `agentSdkMcpServers` above; the bridge path is unused.
    return { useMCP: false };
  }

  return {
    useMCP: true,
    mcpConfig: { servers: { playwright: playwrightServer }, cdpEndpoint },
  };
}

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
        const mcp = opts.browserTools
          ? applyBrowserTools(config, opts.browserTools)
          : undefined;

        let promptLogId: string | undefined;
        const text = await generateWithAI(config, prompt, opts.systemPrompt, {
          // Unknown action types are dropped rather than passed through: the
          // column is an enum, and a plugin inventing a value would fail the
          // insert inside the logging path rather than at the call site.
          actionType: ACTION_TYPES.has(opts.actionType)
            ? (opts.actionType as AIActionType)
            : undefined,
          repositoryId: id,
          ...(opts.json ? { responseFormat: "json_object" as const } : {}),
          ...mcp,
          onLogCreated: (logId) => {
            promptLogId = logId;
          },
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
          promptLogId,
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
