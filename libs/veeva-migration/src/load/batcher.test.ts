import { describe, expect, it } from "vitest";
import { to18 } from "../transform/ids";
import type { IdMapRow } from "../types";
import {
  AdaptiveBatchSize,
  LastWinsTracker,
  MIN_BATCH_SIZE,
  VAULT_MAX_BATCH,
  clampBatch,
  cutBatches,
  dedupeLastWins,
  shouldHashSkip,
} from "./batcher";
import type { PayloadRow } from "./types";

const A = to18("001000000000001");
const B = to18("001000000000002");

function row(sfdcId: string, stamp: string, hash = "h"): PayloadRow {
  return {
    sfdcId,
    systemModstamp: stamp,
    payload: { legacy_crm_id__v: sfdcId },
    sourceHash: hash,
    diagnostics: [],
  };
}

async function* stream<T>(items: T[]): AsyncIterable<T> {
  for (const i of items) yield i;
}

async function collect(
  gen: AsyncIterable<PayloadRow[]>,
): Promise<PayloadRow[][]> {
  const out: PayloadRow[][] = [];
  for await (const b of gen) out.push(b);
  return out;
}

describe("batcher (§2.5.4 / §8.1 / §8.2)", () => {
  it("dedupes duplicate keys last-wins by SystemModstamp (ties → the later row)", () => {
    const r = dedupeLastWins([
      row(A, "2026-01-02T00:00:00Z", "new"),
      row(A, "2026-01-01T00:00:00Z", "old"),
      row(B, "2026-01-01T00:00:00Z"),
      row(B, "2026-01-01T00:00:00Z", "tie"),
    ]);
    expect(r.dropped).toBe(2);
    expect(r.rows.map((x) => [x.sfdcId, x.sourceHash])).toEqual([
      [A, "new"],
      [B, "tie"],
    ]);
  });

  it("cuts 500-row batches by default and re-reads the size per batch", async () => {
    const rows = Array.from({ length: 1203 }, (_, i) =>
      row(
        to18(`001${String(i + 1).padStart(12, "0")}`),
        "2026-01-01T00:00:00Z",
      ),
    );
    const batches = await collect(cutBatches(stream(rows), () => 0)); // 0 → default 500
    expect(batches.map((b) => b.length)).toEqual([500, 500, 203]);
    const sizes = [3, 2, 1];
    const shrinking = await collect(
      cutBatches(rows.slice(0, 7), () => sizes.shift() ?? 1),
    );
    expect(shrinking.map((b) => b.length)).toEqual([3, 2, 1, 1]);
    const zeroIsDefault = await collect(cutBatches(rows.slice(0, 7), () => 0));
    expect(zeroIsDefault.map((b) => b.length)).toEqual([7]);
    expect(clampBatch(9999)).toBe(VAULT_MAX_BATCH);
    expect(clampBatch(-1)).toBe(VAULT_MAX_BATCH);
    expect(clampBatch(0.5)).toBe(VAULT_MAX_BATCH);
    expect(clampBatch(7.9)).toBe(7);
  });

  it("dedupes inside a batch and drops stale re-deliveries across batches", async () => {
    const rows = [
      row(A, "2026-01-01T00:00:00Z", "v1"),
      row(A, "2026-01-03T00:00:00Z", "v3"),
      row(B, "2026-01-01T00:00:00Z"),
      row(A, "2026-01-02T00:00:00Z", "v2"),
    ];
    const batches = await collect(cutBatches(stream(rows), () => 2));
    expect(
      batches.map((b) => b.map((r) => `${r.sfdcId}:${r.sourceHash}`)),
    ).toEqual([[`${A}:v3`, `${B}:h`]]);
    const tracker = new LastWinsTracker();
    expect(tracker.accept(row(A, "2026-01-05T00:00:00Z"))).toBe(true);
    expect(tracker.accept(row(A, "2026-01-04T00:00:00Z"))).toBe(false);
    expect(tracker.accept(row(A, "2026-01-05T00:00:00Z"))).toBe(true);
    expect(tracker.size).toBe(1);
  });

  it("hash skip requires a live, real id-map row with the same source hash", () => {
    const base: IdMapRow = {
      objectKey: "account",
      sfdcId: A,
      vaultDns: "v",
      vaultObject: "account__v",
      vaultId: "V1",
      country: "US",
      matchMethod: "created",
      firstSeenRun: "r",
      lastSeenRun: "r",
      sourceHash: "h",
    };
    expect(shouldHashSkip(row(A, "", "h"), base)).toBe(true);
    expect(shouldHashSkip(row(A, "", "other"), base)).toBe(false);
    expect(shouldHashSkip(row(A, "", "h"), undefined)).toBe(false);
    expect(shouldHashSkip(row(A, "", "h"), { ...base, dryRun: true })).toBe(
      false,
    );
    expect(
      shouldHashSkip(row(A, "", "h"), {
        ...base,
        deletedAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe(false);
    expect(shouldHashSkip(row(A, "", "h"), { ...base, mergedInto: B })).toBe(
      false,
    );
    expect(shouldHashSkip(row(A, "", "h"), { ...base, sourceHash: null })).toBe(
      false,
    );
  });

  it("adaptive batch size halves on a slow call (min 50) and grows 25 % after 10 fast calls (max 500)", () => {
    const a = new AdaptiveBatchSize(500, { wallTimeMs: 1000 });
    expect(a.current()).toBe(500);
    expect(a.record(1500)).toBe(250);
    expect(a.record(1500)).toBe(125);
    expect(a.record(1500)).toBe(62);
    expect(a.record(1500)).toBe(MIN_BATCH_SIZE);
    expect(a.record(1500)).toBe(MIN_BATCH_SIZE);
    for (let i = 0; i < 9; i++) expect(a.record(10)).toBe(MIN_BATCH_SIZE);
    expect(a.record(10)).toBe(63); // 10th fast call
    for (let i = 0; i < 10; i++) a.record(10);
    expect(a.current()).toBe(79);
    // a slow call resets the fast counter
    for (let i = 0; i < 5; i++) a.record(10);
    a.record(5000);
    expect(a.current()).toBe(50);
    for (let i = 0; i < 9; i++) a.record(10);
    expect(a.current()).toBe(50);
    const big = new AdaptiveBatchSize(480, { wallTimeMs: 1000 });
    for (let i = 0; i < 10; i++) big.record(1);
    expect(big.current()).toBe(VAULT_MAX_BATCH);
    // an explicit initial size below the floor is honoured (tests / tiny objects)
    expect(new AdaptiveBatchSize(10, { wallTimeMs: 1 }).current()).toBe(10);
  });
});
