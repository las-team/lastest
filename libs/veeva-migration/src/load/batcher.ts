/**
 * §2.5.4 / §8.1 / §8.2 batching primitives:
 *  - client-side dedupe of duplicate keys, last-wins by `SystemModstamp`;
 *  - 500-row batches cut from a stream;
 *  - hash skip against `id_map.source_hash` (the hash already includes the
 *    mapping hash, §8.2);
 *  - adaptive batch size (halve when a call exceeds the wall time, min 50,
 *    +25 % after 10 consecutive fast batches).
 */
import type { IdMapRow } from "../types";
import type { PayloadRow } from "./types";

export const VAULT_MAX_BATCH = 500;
export const MIN_BATCH_SIZE = 50;

function stamp(row: PayloadRow): string {
  return row.systemModstamp ?? "";
}

/** Keep one row per `sfdcId`: the greatest `SystemModstamp` (ties → the later row). */
export function dedupeLastWins(rows: readonly PayloadRow[]): {
  rows: PayloadRow[];
  dropped: number;
} {
  const byId = new Map<string, PayloadRow>();
  let dropped = 0;
  for (const row of rows) {
    const prev = byId.get(row.sfdcId);
    if (prev && stamp(prev) > stamp(row)) {
      dropped++;
      continue;
    }
    if (prev) dropped++;
    byId.set(row.sfdcId, row);
  }
  return { rows: [...byId.values()], dropped };
}

/**
 * Stream-level last-wins: remembers the modstamp of every id already emitted
 * (ids only) and drops a later row whose stamp is older than what was sent.
 */
export class LastWinsTracker {
  private readonly seen = new Map<string, string>();
  /** Returns false when the row is stale and must be dropped. */
  accept(row: PayloadRow): boolean {
    const prev = this.seen.get(row.sfdcId);
    if (prev !== undefined && prev > stamp(row)) return false;
    this.seen.set(row.sfdcId, stamp(row));
    return true;
  }
  get size(): number {
    return this.seen.size;
  }
}

/**
 * Cut `rows` into batches of `size()` rows (re-read per batch so the adaptive
 * size applies immediately), deduping keys inside each batch last-wins and
 * dropping stale re-deliveries across batches.
 */
export async function* cutBatches(
  rows: AsyncIterable<PayloadRow> | Iterable<PayloadRow>,
  size: () => number,
  tracker = new LastWinsTracker(),
): AsyncGenerator<PayloadRow[]> {
  let buf: PayloadRow[] = [];
  let limit = clampBatch(size());
  for await (const row of rows) {
    if (!tracker.accept(row)) continue;
    const idx = buf.findIndex((r) => r.sfdcId === row.sfdcId);
    if (idx >= 0) {
      buf[idx] = row; // tracker already established that this one is newer or equal
      continue;
    }
    buf.push(row);
    if (buf.length >= limit) {
      yield buf;
      buf = [];
      limit = clampBatch(size());
    }
  }
  if (buf.length) yield buf;
}

export function clampBatch(n: number): number {
  if (!Number.isFinite(n) || n < 1) return VAULT_MAX_BATCH;
  return Math.min(VAULT_MAX_BATCH, Math.max(1, Math.floor(n)));
}

/** §8.2 hash skip: true when the last successful load carried the same hash (dry-run rows never count). */
export function shouldHashSkip(
  row: PayloadRow,
  idRow: IdMapRow | undefined,
): boolean {
  if (!idRow || idRow.dryRun || idRow.mergedInto) return false;
  if (idRow.deletedAt) return false;
  return Boolean(idRow.sourceHash) && idRow.sourceHash === row.sourceHash;
}

export interface AdaptiveBatchOptions {
  wallTimeMs: number;
  min?: number;
  max?: number;
  /** Consecutive fast batches before growing (default 10). */
  recoverAfter?: number;
}

/** §8.1 batch-size feedback loop. */
export class AdaptiveBatchSize {
  private size: number;
  private fast = 0;
  private readonly min: number;
  private readonly max: number;
  private readonly recoverAfter: number;
  constructor(
    initial: number,
    private readonly opts: AdaptiveBatchOptions,
  ) {
    this.min = Math.max(1, opts.min ?? MIN_BATCH_SIZE);
    this.max = Math.min(VAULT_MAX_BATCH, opts.max ?? VAULT_MAX_BATCH);
    this.recoverAfter = Math.max(1, opts.recoverAfter ?? 10);
    this.size = Math.min(this.max, Math.max(this.min, clampBatch(initial)));
    if (initial < this.min) this.size = clampBatch(initial);
  }
  current(): number {
    return this.size;
  }
  /** Feed the elapsed wall time of the last call. Returns the new size. */
  record(elapsedMs: number): number {
    if (elapsedMs > this.opts.wallTimeMs) {
      this.size = Math.max(this.min, Math.floor(this.size / 2));
      this.fast = 0;
    } else if (++this.fast >= this.recoverAfter) {
      this.fast = 0;
      this.size = Math.min(this.max, Math.ceil(this.size * 1.25));
    }
    return this.size;
  }
}
