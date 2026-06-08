"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireCapability } from "@/lib/auth/capabilities";
import * as queries from "@/lib/db/queries";
import {
  planConfig,
  planRank,
  type BillingInterval,
} from "@/lib/billing/plans";
import {
  callUpgradeSubscription,
  callCancelSubscription,
  callRestoreSubscription,
  callBillingPortal,
} from "@/lib/billing/api";
import { getStripeClient } from "@/lib/billing/stripe";
import type { TeamPlan } from "@/lib/db/schema";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Stripe statuses that mean a subscription already "occupies" the team —
 * a new Checkout must NOT be started while one of these exists, or the
 * team ends up paying for two subscriptions. `incomplete` /
 * `incomplete_expired` are excluded on purpose: those are abandoned
 * checkouts that auto-expire, and blocking on them would lock a user out
 * of retrying for ~23h.
 */
const OCCUPYING_SUB_STATUSES = new Set<string>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

/**
 * Source-of-truth check against double-subscribing. The better-auth
 * plugin picks "update existing vs create new Checkout" from our local
 * `subscription` table; a brief sync gap there can make it create a
 * SECOND Stripe subscription on the same customer. We ask Stripe
 * directly so the guard never trusts stale local state.
 *
 * Returns the live Stripe subscription ids (empty when none / Stripe
 * unconfigured / no customer yet).
 */
async function liveStripeSubscriptionIds(
  customerId: string | null | undefined,
): Promise<string[]> {
  if (!customerId) return [];
  const stripe = getStripeClient();
  if (!stripe) return [];
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  return subs.data
    .filter((s) => OCCUPYING_SUB_STATUSES.has(s.status))
    .map((s) => s.id);
}

/**
 * Fail-closed tenant guard. Today every action passes
 * `session.team.id` as the `referenceId`, and `getTeamBilling` keys on
 * it, so the picked subscription always belongs to the caller. This
 * asserts that invariant explicitly so a future change to
 * `requireCapability` (e.g. accepting an external teamId) can't silently
 * mutate another team's subscription.
 */
function assertBillingOwnedByTeam(
  billing: { subscriptionReferenceId: string | null } | null,
  teamId: string,
): void {
  if (
    billing?.subscriptionReferenceId &&
    billing.subscriptionReferenceId !== teamId
  ) {
    throw new Error("Subscription does not belong to the active team.");
  }
}

/** Stripe states in which proration/plan changes will fail or misbehave. */
function assertBillable(status: string | null): void {
  if (status === "past_due" || status === "unpaid") {
    throw new Error(
      "Resolve the outstanding payment before changing your plan.",
    );
  }
}

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
  interval: BillingInterval = "monthly",
): Promise<{ url: string; success: true }> {
  const session = await requireCapability("team:admin");

  const cfg = planConfig(plan);
  if (!cfg.purchasable) {
    throw new Error(`Plan "${plan}" is not purchasable`);
  }

  // Never start a second Checkout while a live subscription exists — that
  // is how a team ends up with two subscriptions. Checked against Stripe,
  // not our local table, so a webhook sync gap can't slip a duplicate
  // through. Callers that want to CHANGE an existing plan go through
  // changeTeamPlan (in-place update), not here.
  const billing = await queries.getTeamBilling(session.team.id);
  assertBillingOwnedByTeam(billing, session.team.id);
  if ((await liveStripeSubscriptionIds(billing?.stripeCustomerId)).length > 0) {
    throw new Error(
      'This team already has a subscription. Use "Manage" to change your plan.',
    );
  }

  const result = await callUpgradeSubscription(
    {
      plan,
      annual: interval === "yearly",
      customerType: "organization",
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
    throw new Error("Upgrade did not return a checkout URL");
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
  interval: BillingInterval = "monthly",
): Promise<{ url?: string; success: boolean }> {
  const session = await requireCapability("team:admin");
  const cfg = planConfig(plan);
  if (!cfg.purchasable) {
    throw new Error(`Plan "${plan}" is not purchasable`);
  }

  const billing = await queries.getTeamBilling(session.team.id);
  assertBillingOwnedByTeam(billing, session.team.id);
  if (!billing?.stripeSubscriptionId) {
    return startCheckout(plan, interval);
  }
  // A past_due/unpaid subscription can't take a proration charge — Stripe
  // would reject the upgrade. Make the user settle up via the portal first.
  assertBillable(billing.subscriptionStatus);
  const currentInterval: BillingInterval =
    billing.billingInterval === "year" ? "yearly" : "monthly";
  if (billing.plan === plan && currentInterval === interval) {
    return { success: true };
  }

  // Downgrades (lower tier, or same tier yearly→monthly) apply at the
  // END of the billing period — the customer keeps what they paid for,
  // mirroring how cancellation works. Upgrades apply immediately with
  // proration (unused time on the old plan is credited).
  const isDowngrade =
    planRank(plan) < planRank(billing.plan) ||
    (plan === billing.plan &&
      currentInterval === "yearly" &&
      interval === "monthly");
  const billingParam = isDowngrade ? "downgrade_scheduled" : "plan_changed";

  // Pin the change to the team's real live Stripe subscription. This
  // forces the plugin's in-place update path even if our local row is
  // briefly stale (otherwise it can spin up a second subscription). If
  // Stripe shows more than one live sub the team is already in the bad
  // state — refuse rather than mutate an ambiguous target.
  const liveIds = await liveStripeSubscriptionIds(billing.stripeCustomerId);
  if (liveIds.length > 1) {
    throw new Error(
      "This team has multiple active subscriptions. Contact support to consolidate them before changing plans.",
    );
  }
  const subscriptionId = liveIds[0] ?? billing.stripeSubscriptionId;

  const result = await callUpgradeSubscription(
    {
      plan,
      annual: interval === "yearly",
      customerType: "organization",
      referenceId: session.team.id,
      subscriptionId,
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

  revalidatePath("/settings/billing");
  revalidatePath("/settings");
  if (result.url) return { url: result.url, success: true };
  return { success: true };
}

export async function openCustomerPortal(): Promise<{ url: string }> {
  const session = await requireCapability("team:admin");
  const billing = await queries.getTeamBilling(session.team.id);
  assertBillingOwnedByTeam(billing, session.team.id);
  // The portal is keyed on a Stripe customer, which only exists after a
  // first checkout. Free-tier teams (no customer) would hit a Stripe
  // error or empty portal — refuse before opening a session.
  if (!billing?.stripeCustomerId) {
    throw new Error("No billing account to manage yet.");
  }
  const result = await callBillingPortal(
    {
      referenceId: session.team.id,
      customerType: "organization",
      returnUrl: `${APP_URL}/settings#billing`,
    },
    await headers(),
  );
  if (!result.url) {
    throw new Error("Billing portal session returned no URL");
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
export async function cancelTeamSubscription(): Promise<{
  url?: string;
  success: true;
}> {
  const session = await requireCapability("team:admin");
  const billing = await queries.getTeamBilling(session.team.id);
  assertBillingOwnedByTeam(billing, session.team.id);
  if (!billing?.stripeSubscriptionId) {
    throw new Error("No active subscription to cancel.");
  }

  const result = await callCancelSubscription(
    {
      referenceId: session.team.id,
      customerType: "organization",
      returnUrl: `${APP_URL}/settings?billing=cancel_pending#billing`,
    },
    await headers(),
  );

  revalidatePath("/settings/billing");
  revalidatePath("/settings");
  if (result.url) return { url: result.url, success: true };
  return { success: true };
}

export async function resumeTeamSubscription(): Promise<{ success: true }> {
  const session = await requireCapability("team:admin");
  const billing = await queries.getTeamBilling(session.team.id);
  assertBillingOwnedByTeam(billing, session.team.id);
  if (!billing?.stripeSubscriptionId) {
    throw new Error("No subscription to resume.");
  }
  // Restoring a subscription that isn't scheduled to cancel is a no-op
  // at Stripe and confuses the UI (the resume button shouldn't show).
  // `subscriptionCancelAtPeriodEnd` already folds in portal `cancel_at`.
  if (!billing.subscriptionCancelAtPeriodEnd) {
    throw new Error("Subscription is not scheduled for cancellation.");
  }

  await callRestoreSubscription(
    {
      referenceId: session.team.id,
      customerType: "organization",
    },
    await headers(),
  );

  revalidatePath("/settings/billing");
  revalidatePath("/settings");
  return { success: true };
}
