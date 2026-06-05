/**
 * Webhook → app sync for subscription lifecycle events.
 *
 * The better-auth Stripe plugin owns the `subscription` table; these
 * handlers mirror the *effect* of each event onto our own `teams` row
 * (plan + run quota) so the capability layer sees the new tier on the
 * very next request — no admin review, no audit gate.
 *
 * Extracted out of the plugin config in `src/lib/auth/auth.ts` so the
 * mapping logic is unit-testable without standing up better-auth.
 */
import * as queries from '@/lib/db/queries';
import { planConfig } from '@/lib/billing/plans';
import { resolvePlanForPriceId, getCatalog } from '@/lib/billing/catalog';
import type { TeamPlan } from '@/lib/db/schema';

/**
 * Run-minute quota for a tier — live Stripe product metadata first
 * (dashboard edits apply on the next billing event), static catalog as
 * fallback (free tier + Stripe-unreachable).
 */
async function quotaForPlan(plan: TeamPlan): Promise<number> {
  try {
    const live = (await getCatalog()).find((p) => p.id === plan);
    if (live?.live) return live.monthlyRunQuota;
  } catch {
    // fall through to the static catalog
  }
  return planConfig(plan).monthlyRunQuota;
}

/**
 * Set `teams.plan` + `monthlyRunQuota` to match a billing event.
 * No-op when the team is gone or already in sync (so duplicate/retried
 * webhook deliveries don't churn the row). Quota is re-checked even on
 * a same-plan event so dashboard quota edits propagate.
 */
export async function syncTeamPlanForBilling(teamId: string, plan: TeamPlan): Promise<void> {
  const team = await queries.getTeam(teamId);
  if (!team) return;
  const monthlyRunQuota = await quotaForPlan(plan);
  if (team.plan === plan && team.monthlyRunQuota === monthlyRunQuota) return;
  await queries.updateTeam(teamId, {
    plan,
    monthlyRunQuota,
  });
}

// Narrowed shapes of the @better-auth/stripe event payloads — we only
// read the fields we sync on, so we don't depend on the plugin's types.
interface SubscriptionCompletePayload {
  subscription: { referenceId: string };
  plan: { name?: string | null };
}
interface SubscriptionUpdatePayload {
  stripeSubscription: { items: { data: Array<{ price: { id: string } }> } };
  subscription: { referenceId: string; plan?: string | null };
}
interface SubscriptionDeletedPayload {
  subscription: { referenceId: string };
}

/** Payment landed for a fresh subscription — flip the team to the paid tier. */
export async function handleSubscriptionComplete(
  { subscription, plan }: SubscriptionCompletePayload,
): Promise<void> {
  const planId = (plan.name as TeamPlan) ?? 'free';
  await syncTeamPlanForBilling(subscription.referenceId, planId);
}

/**
 * Subscription changed (plan switch, interval change, renewal). Prefer
 * mapping the live Stripe price ID back to a tier — that's authoritative
 * even mid-proration — and fall back to the plugin's mirrored plan name.
 */
export async function handleSubscriptionUpdate(
  { stripeSubscription, subscription }: SubscriptionUpdatePayload,
): Promise<void> {
  const priceId = stripeSubscription.items.data[0]?.price.id;
  const lookup = priceId ? await resolvePlanForPriceId(priceId) : null;
  const planId = lookup?.plan ?? (subscription.plan as TeamPlan | undefined);
  if (planId) await syncTeamPlanForBilling(subscription.referenceId, planId);
}

/** Subscription ended (cancelled past period end / unpaid) — drop to free. */
export async function handleSubscriptionDeleted(
  { subscription }: SubscriptionDeletedPayload,
): Promise<void> {
  await syncTeamPlanForBilling(subscription.referenceId, 'free');
}
