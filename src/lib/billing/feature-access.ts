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

/** True when the team's plan unlocks the QA Agent. */
export function hasQaAgentAccess(plan: TeamPlan): boolean {
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
export function assertQaAgentAccess(plan: TeamPlan): void {
  if (!hasQaAgentAccess(plan)) {
    throw new Error(
      `The QA Agent requires the ${qaAgentMinPlanName()} plan. Upgrade under Settings → Billing to unlock it.`,
    );
  }
}
