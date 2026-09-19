import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";

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
 *
 * A `running` row is cancelled too. The worker sees it on its next heartbeat
 * (`heartbeatPluginJob` reports the flip) and aborts the handler's signal;
 * until then the row already reads `cancelled`, and `completePluginJob` /
 * `failPluginJobAttempt` refuse to overwrite it when the handler returns.
 */
export async function cancelPluginJob(id: string): Promise<void> {
  await db
    .update(pluginJobs)
    .set({
      status: "cancelled",
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(pluginJobs.id, id),
        inArray(pluginJobs.status, ["pending", "running"]),
      ),
    );
}

/** How long a `running` row may go without a heartbeat before it is presumed dead. */
export const PLUGIN_JOB_LEASE_MS = 5 * 60 * 1000;

/**
 * Refresh the worker's lease on a job it is executing and report whether an
 * operator cancelled it meanwhile.
 *
 * `cancelled: true` is also returned for an id that no longer exists or is no
 * longer `running` (reaped by another worker after a long GC pause, say): in
 * every such case the queue no longer considers this process the owner, and
 * the handler should stop.
 */
export async function heartbeatPluginJob(
  id: string,
): Promise<{ cancelled: boolean }> {
  const [row] = await db
    .update(pluginJobs)
    .set({ heartbeatAt: new Date() })
    .where(and(eq(pluginJobs.id, id), eq(pluginJobs.status, "running")))
    .returning({ id: pluginJobs.id });
  return { cancelled: !row };
}

/**
 * Fail the attempt of every `running` job whose lease has expired — the
 * process that claimed it died (deploy, OOM, crash) without settling the row.
 *
 * Goes through `failPluginJobAttempt` so `maxAttempts` is honoured: a job that
 * asked never to be retried (a migration run) settles as `failed` rather than
 * being re-executed, and one that allows retries is re-queued with backoff.
 * Called by the worker before it claims, so a dead job's dedupe key is
 * released before a new enqueue of the same key could be collapsed into it.
 */
export async function reapExpiredPluginJobLeases(
  leaseMs = PLUGIN_JOB_LEASE_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - leaseMs);
  const expired = await db
    .select({ id: pluginJobs.id })
    .from(pluginJobs)
    .where(
      and(
        eq(pluginJobs.status, "running"),
        or(isNull(pluginJobs.heartbeatAt), lt(pluginJobs.heartbeatAt, cutoff)),
      ),
    );
  for (const { id } of expired) {
    await failPluginJobAttempt(
      id,
      "The worker executing this job stopped heartbeating — its process most likely died.",
    );
  }
  return expired.length;
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
    const now = new Date();
    await tx
      .update(pluginJobs)
      .set({ status: "running", updatedAt: now, heartbeatAt: now })
      .where(inArray(pluginJobs.id, ids));
    return due.map((j) => ({
      ...j,
      status: "running" as const,
      heartbeatAt: now,
    }));
  });
}

/**
 * Settle a job as `done`. Only a `running` row is touched: one an operator
 * cancelled mid-flight, or a reaper failed after a lost lease, keeps that
 * verdict rather than being overwritten by the handler returning late.
 */
export async function completePluginJob(id: string): Promise<void> {
  await db
    .update(pluginJobs)
    .set({ status: "done", updatedAt: new Date(), completedAt: new Date() })
    .where(and(eq(pluginJobs.id, id), eq(pluginJobs.status, "running")));
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
  // Same rule as `completePluginJob`: a row that is no longer `running` has
  // already been settled by someone else (cancelled, or reaped) and keeps it.
  if (!job || job.status !== "running") return;

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
      .where(and(eq(pluginJobs.id, id), eq(pluginJobs.status, "running")));
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
      heartbeatAt: null,
      updatedAt: now,
    })
    .where(and(eq(pluginJobs.id, id), eq(pluginJobs.status, "running")));
}
