import { requireTeamAccess } from './session';
import type { Team, SubscriptionPlan } from '@/lib/db/schema';
import { getPlan, planAtLeast, type PlanLimits } from '@/lib/polar/plans';

export interface TeamSubscription {
  plan: SubscriptionPlan;
  status: Team['subscriptionStatus'];
  currentPeriodEnd: Team['currentPeriodEnd'];
  cancelAtPeriodEnd: boolean;
  isActive: boolean;
  limits: PlanLimits;
}

export function describeSubscription(team: Team): TeamSubscription {
  const plan = team.subscriptionPlan ?? 'free';
  const status = team.subscriptionStatus ?? null;
  // We treat trialing/active subscriptions as active. past_due retains access
  // through the grace period (currentPeriodEnd) until Polar revokes.
  const isActive =
    plan === 'free' ||
    status === 'active' ||
    status === 'trialing' ||
    (status === 'past_due' &&
      team.currentPeriodEnd !== null &&
      team.currentPeriodEnd !== undefined &&
      team.currentPeriodEnd.getTime() > Date.now());
  return {
    plan,
    status,
    currentPeriodEnd: team.currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(team.cancelAtPeriodEnd),
    isActive,
    limits: getPlan(plan).limits,
  };
}

export class PlanRequiredError extends Error {
  constructor(public required: SubscriptionPlan, public current: SubscriptionPlan) {
    super(`Plan "${required}" required (current: "${current}")`);
    this.name = 'PlanRequiredError';
  }
}

// Server-side gate. Use inside server actions / route handlers to block work
// the team's plan doesn't cover. Throws PlanRequiredError; callers can catch
// and redirect to /settings/billing.
export async function requirePlan(min: SubscriptionPlan) {
  const session = await requireTeamAccess();
  const sub = describeSubscription(session.team);
  if (!sub.isActive || !planAtLeast(sub.plan, min)) {
    throw new PlanRequiredError(min, sub.plan);
  }
  return { ...session, subscription: sub };
}

export function canUseFeature(team: Team, feature: keyof PlanLimits): boolean {
  const sub = describeSubscription(team);
  if (!sub.isActive) return false;
  const value = sub.limits[feature];
  return typeof value === 'boolean' ? value : value !== 0;
}
