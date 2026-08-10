import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";

import { db } from "../index";
import { pluginJobs, type NewPluginJob, type PluginJob } from "../schema";

/**
 * The queue behind `core/jobs`'s `JobsCapability`. See
 * `packages/db/src/schema/runs.ts` for why this is its own table rather than
 * `background_jobs`.
 */

export interface EnqueuePluginJob {
  readonly pluginId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly teamId?: string;
  readonly repositoryId?: string;
  readonly delayMs?: number;
  readonly dedupeKey?: string;
  readonly maxAttempts?: number;
}

export async function enqueuePluginJob(
  input: EnqueuePluginJob,
): Promise<PluginJob> {
  // Collapse duplicates: a pending or running row with the same key is a
  // no-op enqueue, cheaper than every plugin inventing its own debounce.
  // Scoped by pluginId + teamId (not dedupeKey alone) — a plugin picks its own
  // dedupeKey, often a predictable string like "daily-scan", and without this
  // scope a team could collide with another team's in-flight job under the
  // same plugin and get handed back its `JobRef` instead of a job of its own.
  if (input.dedupeKey) {
    const [existing] = await db
      .select()
      .from(pluginJobs)
      .where(
        and(
          eq(pluginJobs.dedupeKey, input.dedupeKey),
          eq(pluginJobs.pluginId, input.pluginId),
          input.teamId
            ? eq(pluginJobs.teamId, input.teamId)
            : isNull(pluginJobs.teamId),
          inArray(pluginJobs.status, ["pending", "running"]),
        ),
      )
      .limit(1);
    if (existing) return existing;
  }

  const now = new Date();
  const row: NewPluginJob = {
    id: crypto.randomUUID(),
    pluginId: input.pluginId,
    type: input.type,
    payload: input.payload ?? null,
    status: "pending",
    teamId: input.teamId ?? null,
    repositoryId: input.repositoryId ?? null,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    runAfter: new Date(now.getTime() + (input.delayMs ?? 0)),
    dedupeKey: input.dedupeKey ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const [created] = await db.insert(pluginJobs).values(row).returning();
  return created;
}

export async function getPluginJob(id: string): Promise<PluginJob | undefined> {
  const [row] = await db.select().from(pluginJobs).where(eq(pluginJobs.id, id));
  return row;
}

/** `null` when the id does not exist — distinct from any real status. */
export async function getPluginJobStatus(
  id: string,
): Promise<PluginJob["status"] | null> {
  const row = await getPluginJob(id);
  return row?.status ?? null;
}

/**
 * Cancel a job if it has not already finished. Silently a no-op for an
 * unknown id or one already `done`/`failed`/`cancelled` — cancellation racing
 * completion is expected, not exceptional.
 */
export async function cancelPluginJob(id: string): Promise<void> {
  await db
    .update(pluginJobs)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(pluginJobs.id, id), inArray(pluginJobs.status, ["pending"])));
}

/**
 * Claim up to `limit` due jobs for the worker loop, oldest-`runAfter` first.
 *
 * `FOR UPDATE SKIP LOCKED` inside a transaction, the same pattern already
 * used for EB pool claims in `src/server/actions/embedded-sessions.ts`. This
 * app runs one worker loop per process today, so there is normally no
 * concurrent claimant to race — but the lock costs nothing when uncontended
 * and means a second worker process (or two overlapping during a restart)
 * cannot double-claim the same row instead of quietly corrupting it.
 */
export async function claimDuePluginJobs(limit: number): Promise<PluginJob[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(pluginJobs)
      .where(
        and(
          eq(pluginJobs.status, "pending"),
          lte(pluginJobs.runAfter, new Date()),
        ),
      )
      .orderBy(asc(pluginJobs.runAfter))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];

    const ids = due.map((j) => j.id);
    await tx
      .update(pluginJobs)
      .set({ status: "running", updatedAt: new Date() })
      .where(inArray(pluginJobs.id, ids));
    return due.map((j) => ({ ...j, status: "running" as const }));
  });
}

export async function completePluginJob(id: string): Promise<void> {
  await db
    .update(pluginJobs)
    .set({ status: "done", updatedAt: new Date(), completedAt: new Date() })
    .where(eq(pluginJobs.id, id));
}

/**
 * Record a failed attempt. Re-queues with a linear backoff when attempts
 * remain, otherwise settles as `failed`. The backoff is intentionally simple —
 * no plugin depends on a specific curve today, and a fixed multiplier is
 * easier to reason about than exponential-plus-jitter for a queue with no
 * production traffic yet.
 */
export async function failPluginJobAttempt(
  id: string,
  error: string,
): Promise<void> {
  const job = await getPluginJob(id);
  if (!job) return;

  const attempts = job.attempts + 1;
  const now = new Date();
  if (attempts >= job.maxAttempts) {
    await db
      .update(pluginJobs)
      .set({
        status: "failed",
        attempts,
        lastError: error,
        updatedAt: now,
        completedAt: now,
      })
      .where(eq(pluginJobs.id, id));
    return;
  }

  const backoffMs = 5_000 * attempts;
  await db
    .update(pluginJobs)
    .set({
      status: "pending",
      attempts,
      lastError: error,
      runAfter: new Date(now.getTime() + backoffMs),
      updatedAt: now,
    })
    .where(eq(pluginJobs.id, id));
}
