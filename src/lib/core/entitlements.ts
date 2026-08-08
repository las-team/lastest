import type { Plan } from "@lastest/contracts";

import { isBillingEnabled } from "@/lib/billing/enabled";
import { hasQaAgentAccess } from "@/lib/billing/feature-access";

/**
 * Plan → coarse feature gates.
 *
 * Lives here rather than in each plugin on purpose: a plugin asks
 * `team.entitlements.has("qa-agent")` instead of reading the plan and
 * reimplementing the mapping, so billing rules cannot drift across twenty
 * copies. Adding a gate is one line here and a string in one plugin.
 */
export function entitlementsFor(plan: Plan): ReadonlySet<string> {
  const billing = isBillingEnabled();
  const granted = new Set<string>();

  // Self-hosted with no Stripe key configured is deliberately unrestricted —
  // the same rule the feature-access helpers already apply.
  if (hasQaAgentAccess(plan as never, billing)) granted.add("qa-agent");
  if (!billing || plan !== "free") granted.add("ai");

  return granted;
}
