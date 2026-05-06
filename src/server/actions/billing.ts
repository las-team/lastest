'use server';

import { revalidatePath } from 'next/cache';
import { requireTeamAdmin, requireTeamAccess, describeSubscription } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import {
  cancelSubscription as polarCancelSubscription,
  createCheckout,
  createCustomerPortalSession as polarCreatePortalSession,
  getOrCreateCustomer,
  resumeSubscription as polarResumeSubscription,
} from '@/lib/polar/client';
import { getProductIdForPlan } from '@/lib/polar/plans';
import type { SubscriptionPlan } from '@/lib/db/schema';

function appBaseUrl(): string {
  return (
    process.env.BETTER_AUTH_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  );
}

export async function getBillingOverview() {
  const session = await requireTeamAccess();
  const team = await queries.getTeam(session.team.id);
  if (!team) throw new Error('Team not found');
  return {
    team,
    subscription: describeSubscription(team),
  };
}

export async function startCheckout(plan: SubscriptionPlan): Promise<{ url: string }> {
  const session = await requireTeamAdmin();
  if (plan === 'free') {
    throw new Error('Free plan does not require checkout');
  }
  const productId = getProductIdForPlan(plan);
  if (!productId) {
    throw new Error(`Polar product is not configured for plan "${plan}"`);
  }

  const team = session.team;

  // Reuse the polar customer if we already created one, otherwise create with
  // external_id = team.id so subsequent webhooks can resolve back to us.
  let customerId = team.polarCustomerId ?? undefined;
  if (!customerId) {
    const customer = await getOrCreateCustomer({
      email: session.user.email,
      name: team.name,
      externalId: team.id,
    });
    customerId = customer.id;
    await queries.applyTeamSubscription(team.id, { polarCustomerId: customer.id });
  }

  const checkout = await createCheckout({
    productId,
    customerId,
    customerEmail: session.user.email,
    successUrl: `${appBaseUrl()}/settings/billing?status=success&checkout_id={CHECKOUT_ID}`,
    metadata: { team_id: team.id, plan },
  });

  return { url: checkout.url };
}

export async function openCustomerPortal(): Promise<{ url: string }> {
  const session = await requireTeamAdmin();
  if (!session.team.polarCustomerId) {
    throw new Error('No billing account exists yet — start a subscription first.');
  }
  const portal = await polarCreatePortalSession(session.team.polarCustomerId);
  return { url: portal.customer_portal_url };
}

export async function cancelTeamSubscription() {
  const session = await requireTeamAdmin();
  if (!session.team.subscriptionId) {
    throw new Error('No active subscription to cancel');
  }
  await polarCancelSubscription(session.team.subscriptionId, { atPeriodEnd: true });
  await queries.applyTeamSubscription(session.team.id, { cancelAtPeriodEnd: true });
  await queries.logSubscriptionEvent({
    teamId: session.team.id,
    subscriptionId: session.team.subscriptionId,
    fromPlan: session.team.subscriptionPlan ?? 'free',
    toPlan: session.team.subscriptionPlan ?? 'free',
    fromStatus: session.team.subscriptionStatus ?? null,
    toStatus: session.team.subscriptionStatus ?? null,
    source: 'admin',
  });
  revalidatePath('/settings/billing');
  return { success: true };
}

export async function resumeTeamSubscription() {
  const session = await requireTeamAdmin();
  if (!session.team.subscriptionId) {
    throw new Error('No subscription to resume');
  }
  await polarResumeSubscription(session.team.subscriptionId);
  await queries.applyTeamSubscription(session.team.id, { cancelAtPeriodEnd: false });
  revalidatePath('/settings/billing');
  return { success: true };
}
