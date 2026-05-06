import { db } from '../index';
import {
  teams,
  testRuns,
  repositories,
  polarWebhookEvents,
  subscriptionEvents,
  teamUsageMonthly,
  yearMonthOf,
} from '../schema';
import type {
  NewPolarWebhookEvent,
  NewSubscriptionEvent,
  SubscriptionPlan,
  SubscriptionStatus,
  Team,
  TeamUsageMonthly,
} from '../schema';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
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

// ============================================
// Monthly usage tracking (test runtime, run count)
// ============================================

export async function recordTeamRuntime(
  teamId: string,
  durationMs: number,
  at: Date = new Date(),
) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  const yearMonth = yearMonthOf(at);
  await db
    .insert(teamUsageMonthly)
    .values({
      teamId,
      yearMonth,
      runtimeMs: durationMs,
      testRunCount: 1,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [teamUsageMonthly.teamId, teamUsageMonthly.yearMonth],
      set: {
        runtimeMs: sql`${teamUsageMonthly.runtimeMs} + ${durationMs}`,
        testRunCount: sql`${teamUsageMonthly.testRunCount} + 1`,
        updatedAt: new Date(),
      },
    });
}

// Resolve team from a test_run id, then increment usage. Used by
// `createTestResult` so we don't have to thread teamId through every caller.
// No-op if the test run is orphaned (e.g. local-only repo with no team).
export async function incrementTeamRuntimeFromTestRun(
  testRunId: string,
  durationMs: number,
  at: Date = new Date(),
) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  const [row] = await db
    .select({ teamId: repositories.teamId })
    .from(testRuns)
    .innerJoin(repositories, eq(repositories.id, testRuns.repositoryId))
    .where(eq(testRuns.id, testRunId))
    .limit(1);
  if (!row?.teamId) return;
  await recordTeamRuntime(row.teamId, durationMs, at);
}

export async function getTeamMonthlyUsage(
  teamId: string,
  yearMonth: number = yearMonthOf(new Date()),
): Promise<TeamUsageMonthly | null> {
  const [row] = await db
    .select()
    .from(teamUsageMonthly)
    .where(
      and(eq(teamUsageMonthly.teamId, teamId), eq(teamUsageMonthly.yearMonth, yearMonth)),
    )
    .limit(1);
  return row ?? null;
}

export async function listTeamUsageHistory(
  teamId: string,
  fromYearMonth: number,
  toYearMonth: number = yearMonthOf(new Date()),
) {
  return db
    .select()
    .from(teamUsageMonthly)
    .where(
      and(
        eq(teamUsageMonthly.teamId, teamId),
        gte(teamUsageMonthly.yearMonth, fromYearMonth),
        lte(teamUsageMonthly.yearMonth, toYearMonth),
      ),
    )
    .orderBy(desc(teamUsageMonthly.yearMonth));
}
