import { and, eq, lte } from "drizzle-orm";

import { qaAgentTriggers, type QaAgentTriggerRow } from "../schema";
import type { QaAgentDb } from "./db";

/**
 * QA agent automation config — one row per repo holding the cron schedule and
 * PR-trigger switches. `dispatchDueQaTriggers` (in `../actions.ts`, called
 * from the app's scheduler tick) fires due schedules; the GitHub webhook
 * checks `prEnabled` on PR opened/synchronize.
 *
 * Ported verbatim from `src/lib/db/queries/qa-agent-triggers.ts` (deleted
 * with the migration), re-targeted at the plugin's own table.
 */

export async function getQaAgentTriggerRow(
  db: QaAgentDb,
  repositoryId: string,
): Promise<QaAgentTriggerRow | undefined> {
  const [row] = await db
    .select()
    .from(qaAgentTriggers)
    .where(eq(qaAgentTriggers.repositoryId, repositoryId));
  return row;
}

export async function upsertQaAgentTriggerRow(
  db: QaAgentDb,
  repositoryId: string,
  teamId: string,
  patch: Partial<{
    scheduleEnabled: boolean;
    cronExpression: string | null;
    scheduleMode: QaAgentTriggerRow["scheduleMode"];
    prEnabled: boolean;
    prMode: QaAgentTriggerRow["prMode"];
    nextRunAt: Date | null;
  }>,
): Promise<QaAgentTriggerRow> {
  const existing = await getQaAgentTriggerRow(db, repositoryId);
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
export async function getDueQaAgentTriggerRows(
  db: QaAgentDb,
  now: Date = new Date(),
): Promise<QaAgentTriggerRow[]> {
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

export async function markQaAgentTriggerFiredRow(
  db: QaAgentDb,
  id: string,
  data: { nextRunAt: Date | null; lastRunAt?: Date; lastSessionId?: string },
): Promise<void> {
  await db
    .update(qaAgentTriggers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(qaAgentTriggers.id, id));
}
