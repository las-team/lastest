import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

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

/**
 * What the Agents console needs from the queue: the tasks pushed back for a
 * human, plus how many are waiting to be picked up.
 *
 * Deliberately NOT `getQaTasksByRepoRows` — the console renders two numbers
 * and a short list, and it is a `force-dynamic` page hit on every navigation.
 * Pulling every task on the repo to filter two of them in JS is the shape
 * flagged on #97; a filtered select plus a `count(*)` is the same answer for
 * a fraction of the rows.
 */
export async function getQaConsoleQueueRows(
  db: QaAgentDb,
  repositoryId: string,
): Promise<{ needsInput: QaAgentTask[]; queuedCount: number }> {
  const [needsInput, queued] = await Promise.all([
    db
      .select()
      .from(qaAgentTasks)
      .where(
        and(
          eq(qaAgentTasks.repositoryId, repositoryId),
          eq(qaAgentTasks.status, "needs_input"),
        ),
      )
      .orderBy(desc(qaAgentTasks.updatedAt)),
    db
      .select({ n: count() })
      .from(qaAgentTasks)
      .where(
        and(
          eq(qaAgentTasks.repositoryId, repositoryId),
          eq(qaAgentTasks.status, "queued"),
        ),
      ),
  ]);
  return { needsInput, queuedCount: Number(queued[0]?.n ?? 0) };
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
