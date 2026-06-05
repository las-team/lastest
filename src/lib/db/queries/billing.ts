/**
 * Billing-scoped queries.
 *
 * Subscription state is owned by the better-auth Stripe plugin
 * (`subscription` table). `getTeamBilling` joins teams + subscription
 * in one read. The only side table we still own is
 * `stripe_webhook_events` — a forensic log of every delivery (the
 * plugin performs the actual subscription sync; this table just lets
 * admins reconcile/replay against Stripe).
 */
import { db } from "../index";
import { teams, subscriptions, stripeWebhookEvents } from "../schema";
import { eq, sql } from "drizzle-orm";
import type {
  TeamPlan,
  SubscriptionStatus,
  NewStripeWebhookEvent,
} from "../schema";

export interface TeamBillingSnapshot {
  id: string;
  plan: TeamPlan;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionCurrentPeriodEnd: Date | null;
  /**
   * True when a cancellation is scheduled, regardless of mechanism:
   * Stripe models portal-initiated cancels as a `cancel_at` timestamp
   * and API/flag cancels as `cancel_at_period_end` — treating only the
   * boolean as truth made portal cancellations invisible in the UI.
   */
  subscriptionCancelAtPeriodEnd: boolean;
  /** Timestamp the subscription ends at when cancelled via `cancel_at`. */
  subscriptionCancelAt: Date | null;
  /**
   * Stripe subscription schedule ID — set while a downgrade is pending
   * (the plan change applies at period end via a schedule phase).
   */
  subscriptionScheduleId: string | null;
  /** Plan reported by the plugin's subscription row (may briefly differ
   *  from `teams.plan` between Stripe and the sync callback). */
  subscriptionPlan: TeamPlan | null;
  /** 'month' | 'year' — drives the monthly/yearly toggle preselection. */
  billingInterval: string | null;
  monthlyRunQuota: number | null;
  /**
   * `referenceId` of the picked subscription row (null when the team has
   * no subscription). Always equals the team id by construction, but is
   * surfaced so server actions can assert tenant ownership before
   * mutating — a fail-closed guard against the capability layer ever
   * being changed to accept an external teamId.
   */
  subscriptionReferenceId: string | null;
}

export async function getTeamBilling(
  teamId: string,
): Promise<TeamBillingSnapshot | null> {
  const [team] = await db
    .select({
      id: teams.id,
      plan: teams.plan,
      stripeCustomerId: teams.stripeCustomerId,
      monthlyRunQuota: teams.monthlyRunQuota,
    })
    .from(teams)
    .where(eq(teams.id, teamId));
  if (!team) return null;

  // Pick the most relevant subscription row. A brand-new `incomplete`
  // checkout attempt has a null `periodEnd`; without NULLS LAST Postgres
  // sorts those first under DESC and an abandoned checkout would mask the
  // team's live subscription. NULLS LAST keeps real (period-bearing) rows
  // ahead of placeholders, and among real rows the latest period wins.
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.referenceId, teamId))
    .orderBy(sql`${subscriptions.periodEnd} desc nulls last`)
    .limit(1);

  return {
    ...team,
    stripeSubscriptionId: sub?.stripeSubscriptionId ?? null,
    subscriptionStatus: sub?.status ?? null,
    subscriptionCurrentPeriodEnd: sub?.periodEnd ?? null,
    subscriptionCancelAtPeriodEnd:
      Boolean(sub?.cancelAtPeriodEnd) || sub?.cancelAt != null,
    subscriptionCancelAt: sub?.cancelAt ?? null,
    subscriptionScheduleId: sub?.stripeScheduleId ?? null,
    subscriptionPlan: (sub?.plan as TeamPlan | undefined) ?? null,
    billingInterval: sub?.billingInterval ?? null,
    subscriptionReferenceId: sub?.referenceId ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Webhook forensic log. better-auth verifies the signature and performs
// the subscription sync itself; we tap its `onEvent` callback to record
// every delivery here. The `event_id` primary key makes the insert a
// no-op on Stripe's retries, so the log stays one-row-per-event for
// later reconciliation. This is observational only — it does not gate
// the plugin's sync.
// ─────────────────────────────────────────────────────────────────────

export async function recordStripeWebhookReceipt(
  input: Omit<NewStripeWebhookEvent, "receivedAt" | "processedAt" | "error">,
): Promise<boolean> {
  const inserted = await db
    .insert(stripeWebhookEvents)
    .values(input)
    .onConflictDoNothing({ target: stripeWebhookEvents.eventId })
    .returning({ eventId: stripeWebhookEvents.eventId });
  return inserted.length > 0;
}

export async function markStripeWebhookProcessed(
  eventId: string,
  error?: string,
) {
  await db
    .update(stripeWebhookEvents)
    .set({ processedAt: new Date(), error: error ?? null })
    .where(eq(stripeWebhookEvents.eventId, eventId));
}
