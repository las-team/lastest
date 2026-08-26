import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { QaTaskStatus, QaTaskTestRef } from "../types";
import { qaAgentTasks, type NewQaAgentTask, type QaAgentTask } from "../schema";
import type { QaAgentDb } from "./db";

/**
 * QA agent direction queue — tasks the team (or an external agent via MCP)
 * drops for the QA agent. The dispatcher in `../actions.ts` claims queued
 * tasks oldest-first whenever no QA session is active.
 *
 * Ported verbatim from `src/lib/db/queries/qa-tasks.ts` (deleted with the
 * migration), re-targeted at the plugin's own `qa_agent_tasks` table through
 * the scoped handle — every function takes the db explicitly because callers
 * split between `ctx.data` (actions) and the wiring slot (reads, dispatch).
 */

export async function createQaTaskRow(
  db: QaAgentDb,
  data: Omit<NewQaAgentTask, "id" | "createdAt" | "updatedAt">,
): Promise<QaAgentTask> {
  const now = new Date();
  const [row] = await db
    .insert(qaAgentTasks)
    .values({
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function getQaTaskRow(
  db: QaAgentDb,
  id: string,
): Promise<QaAgentTask | undefined> {
  const [row] = await db
    .select()
    .from(qaAgentTasks)
    .where(eq(qaAgentTasks.id, id));
  return row;
}

/** All tasks for a repo, newest first — the board slots them into columns
 *  client-side. Terminal tasks (done/cancelled) are capped so the Done column
 *  stays a recent-history strip, not an archive. */
export async function getQaTasksByRepoRows(
  db: QaAgentDb,
  repositoryId: string,
  opts: { terminalLimit?: number } = {},
): Promise<QaAgentTask[]> {
  const { terminalLimit = 25 } = opts;
  const [open, terminal] = await Promise.all([
    db
      .select()
      .from(qaAgentTasks)
      .where(
        and(
          eq(qaAgentTasks.repositoryId, repositoryId),
          inArray(qaAgentTasks.status, ["queued", "working", "needs_input"]),
        ),
      )
      .orderBy(desc(qaAgentTasks.createdAt)),
    db
      .select()
      .from(qaAgentTasks)
      .where(
        and(
          eq(qaAgentTasks.repositoryId, repositoryId),
          inArray(qaAgentTasks.status, ["done", "cancelled"]),
        ),
      )
      .orderBy(desc(qaAgentTasks.completedAt))
      .limit(terminalLimit),
  ]);
  return [...open, ...terminal];
}

/** Oldest queued task for a repo — what the dispatcher picks up next. */
export async function getNextQueuedQaTaskRow(
  db: QaAgentDb,
  repositoryId: string,
): Promise<QaAgentTask | undefined> {
  const [row] = await db
    .select()
    .from(qaAgentTasks)
    .where(
      and(
        eq(qaAgentTasks.repositoryId, repositoryId),
        eq(qaAgentTasks.status, "queued"),
      ),
    )
    .orderBy(asc(qaAgentTasks.createdAt))
    .limit(1);
  return row;
}

export async function updateQaTaskRow(
  db: QaAgentDb,
  id: string,
  data: Partial<{
    status: QaTaskStatus;
    sessionId: string | null;
    agentReply: string | null;
    tests: QaTaskTestRef[] | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>,
): Promise<void> {
  await db
    .update(qaAgentTasks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(qaAgentTasks.id, id));
}
