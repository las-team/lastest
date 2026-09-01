/**
 * The Healer agent's gate.
 *
 * Four independent conditions, all of which must hold before the agent runs
 * or before its auto-run setting may be switched on:
 *
 *   1. **Plan** — Pro, via `hasQaAgentAccess`, the same gate the `/agents`
 *      console, the QA agent and the Triage agent use.
 *   2. **Setting** — the repo's `aiSettings.healerAgentEnabled`.
 *   3. **Triage on** — `aiSettings.triageAgentEnabled`. The healer only ever
 *      touches a failure the Triage agent classified as a *test* problem, so
 *      without the classifier it has nothing safe to act on.
 *   4. **In-product AI** — `getInProductAiEnabled`.
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

export type TeamLike = Pick<Team, "plan"> | { plan: TeamPlan };

export interface HealerGateResult {
  allowed: boolean;
  /** User-facing explanation of the first failing condition. */
  reason?: string;
  /** True when only the plan check failed — the UI shows an upgrade prompt. */
  planBlocked?: boolean;
}

/** Does this team's plan unlock the Healer at all? Ignores the toggles. */
export function healerAgentAvailable(
  team: TeamLike | null | undefined,
): boolean {
  if (!team) return false;
  return hasQaAgentAccess(team.plan as TeamPlan, isBillingEnabled());
}

/**
 * Full gate. `team` is optional — when omitted it is resolved from the repo,
 * so build-completion callers that only hold a repositoryId can use this too.
 *
 * `force` is the "Heal latest build" button: it lifts the `healerAgentEnabled`
 * toggle only. Plan, triage and in-product AI still apply — a manual click
 * cannot run an agent the team is not entitled to.
 */
export async function canRunHealer(input: {
  team?: TeamLike | null;
  repositoryId: string;
  force?: boolean;
}): Promise<HealerGateResult> {
  const { repositoryId } = input;
  if (!repositoryId) {
    return { allowed: false, reason: "The Healer needs a repository." };
  }

  let team = input.team ?? null;
  if (!team) {
    const repo = await queries.getRepository(repositoryId);
    team = repo?.teamId ? ((await queries.getTeam(repo.teamId)) ?? null) : null;
  }

  if (!healerAgentAvailable(team)) {
    return {
      allowed: false,
      planBlocked: true,
      reason: `The Healer requires the ${qaAgentMinPlanName()} plan. Upgrade under Settings → Billing to unlock it.`,
    };
  }

  const settings = await queries.getAISettings(repositoryId);
  if (!settings.healerAgentEnabled && !input.force) {
    return {
      allowed: false,
      reason: "The Healer is switched off for this repository.",
    };
  }

  if (!settings.triageAgentEnabled) {
    return {
      allowed: false,
      reason:
        "The Healer needs the Triage agent on — it only repairs failures triage has classified as a test problem.",
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
