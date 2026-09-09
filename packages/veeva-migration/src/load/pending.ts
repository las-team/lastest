/**
 * §8.4 pending FK queue. Rows whose required reference cannot be resolved at
 * send time are parked in `{unit}/pending/queue.jsonl` (the payload row,
 * still in deferred form) and mirrored to the `pending_fk` table (one entry
 * per unresolved field). `retryPending` re-reads the queue after parents
 * landed; leftovers after `pendingFk.maxRounds` are `failed(UNRESOLVED_FK)`.
 */
import type { StateStore } from "../store/types";
import type { PendingFk, RowResult } from "../types";
import { pendingQueueFile, readJsonl, writeJsonl } from "./paths";
import type { UnresolvedRef } from "./resolve-refs";
import type { LoadPlan, PayloadRow } from "./types";

export interface PendingEntry {
  row: PayloadRow;
  unresolved: UnresolvedRef[];
  attempts: number;
}

export async function readPendingQueue(plan: LoadPlan): Promise<PendingEntry[]> {
  return readJsonl<PendingEntry>(pendingQueueFile(plan.runDir, plan.unit));
}

export async function writePendingQueue(
  plan: LoadPlan,
  entries: readonly PendingEntry[],
): Promise<void> {
  await writeJsonl(pendingQueueFile(plan.runDir, plan.unit), entries);
}

/** Park rows: queue file + `pending_fk` rows + `row_results.state = pending_fk`. */
export async function enqueuePending(
  plan: LoadPlan,
  store: StateStore,
  entries: readonly PendingEntry[],
  onRowResults: (rows: RowResult[]) => Promise<void>,
  now: string,
): Promise<void> {
  if (!entries.length) return;
  const existing = await readPendingQueue(plan);
  const byId = new Map(existing.map((e) => [e.row.sfdcId, e] as const));
  for (const e of entries) byId.set(e.row.sfdcId, e);
  await writePendingQueue(plan, [...byId.values()]);
  const pending: PendingFk[] = [];
  const results: RowResult[] = [];
  for (const e of entries) {
    for (const u of e.unresolved)
      pending.push({
        runId: plan.runId,
        objectKey: plan.unit.objectKey,
        country: plan.unit.country,
        sfdcId: e.row.sfdcId,
        field: u.field,
        targetObjectKey: u.objectKey,
        targetSfdcId: u.sfdcId,
        attempts: e.attempts,
      });
    results.push({
      runId: plan.runId,
      objectKey: plan.unit.objectKey,
      country: plan.unit.country,
      sfdcId: e.row.sfdcId,
      state: "pending_fk",
      errorType: "UNRESOLVED_FK",
      errorMessage: e.unresolved
        .map((u) => `${u.field} → ${u.objectKey}:${u.sfdcId}`)
        .join("; "),
      attempt: e.attempts,
      payloadHash: e.row.sourceHash,
      updatedAt: now,
    });
  }
  if (!plan.dryRun) await store.pendingFk.add(pending);
  await onRowResults(results);
}

/** Mark queue entries resolved in `pending_fk` (row re-sent). */
export async function markPendingResolved(
  plan: LoadPlan,
  store: StateStore,
  entries: readonly PendingEntry[],
  now: string,
): Promise<void> {
  if (plan.dryRun) return;
  for (const e of entries)
    for (const u of e.unresolved)
      await store.pendingFk.resolve(
        plan.runId,
        plan.unit.objectKey,
        e.row.sfdcId,
        u.field,
        now,
      );
}

/** §8.4 leftovers → `failed(UNRESOLVED_FK)`; the queue file is cleared. */
export async function failPending(
  plan: LoadPlan,
  onRowResults: (rows: RowResult[]) => Promise<void>,
  now: string,
): Promise<PendingEntry[]> {
  const entries = await readPendingQueue(plan);
  if (!entries.length) return [];
  await onRowResults(
    entries.map((e) => ({
      runId: plan.runId,
      objectKey: plan.unit.objectKey,
      country: plan.unit.country,
      sfdcId: e.row.sfdcId,
      state: "failed",
      errorType: "UNRESOLVED_FK",
      errorMessage: e.unresolved
        .map((u) => `${u.field} → ${u.objectKey}:${u.sfdcId}`)
        .join("; "),
      attempt: e.attempts,
      payloadHash: e.row.sourceHash,
      updatedAt: now,
    })),
  );
  await writePendingQueue(plan, []);
  return entries;
}
