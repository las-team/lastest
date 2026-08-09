import type { AiCapability, AiCallOptions } from "@lastest/contracts";
import { parseAiJson } from "@lastest/ai-kit";

/**
 * One place where explorer talks to a model.
 *
 * Every call in this plugin goes through `ctx.ai`, which is what makes the
 * provider key core's problem and the token spend a metered, gated decision
 * rather than a feature's. What used to be here — provider selection, per-repo
 * model overrides, prompt logging — is gone: it was never explorer's business,
 * it was just where the code happened to live.
 *
 * ### One thing the contract does not carry
 *
 * `AiCallOptions.tier` is `"fast" | "balanced" | "deep"` and deliberately *not*
 * a model id, so a feature cannot opt itself into a more expensive model
 * without that being a billing decision. Explorer had a per-repo
 * `explorerModel` setting doing exactly that. The setting still exists, but it
 * now means "the model this tenant's `fast` tier resolves to", applied by the
 * gateway rather than named by the plugin. Worth knowing if you go looking for
 * where the override went.
 *
 * Tiering here is not decorative. The tester makes one blocking call per
 * browser action — dozens per scenario — so it runs on `fast`. Planning and
 * root-cause clustering happen once per iteration and once per session, and
 * both get read by a human, so they are worth `balanced`.
 */
export type AiTier = NonNullable<AiCallOptions["tier"]>;

export interface AiJsonRequest<T> {
  prompt: string;
  systemPrompt: string;
  actionType: string;
  tier: AiTier;
  isValid: (value: unknown) => value is T;
  source: string;
  repositoryId?: string;
  signal?: AbortSignal;
}

/**
 * Ask for JSON and validate its shape before anyone can act on it.
 *
 * Returning `null` rather than throwing is load-bearing: every caller here has
 * a useful degraded path (no scenarios this iteration, one cluster per
 * finding), and a page under test can shape model output — its own headings and
 * error text land in these prompts. Shape validation is the layer that stops
 * attacker-chosen keys flowing into a DB write.
 */
export async function generateJson<T>(
  ai: AiCapability,
  req: AiJsonRequest<T>,
): Promise<T | null> {
  const result = await ai.generate(req.prompt, {
    actionType: req.actionType,
    repositoryId: req.repositoryId,
    systemPrompt: req.systemPrompt,
    json: true,
    tier: req.tier,
    signal: req.signal,
  });
  return parseAiJson(result.text, req.isValid, { source: req.source });
}
