/**
 * The queue's lease and cancellation semantics, against a real `plugin_jobs`
 * table.
 *
 * These are the properties the second review of the Veeva migration PR found
 * missing, and every one of them is a database predicate rather than logic
 * the unit tests in `core/jobs` can see:
 *
 *  - cancel reaches a `running` row, and the worker's heartbeat reports it;
 *  - a `running` row whose lease expired is failed by the reaper, honouring
 *    `maxAttempts: 1` (no re-execution);
 *  - `complete` / `failAttempt` never overwrite a row that is no longer
 *    `running`;
 *  - a reaped job releases its dedupe key so the next enqueue gets a new job.
 *
 * Skipped unless `DATABASE_URL` is set:
 *
 *     docker compose up -d && pnpm db:push && pnpm test:integration
 */

import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { pluginJobs } from "@/lib/db/schema";

const maybe = process.env.DATABASE_URL ? describe : describe.skip;

const PLUGIN = "lease-test";
const created: string[] = [];

async function enqueue(dedupeKey: string, maxAttempts = 1) {
  const job = await queries.enqueuePluginJob({
    pluginId: PLUGIN,
    type: `${PLUGIN}.run`,
    payload: { k: dedupeKey },
    dedupeKey,
    maxAttempts,
  });
  created.push(job.id);
  return job;
}

async function claimOne(id: string) {
  // Claim exactly this job: other tests' rows may be due at the same time.
  const claimed = await queries.claimDuePluginJobs(50);
  const mine = claimed.find((j) => j.id === id);
  // Release anything else we may have grabbed so other suites are unaffected.
  for (const j of claimed) {
    if (j.id !== id && !created.includes(j.id)) {
      await db
        .update(pluginJobs)
        .set({ status: "pending", heartbeatAt: null })
        .where(eq(pluginJobs.id, j.id));
    }
  }
  expect(mine, `job ${id} should be claimable`).toBeDefined();
  return mine!;
}

async function status(id: string) {
  return (await queries.getPluginJob(id))?.status;
}

maybe("plugin_jobs lease + cancel", () => {
  afterAll(async () => {
    if (created.length) {
      await db.delete(pluginJobs).where(inArray(pluginJobs.id, created));
    }
  });

  it("stamps the lease at claim and refreshes it on heartbeat", async () => {
    const job = await enqueue(`hb-${Date.now()}`);
    expect(job.heartbeatAt).toBeNull();

    const claimed = await claimOne(job.id);
    expect(claimed.heartbeatAt).toBeInstanceOf(Date);

    const before = (await queries.getPluginJob(job.id))!.heartbeatAt!;
    await new Promise((r) => setTimeout(r, 15));
    const beat = await queries.heartbeatPluginJob(job.id);
    expect(beat).toEqual({ cancelled: false });
    const after = (await queries.getPluginJob(job.id))!.heartbeatAt!;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it("cancels a running job and the next heartbeat reports it", async () => {
    const job = await enqueue(`cancel-${Date.now()}`);
    await claimOne(job.id);
    expect(await status(job.id)).toBe("running");

    await queries.cancelPluginJob(job.id);
    expect(await status(job.id)).toBe("cancelled");
    expect(await queries.heartbeatPluginJob(job.id)).toEqual({
      cancelled: true,
    });

    // The handler returning late must not resurrect the row.
    await queries.completePluginJob(job.id);
    expect(await status(job.id)).toBe("cancelled");
    await queries.failPluginJobAttempt(job.id, "late failure");
    expect(await status(job.id)).toBe("cancelled");
  });

  it("reaps an expired lease as failed when maxAttempts is 1", async () => {
    const job = await enqueue(`reap-${Date.now()}`, 1);
    await claimOne(job.id);
    // Simulate a worker that died five minutes ago.
    await db
      .update(pluginJobs)
      .set({ heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(pluginJobs.id, job.id));

    const reaped = await queries.reapExpiredPluginJobLeases(5 * 60 * 1000);
    expect(reaped).toBeGreaterThanOrEqual(1);

    const row = (await queries.getPluginJob(job.id))!;
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/stopped heartbeating/);

    // The dedupe key is released: the same key now yields a NEW job.
    const again = await enqueue(job.dedupeKey!);
    expect(again.id).not.toBe(job.id);
    expect(again.status).toBe("pending");
  });

  it("re-queues an expired lease with backoff when attempts remain", async () => {
    const job = await enqueue(`retry-${Date.now()}`, 3);
    await claimOne(job.id);
    await db
      .update(pluginJobs)
      .set({ heartbeatAt: null })
      .where(eq(pluginJobs.id, job.id));

    await queries.reapExpiredPluginJobLeases(5 * 60 * 1000);

    const row = (await queries.getPluginJob(job.id))!;
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.heartbeatAt).toBeNull();
    expect(row.runAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not reap a running job whose lease is fresh", async () => {
    const job = await enqueue(`fresh-${Date.now()}`);
    await claimOne(job.id);
    await queries.reapExpiredPluginJobLeases(5 * 60 * 1000);
    expect(await status(job.id)).toBe("running");
    await queries.completePluginJob(job.id);
    expect(await status(job.id)).toBe("done");
  });
});
