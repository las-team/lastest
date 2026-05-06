import { NextRequest, NextResponse } from 'next/server';
import { readWebhookHeaders, verifyWebhookSignature } from '@/lib/polar/webhook';
import { planForProductId, PLAN_RANK } from '@/lib/polar/plans';
import * as queries from '@/lib/db/queries';
import type { SubscriptionPlan, SubscriptionStatus } from '@/lib/db/schema';

interface PolarSubscriptionPayload {
  id: string;
  status: string;
  customer_id: string;
  product_id?: string;
  price_id?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string> | null;
  customer?: { id: string; external_id?: string | null; email?: string } | null;
}

interface PolarOrderPayload {
  id: string;
  customer_id: string;
  status: string;
  amount: number;
  product_id?: string;
}

interface PolarWebhookEnvelope {
  type: string;
  data: PolarSubscriptionPayload | PolarOrderPayload | Record<string, unknown>;
}

const SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  'incomplete',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
]);

function normalizeStatus(raw: string): SubscriptionStatus | null {
  return SUBSCRIPTION_STATUSES.has(raw as SubscriptionStatus)
    ? (raw as SubscriptionStatus)
    : null;
}

function classifyAction(
  eventType: string,
  fromPlan: SubscriptionPlan,
  toPlan: SubscriptionPlan,
): 'cancel' | 'resume' | 'upgrade' | 'downgrade' | null {
  if (eventType === 'subscription.canceled' || eventType === 'subscription.revoked') return 'cancel';
  if (eventType === 'subscription.uncanceled') return 'resume';
  if (fromPlan === toPlan) return null;
  return PLAN_RANK[toPlan] > PLAN_RANK[fromPlan] ? 'upgrade' : 'downgrade';
}

async function resolveTeamId(payload: PolarSubscriptionPayload): Promise<string | null> {
  // Preferred: external_id we set when creating the customer.
  const external = payload.customer?.external_id ?? payload.metadata?.team_id ?? null;
  if (external) return external;

  // Fallback: lookup by polar customer id (set on first webhook).
  const team = await queries.getTeamByPolarCustomerId(payload.customer_id);
  return team?.id ?? null;
}

async function applySubscriptionEvent(envelope: PolarWebhookEnvelope): Promise<{ teamId: string | null; }>
{
  const sub = envelope.data as PolarSubscriptionPayload;
  const teamId = await resolveTeamId(sub);
  if (!teamId) {
    console.warn('[polar-webhook] could not resolve team for subscription', sub.id);
    return { teamId: null };
  }

  const team = await queries.getTeam(teamId);
  if (!team) return { teamId: null };

  const status = normalizeStatus(sub.status);
  let plan: SubscriptionPlan = team.subscriptionPlan ?? 'free';
  if (sub.product_id) {
    const mapped = planForProductId(sub.product_id);
    if (mapped) plan = mapped;
  }

  // Revoked / canceled with no period left → downgrade to free.
  const ended = envelope.type === 'subscription.revoked' || status === 'canceled';
  const isTerminal = ended && !(sub.current_period_end && new Date(sub.current_period_end) > new Date());

  await queries.applyTeamSubscription(teamId, {
    polarCustomerId: sub.customer_id,
    subscriptionId: isTerminal ? null : sub.id,
    subscriptionStatus: isTerminal ? null : status,
    subscriptionPlan: isTerminal ? 'free' : plan,
    subscriptionPriceId: sub.price_id ?? null,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end) : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  });

  const fromPlan = team.subscriptionPlan ?? 'free';
  const toPlan = isTerminal ? 'free' : plan;
  const action = classifyAction(envelope.type, fromPlan, toPlan);

  await queries.logSubscriptionEvent({
    teamId,
    subscriptionId: sub.id,
    fromPlan,
    toPlan,
    fromStatus: team.subscriptionStatus ?? null,
    toStatus: isTerminal ? null : status,
    source: 'webhook',
    action,
  });

  return { teamId };
}

export async function POST(request: NextRequest) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  const rawBody = await request.text();
  const headers = readWebhookHeaders((name) => request.headers.get(name));

  const verified = verifyWebhookSignature(rawBody, headers, secret);
  if (!verified.ok) {
    console.warn('[polar-webhook] rejected:', verified.reason);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let envelope: PolarWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventId = headers.id ?? '';
  if (!eventId) {
    return NextResponse.json({ error: 'Missing webhook-id' }, { status: 400 });
  }

  const fresh = await queries.recordWebhookReceipt({
    eventId,
    type: envelope.type ?? 'unknown',
    payload: envelope as unknown as Record<string, unknown>,
  });
  if (!fresh) {
    // Polar retried — we already handled this delivery.
    return NextResponse.json({ message: 'duplicate' });
  }

  try {
    let teamId: string | null = null;
    switch (envelope.type) {
      case 'subscription.created':
      case 'subscription.active':
      case 'subscription.updated':
      case 'subscription.canceled':
      case 'subscription.revoked':
      case 'subscription.uncanceled': {
        ({ teamId } = await applySubscriptionEvent(envelope));
        break;
      }
      case 'order.paid':
      case 'order.created':
        // We don't track orders separately yet — subscription events drive plan
        // state. Leaving the case enumerated so future invoice UI is a small
        // diff rather than a re-architecture.
        break;
      default:
        // Unknown event types are still recorded above; just no-op here.
        break;
    }

    await queries.markWebhookProcessed(eventId);
    return NextResponse.json({ message: 'ok', teamId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[polar-webhook] processing failed:', message);
    await queries.markWebhookProcessed(eventId, message);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
