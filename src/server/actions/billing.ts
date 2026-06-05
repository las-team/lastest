'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requireCapability } from '@/lib/auth/capabilities';
import * as queries from '@/lib/db/queries';
import { planConfig, planRank, type BillingInterval } from '@/lib/billing/plans';
import {
  callUpgradeSubscription,
  callCancelSubscription,
  callRestoreSubscription,
  callBillingPortal,
} from '@/lib/billing/api';
import type { TeamPlan } from '@/lib/db/schema';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

/**
 * Subscribe-or-switch entry point. Calls the better-auth Stripe
 * plugin's `subscription/upgrade` endpoint — which creates a Stripe
 * Checkout session for new subscribers OR updates an existing
 * subscription with proration for plan changes.
 *
 * After successful payment, the plugin's webhook handler syncs the
 * team's plan immediately — no admin review, no audit gate. The user
 * lands back on /settings#billing with the new plan live.
 */
export async function startCheckout(
  plan: TeamPlan,
  interval: BillingInterval = 'monthly',
): Promise<{ url: string; success: true }> {
  const session = await requireCapability('team:admin');

  const cfg = planConfig(plan);
  if (!cfg.purchasable) {
    throw new Error(`Plan "${plan}" is not purchasable`);
  }

  const result = await callUpgradeSubscription(
    {
      plan,
      annual: interval === 'yearly',
      customerType: 'organization',
      referenceId: session.team.id,
      successUrl: `${APP_URL}/settings?checkout=success#billing`,
      cancelUrl: `${APP_URL}/settings?checkout=cancelled#billing`,
      // Used instead of successUrl when the plugin routes through the
      // billing portal (plan change on an existing subscription).
      returnUrl: `${APP_URL}/settings?billing=plan_changed#billing`,
      disableRedirect: true,
    },
    await headers(),
  );

  if (!result.url) {
    throw new Error('Upgrade did not return a checkout URL');
  }
  return { url: result.url, success: true };
}

/**
 * Change plan (or billing interval) on an active subscription.
 * Delegates to the same plugin endpoint — when the team already has a
 * subscription, the plugin mutates it in place with proration; when
 * not, falls through to a fresh checkout.
 */
export async function changeTeamPlan(
  plan: TeamPlan,
  interval: BillingInterval = 'monthly',
): Promise<{ url?: string; success: boolean }> {
  const session = await requireCapability('team:admin');
  const cfg = planConfig(plan);
  if (!cfg.purchasable) {
    throw new Error(`Plan "${plan}" is not purchasable`);
  }

  const billing = await queries.getTeamBilling(session.team.id);
  if (!billing?.stripeSubscriptionId) {
    return startCheckout(plan, interval);
  }
  const currentInterval: BillingInterval = billing.billingInterval === 'year' ? 'yearly' : 'monthly';
  if (billing.plan === plan && currentInterval === interval) {
    return { success: true };
  }

  // Downgrades (lower tier, or same tier yearly→monthly) apply at the
  // END of the billing period — the customer keeps what they paid for,
  // mirroring how cancellation works. Upgrades apply immediately with
  // proration (unused time on the old plan is credited).
  const isDowngrade =
    planRank(plan) < planRank(billing.plan) ||
    (plan === billing.plan && currentInterval === 'yearly' && interval === 'monthly');
  const billingParam = isDowngrade ? 'downgrade_scheduled' : 'plan_changed';

  const result = await callUpgradeSubscription(
    {
      plan,
      annual: interval === 'yearly',
      customerType: 'organization',
      referenceId: session.team.id,
      scheduleAtPeriodEnd: isDowngrade,
      successUrl: `${APP_URL}/settings?billing=${billingParam}#billing`,
      cancelUrl: `${APP_URL}/settings#billing`,
      // The portal path (existing subscription) returns here — without
      // it the plugin falls back to "/" and strands the user on the
      // dashboard after confirming the plan change.
      returnUrl: `${APP_URL}/settings?billing=${billingParam}#billing`,
      disableRedirect: true,
    },
    await headers(),
  );

  revalidatePath('/settings/billing');
  revalidatePath('/settings');
  if (result.url) return { url: result.url, success: true };
  return { success: true };
}

export async function openCustomerPortal(): Promise<{ url: string }> {
  const session = await requireCapability('team:admin');
  const result = await callBillingPortal(
    {
      referenceId: session.team.id,
      customerType: 'organization',
      returnUrl: `${APP_URL}/settings#billing`,
    },
    await headers(),
  );
  if (!result.url) {
    throw new Error('Billing portal session returned no URL');
  }
  return { url: result.url };
}

/**
 * Cancel the team's subscription at period end. The plugin opens the
 * Stripe customer portal where the user confirms; we don't collect a
 * cancellation reason. Access continues through `subscriptionCurrentPeriodEnd`;
 * the plugin's `customer.subscription.updated` webhook flips
 * `cancelAtPeriodEnd` so the UI reflects the pending state immediately.
 */
export async function cancelTeamSubscription(): Promise<{ url?: string; success: true }> {
  const session = await requireCapability('team:admin');
  const billing = await queries.getTeamBilling(session.team.id);
  if (!billing?.stripeSubscriptionId) {
    throw new Error('No active subscription to cancel.');
  }

  const result = await callCancelSubscription(
    {
      referenceId: session.team.id,
      customerType: 'organization',
      returnUrl: `${APP_URL}/settings?billing=cancel_pending#billing`,
    },
    await headers(),
  );

  revalidatePath('/settings/billing');
  revalidatePath('/settings');
  if (result.url) return { url: result.url, success: true };
  return { success: true };
}

export async function resumeTeamSubscription(): Promise<{ success: true }> {
  const session = await requireCapability('team:admin');
  const billing = await queries.getTeamBilling(session.team.id);
  if (!billing?.stripeSubscriptionId) {
    throw new Error('No subscription to resume.');
  }

  await callRestoreSubscription(
    {
      referenceId: session.team.id,
      customerType: 'organization',
    },
    await headers(),
  );

  revalidatePath('/settings/billing');
  revalidatePath('/settings');
  return { success: true };
}
