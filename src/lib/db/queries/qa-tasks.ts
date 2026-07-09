import { db } from "../index";
import { qaTasks } from "../schema";
import type { NewQaTask, QaTask, QaTaskStatus } from "../schema";
import { eq, desc, and, asc, inArray } from "drizzle-orm";

/**
 * QA agent direction queue — tasks the team (or an external agent via MCP)
 * drops for the QA agent. The dispatcher in server/actions/qa-agent.ts claims
 * queued tasks oldest-first whenever no QA session is active.
 */

export async function createQaTask(
  data: Omit<NewQaTask, "id" | "createdAt" | "updatedAt">,
): Promise<QaTask> {
  const now = new Date();
  const [row] = await db
    .insert(qaTasks)
    .values({
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function getQaTask(id: string): Promise<QaTask | undefined> {
  const [row] = await db.select().from(qaTasks).where(eq(qaTasks.id, id));
  return row;
}

/** All tasks for a repo, newest first — the board slots them into columns
 *  client-side. Terminal tasks (done/cancelled) are capped so the Done column
 *  stays a recent-history strip, not an archive. */
export async function getQaTasksByRepo(
  repositoryId: string,
  opts: { terminalLimit?: number } = {},
): Promise<QaTask[]> {
  const { terminalLimit = 25 } = opts;
  const [open, terminal] = await Promise.all([
    db
      .select()
      .from(qaTasks)
      .where(
        and(
          eq(qaTasks.repositoryId, repositoryId),
          inArray(qaTasks.status, ["queued", "working", "needs_input"]),
        ),
      )
      .orderBy(desc(qaTasks.createdAt)),
    db
      .select()
      .from(qaTasks)
      .where(
        and(
          eq(qaTasks.repositoryId, repositoryId),
          inArray(qaTasks.status, ["done", "cancelled"]),
        ),
      )
      .orderBy(desc(qaTasks.completedAt))
      .limit(terminalLimit),
  ]);
  return [...open, ...terminal];
}

/** Oldest queued task for a repo — what the dispatcher picks up next. */
export async function getNextQueuedQaTask(
  repositoryId: string,
): Promise<QaTask | undefined> {
  const [row] = await db
    .select()
    .from(qaTasks)
    .where(
      and(eq(qaTasks.repositoryId, repositoryId), eq(qaTasks.status, "queued")),
    )
    .orderBy(asc(qaTasks.createdAt))
    .limit(1);
  return row;
}

export async function updateQaTask(
  id: string,
  data: Partial<{
    status: QaTaskStatus;
    sessionId: string | null;
    agentReply: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>,
): Promise<void> {
  await db
    .update(qaTasks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(qaTasks.id, id));
}

/** The task a session is working, if any (session → task back-reference). */
export async function getQaTaskBySession(
  sessionId: string,
): Promise<QaTask | undefined> {
  const [row] = await db
    .select()
    .from(qaTasks)
    .where(eq(qaTasks.sessionId, sessionId))
    .orderBy(desc(qaTasks.createdAt))
    .limit(1);
  return row;
}
