/**
 * AI gateway.
 *
 * Narrower than the RFC's `core/ai` ("provider abstraction; every plugin needs
 * it"). "Every plugin needs it" is a reason to be a *library*, not core. What
 * makes this core is two of §2's five reasons and nothing else:
 *
 *   - **Credentials.** Provider API keys live here. A plugin never holds one.
 *   - **Money.** Token spend is metered and gated per team here, at the one
 *     place that can actually enforce it.
 *
 * Everything else people associate with an "AI layer" — prompt templating,
 * retry-on-malformed-JSON, response parsing, streaming helpers — carries no
 * secret and gates no spend. That belongs in `libs/ai-kit`, where changing it
 * does not require a core review.
 */

export interface AiCallOptions {
  /** Attributed in the spend log so cost can be traced to a feature. */
  readonly actionType: string;
  readonly repositoryId?: string;
  readonly systemPrompt?: string;
  readonly signal?: AbortSignal;
  /**
   * Ask for strict JSON. Whether this maps to a provider-native mode or to
   * prompt discipline is core's problem, not the caller's.
   */
  readonly json?: boolean;
  /**
   * Preferred model tier. Deliberately not a model *id*: a plugin naming
   * `claude-opus-5` would pin core's provider choice and let a feature opt
   * itself into a more expensive tier without that being a billing decision.
   */
  readonly tier?: "fast" | "balanced" | "deep";
}

export interface AiResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Which model actually served it. Informational — do not branch on it. */
  readonly model: string;
}

export interface AiCapability {
  /**
   * Run a prompt. Rejects when the team is out of AI budget or the plan does
   * not include AI, so entitlement is enforced where it cannot be skipped.
   */
  generate(prompt: string, opts: AiCallOptions): Promise<AiResult>;

  /** Remaining budget, for a plugin that wants to degrade rather than reject. */
  budget(): Promise<{ remainingTokens: number | null; enabled: boolean }>;
}
