/**
 * Per-feature plan gating.
 *
 * Tier identity lives in `plans.ts`; this module maps individual product
 * features to the minimum plan that unlocks them. Keep the checks here so the
 * page (which renders the upgrade screen) and the server actions (which enforce
 * it) share one source of truth — a feature can't be gated in the UI but left
 * open in the action, or vice-versa.
 */
import type { TeamPlan } from "@/lib/db/schema";
import { planConfig, planRank } from "./plans";

/**
 * QA Agent is a paid, high-cost feature (multi-agent orchestration + EB time),
 * gated to the top tier. There is no dedicated "enterprise" tier today — `pro`
 * is the ceiling — so this is effectively Pro-only. Using a rank comparison
 * (rather than an equality check) means any future higher tier inherits access
 * automatically.
 */
export const QA_AGENT_MIN_PLAN: TeamPlan = "pro";

/**
 * True when the team's plan unlocks the QA Agent.
 *
 * `billingEnabled` is passed in rather than read from the environment here on
 * purpose: this module is imported by client components (the sidebar), and
 * `STRIPE_SECRET_KEY` is server-only — reading it here would evaluate to
 * `undefined` in the browser bundle and silently gate the UI differently from
 * the server actions, which is exactly the drift this module exists to prevent.
 * Server callers pass `isBillingEnabled()`; client callers receive it as a prop.
 *
 * When billing is not configured at all (self-hosted, no Stripe), there is no
 * way to reach a paid tier — every team is `free` forever — so plan gates are
 * lifted rather than locking self-hosters out of features they run on their
 * own hardware.
 */
export function hasQaAgentAccess(
  plan: TeamPlan,
  billingEnabled: boolean,
): boolean {
  if (!billingEnabled) return true;
  return planRank(plan) >= planRank(QA_AGENT_MIN_PLAN);
}

/** Human-readable name of the tier required for the QA Agent (e.g. "Pro"). */
export function qaAgentMinPlanName(): string {
  return planConfig(QA_AGENT_MIN_PLAN).name;
}

/**
 * Throw a user-facing error when a team without QA Agent access reaches a
 * QA-agent server action directly (the page renders an upgrade screen, but the
 * actions must not rely on the UI to gate access).
 */
export function assertQaAgentAccess(
  plan: TeamPlan,
  billingEnabled: boolean,
): void {
  if (!hasQaAgentAccess(plan, billingEnabled)) {
    throw new Error(
      `The QA Agent requires the ${qaAgentMinPlanName()} plan. Upgrade under Settings → Billing to unlock it.`,
    );
  }
}
