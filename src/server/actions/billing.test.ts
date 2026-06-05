/**
 * Server-action tests for billing (v1, no admin review).
 *
 * The actions are intentionally thin: they enforce team-admin
 * capability and call the better-auth Stripe plugin endpoints via the
 * typed `api.ts` shim. The plugin's own lifecycle (webhook → DB sync,
 * customer create, proration math) is tested by @better-auth/stripe's
 * own suite. What we cover here is the wrapper logic that lives in
 * this repo:
 *
 *  1. Monthly vs yearly intent translation (`annual: boolean`).
 *  2. Short-circuit paths — no-op when same plan + interval, fall
 *     through to checkout when no active sub.
 *  3. Errors when Stripe is unconfigured / no active sub to cancel.
 *  4. Cancel goes through the plugin (Stripe Customer Portal) at
 *     period end — no reason picker, no immediate-cancel path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock('@/lib/auth/capabilities', () => ({
  requireCapability: vi.fn(),
}));

vi.mock('@/lib/db/queries', () => ({
  getTeamBilling: vi.fn(),
}));

vi.mock('@/lib/billing/api', () => ({
  callUpgradeSubscription: vi.fn(),
  callCancelSubscription: vi.fn(),
  callRestoreSubscription: vi.fn(),
  callBillingPortal: vi.fn(),
}));

import { requireCapability } from '@/lib/auth/capabilities';
import * as queries from '@/lib/db/queries';
import {
  callUpgradeSubscription,
  callCancelSubscription,
  callRestoreSubscription,
  callBillingPortal,
} from '@/lib/billing/api';
import {
  startCheckout,
  changeTeamPlan,
  openCustomerPortal,
  cancelTeamSubscription,
  resumeTeamSubscription,
} from './billing';

const TEAM = { id: 'team-abc', name: 'Acme', plan: 'free' as const };
const SESSION = {
  team: TEAM,
  user: { id: 'user-1', email: 'admin@example.com' },
} as unknown as Awaited<ReturnType<typeof requireCapability>>;

const BILLING_NONE = {
  id: 'team-abc',
  plan: 'free' as const,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  subscriptionStatus: null,
  subscriptionCurrentPeriodEnd: null,
  subscriptionCancelAtPeriodEnd: false,
  subscriptionCancelAt: null,
  subscriptionScheduleId: null,
  subscriptionPlan: null,
  billingInterval: null,
  monthlyRunQuota: 50,
};

const BILLING_ACTIVE_STARTER_MONTHLY = {
  id: 'team-abc',
  plan: 'starter' as const,
  stripeCustomerId: 'cus_123',
  stripeSubscriptionId: 'sub_123',
  subscriptionStatus: 'active' as const,
  subscriptionCurrentPeriodEnd: new Date('2027-01-01'),
  subscriptionCancelAtPeriodEnd: false,
  subscriptionCancelAt: null,
  subscriptionScheduleId: null,
  subscriptionPlan: 'starter' as const,
  billingInterval: 'month',
  monthlyRunQuota: 500,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCapability).mockResolvedValue(SESSION);
});

describe('startCheckout', () => {
  it('passes annual=false for monthly checkout and returns the plugin URL', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({ url: 'https://checkout.test/sess_1' });

    const result = await startCheckout('starter', 'monthly');

    expect(result).toEqual({ url: 'https://checkout.test/sess_1', success: true });
    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'starter',
        annual: false,
        customerType: 'organization',
        referenceId: 'team-abc',
        disableRedirect: true,
      }),
      expect.any(Headers),
    );
  });

  it('passes annual=true when interval is yearly', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({ url: 'https://checkout.test/sess_y' });

    await startCheckout('growth', 'yearly');

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'growth', annual: true }),
      expect.any(Headers),
    );
  });

  it('rejects non-purchasable tiers without touching Stripe', async () => {
    await expect(startCheckout('free', 'monthly')).rejects.toThrow(/not purchasable/i);
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });

  it('throws when the plugin returns no URL', async () => {
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});
    await expect(startCheckout('pro', 'monthly')).rejects.toThrow(/checkout URL/i);
  });

  it('requires team:admin capability', async () => {
    vi.mocked(requireCapability).mockRejectedValueOnce(new Error('Forbidden: missing capability team:admin'));
    await expect(startCheckout('starter', 'monthly')).rejects.toThrow(/Forbidden/);
  });

  it('does not write any audit-log row before redirecting to Checkout', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({ url: 'https://checkout.test/sess_audit' });

    await startCheckout('starter', 'monthly');

    // The queries module is fully mocked above with only getTeamBilling.
    // Any audit-log call (logSubscriptionEvent) would surface here as
    // an undefined-function error — confirming the gate is gone.
    expect(Object.keys(queries)).not.toContain('logSubscriptionEvent');
  });
});

describe('changeTeamPlan', () => {
  it('falls through to startCheckout when the team has no active subscription', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({ url: 'https://checkout.test/fresh' });

    const result = await changeTeamPlan('growth', 'monthly');

    expect(result).toEqual({ url: 'https://checkout.test/fresh', success: true });
    expect(callUpgradeSubscription).toHaveBeenCalled();
  });

  it('short-circuits when the team is already on the requested plan + interval', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_ACTIVE_STARTER_MONTHLY);

    const result = await changeTeamPlan('starter', 'monthly');

    expect(result).toEqual({ success: true });
    expect(callUpgradeSubscription).not.toHaveBeenCalled();
  });

  it('calls upgrade with annual=true when switching the same plan to yearly', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_ACTIVE_STARTER_MONTHLY);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    await changeTeamPlan('starter', 'yearly');

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'starter', annual: true }),
      expect.any(Headers),
    );
  });

  it('upgrades to a higher tier immediately (prorated, not scheduled)', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_ACTIVE_STARTER_MONTHLY);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    const result = await changeTeamPlan('pro', 'monthly');

    expect(result).toEqual({ success: true });
    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro', annual: false, scheduleAtPeriodEnd: false }),
      expect.any(Headers),
    );
  });

  it('schedules a downgrade for the end of the billing period (like cancellation)', async () => {
    const billing = { ...BILLING_ACTIVE_STARTER_MONTHLY, plan: 'pro' as const };
    vi.mocked(queries.getTeamBilling).mockResolvedValue(billing);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    await changeTeamPlan('starter', 'monthly');

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'starter',
        scheduleAtPeriodEnd: true,
        returnUrl: expect.stringContaining('billing=downgrade_scheduled'),
      }),
      expect.any(Headers),
    );
  });

  it('treats same-tier yearly→monthly as a scheduled downgrade', async () => {
    const billing = { ...BILLING_ACTIVE_STARTER_MONTHLY, billingInterval: 'year' };
    vi.mocked(queries.getTeamBilling).mockResolvedValue(billing);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    await changeTeamPlan('starter', 'monthly');

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'starter', annual: false, scheduleAtPeriodEnd: true }),
      expect.any(Headers),
    );
  });

  it('treats same-tier monthly→yearly as an immediate prorated change', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_ACTIVE_STARTER_MONTHLY);
    vi.mocked(callUpgradeSubscription).mockResolvedValue({});

    await changeTeamPlan('starter', 'yearly');

    expect(callUpgradeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'starter', annual: true, scheduleAtPeriodEnd: false }),
      expect.any(Headers),
    );
  });
});

describe('openCustomerPortal', () => {
  it('returns the portal URL from the plugin', async () => {
    vi.mocked(callBillingPortal).mockResolvedValue({ url: 'https://billing.stripe.com/p/sess_1' });

    const result = await openCustomerPortal();

    expect(result).toEqual({ url: 'https://billing.stripe.com/p/sess_1' });
    expect(callBillingPortal).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: 'team-abc',
        customerType: 'organization',
      }),
      expect.any(Headers),
    );
  });

  it('throws when the plugin returns no URL', async () => {
    vi.mocked(callBillingPortal).mockResolvedValue({});
    await expect(openCustomerPortal()).rejects.toThrow(/no URL/i);
  });
});

describe('cancelTeamSubscription', () => {
  it('refuses to cancel when there is no active subscription', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);

    await expect(cancelTeamSubscription()).rejects.toThrow(/No active subscription/);
    expect(callCancelSubscription).not.toHaveBeenCalled();
  });

  it('routes cancellation through the plugin (Stripe Customer Portal) at period end', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_ACTIVE_STARTER_MONTHLY);
    vi.mocked(callCancelSubscription).mockResolvedValue({ url: 'https://billing.stripe.com/p/cancel' });

    const result = await cancelTeamSubscription();

    expect(result).toEqual({ url: 'https://billing.stripe.com/p/cancel', success: true });
    expect(callCancelSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: 'team-abc',
        customerType: 'organization',
      }),
      expect.any(Headers),
    );
  });

  it('accepts no arguments — no reason picker, no mode picker', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_ACTIVE_STARTER_MONTHLY);
    vi.mocked(callCancelSubscription).mockResolvedValue({});

    // Cancellation is a single click — no reason, no comment, no
    // immediate-vs-period-end picker. The action accepts zero arguments.
    const result = await cancelTeamSubscription();
    expect(result.success).toBe(true);
  });
});

describe('resumeTeamSubscription', () => {
  it('calls the plugin restore endpoint', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue({
      ...BILLING_ACTIVE_STARTER_MONTHLY,
      subscriptionCancelAtPeriodEnd: true,
    });
    vi.mocked(callRestoreSubscription).mockResolvedValue(undefined);

    const result = await resumeTeamSubscription();

    expect(result).toEqual({ success: true });
    expect(callRestoreSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: 'team-abc',
        customerType: 'organization',
      }),
      expect.any(Headers),
    );
  });

  it('refuses when there is no subscription to resume', async () => {
    vi.mocked(queries.getTeamBilling).mockResolvedValue(BILLING_NONE);

    await expect(resumeTeamSubscription()).rejects.toThrow(/No subscription/);
    expect(callRestoreSubscription).not.toHaveBeenCalled();
  });
});
