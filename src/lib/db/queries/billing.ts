import { db } from '../index';
import {
  teams,
  polarWebhookEvents,
  subscriptionEvents,
} from '../schema';
import type {
  NewPolarWebhookEvent,
  NewSubscriptionEvent,
  SubscriptionPlan,
  SubscriptionStatus,
  Team,
} from '../schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function getTeamByPolarCustomerId(customerId: string): Promise<Team | undefined> {
  const [row] = await db.select().from(teams).where(eq(teams.polarCustomerId, customerId));
  return row;
}

export async function getTeamBySubscriptionId(subscriptionId: string): Promise<Team | undefined> {
  const [row] = await db.select().from(teams).where(eq(teams.subscriptionId, subscriptionId));
  return row;
}

export interface ApplySubscriptionUpdate {
  polarCustomerId?: string;
  subscriptionId?: string | null;
  subscriptionStatus?: SubscriptionStatus | null;
  subscriptionPlan?: SubscriptionPlan;
  subscriptionPriceId?: string | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

export async function applyTeamSubscription(teamId: string, patch: ApplySubscriptionUpdate) {
  await db
    .update(teams)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(teams.id, teamId));
}

// Webhook idempotency. Returns false if the event was already recorded — the
// caller should skip processing in that case.
export async function recordWebhookReceipt(input: NewPolarWebhookEvent): Promise<boolean> {
  const inserted = await db
    .insert(polarWebhookEvents)
    .values(input)
    .onConflictDoNothing({ target: polarWebhookEvents.eventId })
    .returning({ eventId: polarWebhookEvents.eventId });
  return inserted.length > 0;
}

export async function markWebhookProcessed(eventId: string, error?: string) {
  await db
    .update(polarWebhookEvents)
    .set({ processedAt: new Date(), error: error ?? null })
    .where(eq(polarWebhookEvents.eventId, eventId));
}

export async function logSubscriptionEvent(input: Omit<NewSubscriptionEvent, 'id' | 'createdAt'>) {
  await db.insert(subscriptionEvents).values({
    id: uuid(),
    ...input,
  });
}

export async function listSubscriptionEvents(teamId: string, limit = 50) {
  return db
    .select()
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.teamId, teamId))
    .orderBy(desc(subscriptionEvents.createdAt))
    .limit(limit);
}
