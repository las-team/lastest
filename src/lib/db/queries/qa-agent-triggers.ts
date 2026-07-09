import { db } from "../index";
import { qaAgentTriggers } from "../schema";
import type { QaAgentTrigger } from "../schema";
import { eq, and, lte } from "drizzle-orm";

/**
 * QA agent automation config — one row per repo holding the cron schedule and
 * PR-trigger switches. The build scheduler tick fires due schedules; the
 * GitHub webhook checks prEnabled on PR opened/synchronize.
 */

export async function getQaAgentTrigger(
  repositoryId: string,
): Promise<QaAgentTrigger | undefined> {
  const [row] = await db
    .select()
    .from(qaAgentTriggers)
    .where(eq(qaAgentTriggers.repositoryId, repositoryId));
  return row;
}

export async function upsertQaAgentTrigger(
  repositoryId: string,
  teamId: string,
  patch: Partial<{
    scheduleEnabled: boolean;
    cronExpression: string | null;
    scheduleMode: QaAgentTrigger["scheduleMode"];
    prEnabled: boolean;
    prMode: QaAgentTrigger["prMode"];
    nextRunAt: Date | null;
  }>,
): Promise<QaAgentTrigger> {
  const existing = await getQaAgentTrigger(repositoryId);
  const now = new Date();
  if (existing) {
    const [row] = await db
      .update(qaAgentTriggers)
      .set({ ...patch, updatedAt: now })
      .where(eq(qaAgentTriggers.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(qaAgentTriggers)
    .values({
      id: crypto.randomUUID(),
      repositoryId,
      teamId,
      ...patch,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

/** Enabled cron triggers whose nextRunAt has passed — the scheduler's pick. */
export async function getDueQaAgentTriggers(
  now: Date = new Date(),
): Promise<QaAgentTrigger[]> {
  return db
    .select()
    .from(qaAgentTriggers)
    .where(
      and(
        eq(qaAgentTriggers.scheduleEnabled, true),
        lte(qaAgentTriggers.nextRunAt, now),
      ),
    );
}

export async function markQaAgentTriggerFired(
  id: string,
  data: { nextRunAt: Date | null; lastRunAt?: Date; lastSessionId?: string },
): Promise<void> {
  await db
    .update(qaAgentTriggers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(qaAgentTriggers.id, id));
}
