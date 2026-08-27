/**
 * The Triage agent's gate.
 *
 * Three independent conditions, all of which must hold before the agent runs
 * or before its auto-run setting may be switched on:
 *
 *   1. **Plan** — Pro, via the existing `hasQaAgentAccess`, the same gate the
 *      `/agents` console and the QA agent use. Self-hosted deployments with no
 *      Stripe key have no reachable paid tier, so the plan check lifts there
 *      (that behaviour lives in `hasQaAgentAccess`, not here).
 *   2. **Setting** — the repo's `aiSettings.triageAgentEnabled`.
 *   3. **In-product AI** — `getInProductAiEnabled`, which is off for teams in
 *      ban-AI mode or teams that never switched built-in AI on.
 *
 * A team that fails the gate must see its builds behave exactly as they did
 * before the agent existed: the caller no-ops, it never throws.
 */

import {
  hasQaAgentAccess,
  qaAgentMinPlanName,
} from "@/lib/billing/feature-access";
import { isBillingEnabled } from "@/lib/billing/enabled";
import * as queries from "@/lib/db/queries";
import type { Team, TeamPlan } from "@/lib/db/schema";

/** Just the part of a team this module reads. */
export type TeamLike = Pick<Team, "plan"> | { plan: TeamPlan };

export interface TriageGateResult {
  allowed: boolean;
  /** User-facing explanation of the first failing condition. */
  reason?: string;
  /** True when only the plan check failed — the UI shows an upgrade prompt. */
  planBlocked?: boolean;
}

/**
 * Does this team's plan unlock the Triage agent at all? This is the toggle's
 * disabled state in Settings — it deliberately ignores the setting itself and
 * the in-product-AI switch, both of which the user can change.
 */
export function triageAgentAvailable(
  team: TeamLike | null | undefined,
): boolean {
  if (!team) return false;
  return hasQaAgentAccess(team.plan as TeamPlan, isBillingEnabled());
}

/**
 * Full gate. `team` is optional — when omitted it is resolved from the repo,
 * so build-completion callers that only hold a repositoryId can use this too.
 */
export async function canRunTriage(input: {
  team?: TeamLike | null;
  repositoryId: string;
}): Promise<TriageGateResult> {
  const { repositoryId } = input;
  if (!repositoryId) {
    return { allowed: false, reason: "Triage needs a repository." };
  }

  let team = input.team ?? null;
  if (!team) {
    const repo = await queries.getRepository(repositoryId);
    team = repo?.teamId ? ((await queries.getTeam(repo.teamId)) ?? null) : null;
  }

  if (!triageAgentAvailable(team)) {
    return {
      allowed: false,
      planBlocked: true,
      reason: `The Triage agent requires the ${qaAgentMinPlanName()} plan. Upgrade under Settings → Billing to unlock it.`,
    };
  }

  const settings = await queries.getAISettings(repositoryId);
  if (!settings.triageAgentEnabled) {
    return {
      allowed: false,
      reason: "The Triage agent is switched off for this repository.",
    };
  }

  if (!(await queries.getInProductAiEnabled(repositoryId))) {
    return {
      allowed: false,
      reason:
        "In-product AI is not enabled for this team — switch on built-in AI in Settings → AI.",
    };
  }

  return { allowed: true };
}
