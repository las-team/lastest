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

import type { BrowserSession } from "./browser";

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
  /**
   * Give the model live browser tools, bound to a session the caller already
   * holds from `ctx.browser.withBrowser(...)`.
   *
   * This is the one shape that lets a plugin run an agentic browsing loop —
   * `browser_navigate`, `browser_snapshot`, `browser_click`, … — without ever
   * touching a CDP endpoint. It exists because two migrations stalled on its
   * absence: `authoring-ai` stopped outright
   * (`docs/architecture/authoring-ai-migration-result.md` §2) and `quickstart`
   * had to leave its scout module behind
   * (`docs/architecture/quickstart-migration-result.md` §1).
   *
   * **It does not relax `BrowserSession`'s guarantee, it depends on it.** The
   * plugin passes the opaque session *object*; only composition-root code can
   * turn that object back into an address, through
   * `@lastest/core-browser/internal`'s `resolveSessionCdpUrl`. There is no path
   * from this field to a string a plugin can read — passing a forged session
   * resolves to nothing and the call is rejected rather than silently
   * downgraded to a host-process browser.
   *
   * The session must still be live: core's `withBrowser` scope is what bounds
   * the tool loop, so a caller cannot hand over a session and outlive it.
   */
  readonly browserTools?: BrowserSession;
}

export interface AiResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Which model actually served it. Informational — do not branch on it. */
  readonly model: string;
  /**
   * Id of the `ai_prompt_logs` row this call wrote, when one was written.
   *
   * A pointer into core's own spend log, not spend data: a plugin can record
   * it alongside its own results so an operator can trace a bad answer back to
   * the exact prompt. It carries no token counts and no cost — those stay
   * behind `budget()`, which is the metered surface.
   */
  readonly promptLogId?: string;
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
