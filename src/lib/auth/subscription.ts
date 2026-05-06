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

export interface UsageVsQuota {
  usedMs: number;
  testRunCount: number;
  quotaMinutes: number; // -1 = unlimited
  quotaMs: number; // -1 = unlimited
  percent: number; // 0..100, capped at 100; 0 when unlimited
  exceeded: boolean;
}

// Compare a team's current-month runtime against the plan's bundled minutes.
// `usedMs` is the value from `getTeamMonthlyUsage(...)`.
export function evaluateRuntimeUsage(team: Team, usedMs: number, testRunCount = 0): UsageVsQuota {
  const sub = describeSubscription(team);
  const quotaMinutes = sub.limits.maxRuntimeMinutesPerMonth;
  const quotaMs = quotaMinutes < 0 ? -1 : quotaMinutes * 60_000;
  if (quotaMs < 0) {
    return { usedMs, testRunCount, quotaMinutes, quotaMs, percent: 0, exceeded: false };
  }
  const percent = quotaMs > 0 ? Math.min(100, Math.round((usedMs / quotaMs) * 100)) : 0;
  return {
    usedMs,
    testRunCount,
    quotaMinutes,
    quotaMs,
    percent,
    exceeded: usedMs > quotaMs,
  };
}
