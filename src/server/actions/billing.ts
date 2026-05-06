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
  type CancellationReason,
} from '@/lib/polar/client';
import { getProductIdForPlan } from '@/lib/polar/plans';
import type { SubscriptionPlan } from '@/lib/db/schema';

export const CANCELLATION_REASONS: ReadonlyArray<{ id: CancellationReason; label: string }> = [
  { id: 'too_expensive', label: 'Too expensive' },
  { id: 'missing_features', label: 'Missing features' },
  { id: 'switched_service', label: 'Switching to another service' },
  { id: 'unused', label: "Don't use it enough" },
  { id: 'too_complex', label: 'Too complex / hard to use' },
  { id: 'low_quality', label: 'Quality not good enough' },
  { id: 'customer_service', label: 'Customer service' },
  { id: 'other', label: 'Other' },
];

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

export interface CancelSubscriptionInput {
  // 'period_end' keeps access until current_period_end; 'immediate' terminates
  // the subscription right now (Polar prorates).
  mode: 'period_end' | 'immediate';
  reason?: CancellationReason;
  comment?: string;
}

export async function cancelTeamSubscription(input: CancelSubscriptionInput) {
  const session = await requireTeamAdmin();
  if (!session.team.subscriptionId) {
    throw new Error('No active subscription to cancel');
  }

  const trimmedComment = input.comment?.trim().slice(0, 1000);
  const atPeriodEnd = input.mode === 'period_end';

  await polarCancelSubscription(session.team.subscriptionId, {
    atPeriodEnd,
    reason: input.reason,
    comment: trimmedComment,
  });

  if (atPeriodEnd) {
    // Plan stays the same until period end; webhook will downgrade later.
    await queries.applyTeamSubscription(session.team.id, { cancelAtPeriodEnd: true });
  } else {
    // Hard cancel: drop access immediately. The `subscription.revoked`
    // webhook will fire shortly after and confirm the same state, but we
    // don't want to leave the UI showing paid features in the meantime.
    await queries.applyTeamSubscription(session.team.id, {
      subscriptionId: null,
      subscriptionStatus: null,
      subscriptionPlan: 'free',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  }

  await queries.logSubscriptionEvent({
    teamId: session.team.id,
    subscriptionId: session.team.subscriptionId,
    fromPlan: session.team.subscriptionPlan ?? 'free',
    toPlan: atPeriodEnd ? (session.team.subscriptionPlan ?? 'free') : 'free',
    fromStatus: session.team.subscriptionStatus ?? null,
    toStatus: atPeriodEnd ? (session.team.subscriptionStatus ?? null) : null,
    source: 'admin',
    action: 'cancel',
    cancellationReason: input.reason ?? null,
    cancellationComment: trimmedComment ?? null,
    actorUserId: session.user.id,
  });
  revalidatePath('/settings/billing');
  return { success: true, mode: input.mode };
}

export async function resumeTeamSubscription() {
  const session = await requireTeamAdmin();
  if (!session.team.subscriptionId) {
    throw new Error('No subscription to resume');
  }
  await polarResumeSubscription(session.team.subscriptionId);
  await queries.applyTeamSubscription(session.team.id, { cancelAtPeriodEnd: false });
  await queries.logSubscriptionEvent({
    teamId: session.team.id,
    subscriptionId: session.team.subscriptionId,
    fromPlan: session.team.subscriptionPlan ?? 'free',
    toPlan: session.team.subscriptionPlan ?? 'free',
    fromStatus: session.team.subscriptionStatus ?? null,
    toStatus: session.team.subscriptionStatus ?? null,
    source: 'admin',
    action: 'resume',
    actorUserId: session.user.id,
  });
  revalidatePath('/settings/billing');
  return { success: true };
}
