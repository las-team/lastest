/**
 * Behavioural contract for every `StateStore` implementation (§2.4). Call
 * `stateStoreContract(name, makeStore)` from a vitest file; `makeStore` must
 * return a fresh, empty store bound to `test.veevavault.com` on every call.
 * Runs against `MemoryStateStore` (reference), `FileStateStore` and, in the
 * integration suite, `PostgresStateStore`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { to18 } from "../transform/ids";
import type { IdMapRow, RowResult, RunRecord } from "../types";
import type { StateStore } from "./types";

export const CONTRACT_VAULT_DNS = "test.veevavault.com";

export interface ContractOptions {
  /** Called after each test with the store it created (close/cleanup). */
  cleanup?: (store: StateStore) => Promise<void>;
}

export function stateStoreContract(
  name: string,
  makeStore: () => Promise<StateStore>,
  opts: ContractOptions = {},
): void {
  const ids = {
    a1: to18("001000000000001"),
    a2: to18("001000000000002"),
    a3: to18("001000000000003"),
    a4: to18("001000000000004"),
    a5: to18("001000000000005"),
    a9: to18("001000000000009"),
    c1: to18("a0K000000000001"),
    u1: to18("005000000000001"),
    addr1: to18("a0A000000000001"),
  };
  const run = (runId: string, extra: Partial<RunRecord> = {}): RunRecord => ({
    runId,
    mode: "init",
    countries: ["US"],
    startedAt: `2026-01-0${runId.slice(-1)}T00:00:00.000Z`,
    status: "running",
    toolVersion: "0.1.0",
    configHash: "c",
    ...extra,
  });
  const idRow = (sfdcId: string, extra: Partial<IdMapRow> = {}): IdMapRow => ({
    objectKey: "account",
    sfdcId,
    vaultDns: CONTRACT_VAULT_DNS,
    vaultObject: "account__v",
    vaultId: `V${to18(sfdcId).slice(-4)}`,
    country: "US",
    matchMethod: "created",
    firstSeenRun: "r1",
    lastSeenRun: "r1",
    ...extra,
  });
  const rr = (sfdcId: string, extra: Partial<RowResult> = {}): RowResult => ({
    runId: "r1",
    objectKey: "account",
    country: "US",
    sfdcId,
    state: "loaded_created",
    attempt: 1,
    updatedAt: "t",
    ...extra,
  });

  describe(`StateStore contract (${name})`, () => {
    const open: StateStore[] = [];
    const store = async () => {
      const s = await makeStore();
      open.push(s);
      return s;
    };
    afterEach(async () => {
      for (const s of open.splice(0)) {
        if (opts.cleanup) await opts.cleanup(s);
        else await s.close();
      }
    });

    it("is bound to one vault", async () => {
      const s = await store();
      expect(s.vaultDns).toBe(CONTRACT_VAULT_DNS);
    });

    describe("runs", () => {
      it("create is unique, update patches, get returns a copy", async () => {
        const s = await store();
        await s.runs.create(run("r1"));
        await expect(s.runs.create(run("r1"))).rejects.toThrow();
        await s.runs.update("r1", {
          status: "succeeded",
          finishedAt: "2026-01-01T01:00:00.000Z",
          mappingHash: "mh",
          dryRun: true,
        });
        const got = await s.runs.get("r1");
        expect(got).toMatchObject({
          runId: "r1",
          status: "succeeded",
          mappingHash: "mh",
          dryRun: true,
          countries: ["US"],
        });
        got!.status = "failed";
        expect((await s.runs.get("r1"))?.status).toBe("succeeded");
        expect(await s.runs.get("nope")).toBeUndefined();
      });
      it("update of an unknown run throws", async () => {
        const s = await store();
        await expect(s.runs.update("zz", { status: "failed" })).rejects.toThrow(
          /not found/,
        );
      });
      it("list is newest first with mode/status/limit filters; latestSucceeded", async () => {
        const s = await store();
        await s.runs.create(run("r1"));
        await s.runs.create(run("r3", { mode: "delta" }));
        await s.runs.create(run("r2", { mode: "delta", wave: "eu1" }));
        expect((await s.runs.list()).map((r) => r.runId)).toEqual([
          "r3",
          "r2",
          "r1",
        ]);
        expect(
          (await s.runs.list({ mode: "delta" })).map((r) => r.runId),
        ).toEqual(["r3", "r2"]);
        expect((await s.runs.list({ limit: 1 })).map((r) => r.runId)).toEqual([
          "r3",
        ]);
        expect(await s.runs.latestSucceeded()).toBeUndefined();
        await s.runs.update("r1", { status: "succeeded" });
        await s.runs.update("r2", { status: "succeeded" });
        expect((await s.runs.latestSucceeded())?.runId).toBe("r2");
        expect(
          (await s.runs.list({ status: "running" })).map((r) => r.runId),
        ).toEqual(["r3"]);
      });
    });

    describe("watermarks", () => {
      it("one per (object, country, kind); set overwrites; list filters", async () => {
        const s = await store();
        const base = {
          objectKey: "call2" as const,
          country: "US",
          runId: "r1",
          updatedAt: "t",
        };
        await s.watermarks.set({
          ...base,
          kind: "modstamp",
          value: "2026-01-01T00:00:00Z",
          cutoffDate: "2024-01-01",
        });
        await s.watermarks.set({
          ...base,
          kind: "deleted",
          value: "2026-01-01T00:00:00Z",
        });
        await s.watermarks.set({
          ...base,
          kind: "modstamp",
          value: "2026-02-01T00:00:00Z",
          cutoffDate: "2024-01-01",
          runId: "r2",
        });
        await s.watermarks.set({
          ...base,
          country: "DE",
          kind: "modstamp",
          value: "2026-03-01T00:00:00Z",
        });
        const wm = await s.watermarks.get("call2", "US", "modstamp");
        expect(wm).toMatchObject({
          value: "2026-02-01T00:00:00Z",
          runId: "r2",
          cutoffDate: "2024-01-01",
        });
        expect(
          await s.watermarks.get("call2", "FR", "modstamp"),
        ).toBeUndefined();
        expect(await s.watermarks.list({ objectKey: "call2" })).toHaveLength(3);
        expect(
          await s.watermarks.list({ objectKey: "call2", country: "US" }),
        ).toHaveLength(2);
        expect(await s.watermarks.list({ country: "DE" })).toHaveLength(1);
        expect(await s.watermarks.list({ objectKey: "account" })).toHaveLength(
          0,
        );
      });
    });

    describe("idMap", () => {
      it("normalises 15-char ids everywhere and keeps firstSeenRun on re-put", async () => {
        const s = await store();
        await s.idMap.put(idRow("001000000000001"));
        await s.idMap.put(
          idRow(ids.a1, {
            lastSeenRun: "r2",
            firstSeenRun: "r2",
            objectType: "person__v",
          }),
        );
        const row = await s.idMap.get("account", "001000000000001");
        expect(row).toMatchObject({
          sfdcId: ids.a1,
          firstSeenRun: "r1",
          lastSeenRun: "r2",
          objectType: "person__v",
          vaultDns: CONTRACT_VAULT_DNS,
        });
        expect(await s.idMap.get("account", ids.a2)).toBeUndefined();
      });
      it("stamps the store's vaultDns regardless of the row's", async () => {
        const s = await store();
        await s.idMap.put(idRow(ids.a1, { vaultDns: "other.veevavault.com" }));
        expect((await s.idMap.get("account", ids.a1))?.vaultDns).toBe(
          CONTRACT_VAULT_DNS,
        );
      });
      it("bulkGet keyed by 18-char id, missing ids absent, copies returned", async () => {
        const s = await store();
        await s.idMap.putMany([idRow(ids.a2), idRow(ids.a3)]);
        const got = await s.idMap.bulkGet("account", [
          ids.a2,
          "001000000000003",
          ids.a9,
        ]);
        expect([...got.keys()].sort()).toEqual([ids.a2, ids.a3]);
        got.get(ids.a2)!.vaultId = "mutated";
        expect((await s.idMap.get("account", ids.a2))?.vaultId).toBe(
          `V${ids.a2.slice(-4)}`,
        );
        expect((await s.idMap.bulkGet("account", [])).size).toBe(0);
      });
      it("putMany with duplicate ids in one batch: last wins, firstSeenRun from the first", async () => {
        const s = await store();
        await s.idMap.putMany([
          idRow(ids.a1, {
            firstSeenRun: "r1",
            lastSeenRun: "r1",
            vaultId: "V1",
          }),
          idRow("001000000000001", {
            firstSeenRun: "r2",
            lastSeenRun: "r2",
            vaultId: "V1b",
          }),
        ]);
        expect(await s.idMap.get("account", ids.a1)).toMatchObject({
          firstSeenRun: "r1",
          lastSeenRun: "r2",
          vaultId: "V1b",
        });
        expect(await s.idMap.count("account")).toBe(1);
      });
      it("enforces a unique live (vaultObject, vaultId); deleted/merged rows are exempt", async () => {
        const s = await store();
        await s.idMap.put(idRow(ids.a1, { vaultId: "VX" }));
        await expect(
          s.idMap.put(idRow(ids.a2, { vaultId: "VX" })),
        ).rejects.toThrow(/id_map_vault_uidx/);
        await expect(
          s.idMap.putMany([
            idRow(ids.a3, { vaultId: "VY" }),
            idRow(ids.a4, { vaultId: "VY" }),
          ]),
        ).rejects.toThrow(/id_map_vault_uidx/);
        // re-put of the same row is fine
        await s.idMap.put(idRow(ids.a1, { vaultId: "VX", lastSeenRun: "r2" }));
        // different object may share an id string
        await s.idMap.put(
          idRow(ids.a2, {
            vaultId: "VX",
            objectKey: "address",
            vaultObject: "address__v",
          }),
        );
        // a deleted row frees the vault id
        await s.idMap.markDeleted("account", ids.a1, "2026-01-01T00:00:00Z");
        await s.idMap.put(idRow(ids.a5, { vaultId: "VX" }));
        expect((await s.idMap.byVaultId("account__v", "VX"))?.sfdcId).toBe(
          ids.a5,
        );
      });
      it("byVaultId ignores deleted and merged rows", async () => {
        const s = await store();
        await s.idMap.putMany([
          idRow(ids.a1, { vaultId: "V1" }),
          idRow(ids.a2, { vaultId: "V2" }),
        ]);
        expect((await s.idMap.byVaultId("account__v", "V2"))?.sfdcId).toBe(
          ids.a2,
        );
        expect(await s.idMap.byVaultId("account__v", "V3")).toBeUndefined();
        await s.idMap.markDeleted("account", ids.a2, "t");
        expect(await s.idMap.byVaultId("account__v", "V2")).toBeUndefined();
        await s.idMap.merge("account", ids.a2, ids.a1, "r2");
        expect((await s.idMap.byVaultId("account__v", "V1"))?.sfdcId).toBe(
          ids.a1,
        );
      });
      it("markDeleted sets/clears deletedAt and affects count", async () => {
        const s = await store();
        await s.idMap.putMany([
          idRow(ids.a1),
          idRow(ids.a2, { country: "DE" }),
        ]);
        await s.idMap.markDeleted(
          "account",
          "001000000000001",
          "2026-01-01T00:00:00Z",
        );
        expect((await s.idMap.get("account", ids.a1))?.deletedAt).toBe(
          "2026-01-01T00:00:00Z",
        );
        expect(await s.idMap.count("account")).toBe(1);
        expect(await s.idMap.count("account", "US")).toBe(0);
        expect(await s.idMap.count("account", "DE")).toBe(1);
        await s.idMap.markDeleted("account", ids.a1, null);
        expect(
          (await s.idMap.get("account", ids.a1))?.deletedAt ?? null,
        ).toBeNull();
        expect(await s.idMap.count("account")).toBe(2);
        await s.idMap.markDeleted("account", ids.a9, "t"); // unknown → no-op
        expect(await s.idMap.get("account", ids.a9)).toBeUndefined();
      });
      it("merge: loser follows the survivor's vault id; unmapped loser is inserted; missing survivor throws", async () => {
        const s = await store();
        await s.idMap.putMany([
          idRow(ids.a1, { vaultId: "V1" }),
          idRow(ids.a2, { vaultId: "V2", sourceHash: "h" }),
        ]);
        await s.idMap.merge("account", "001000000000002", ids.a1, "r3");
        expect(await s.idMap.get("account", ids.a2)).toMatchObject({
          mergedInto: ids.a1,
          vaultId: "V1",
          matchMethod: "merged",
          lastSeenRun: "r3",
          firstSeenRun: "r1",
          sourceHash: "h",
        });
        await s.idMap.merge("account", ids.a3, ids.a1, "r3");
        expect(await s.idMap.get("account", ids.a3)).toMatchObject({
          sfdcId: ids.a3,
          mergedInto: ids.a1,
          vaultId: "V1",
          matchMethod: "merged",
          firstSeenRun: "r3",
          lastSeenRun: "r3",
        });
        expect(
          (await s.idMap.get("account", ids.a3))?.sourceHash ?? null,
        ).toBeNull();
        await expect(
          s.idMap.merge("account", ids.a2, ids.a9, "r3"),
        ).rejects.toThrow();
        expect(await s.idMap.count("account")).toBe(1);
        // the survivor is untouched
        expect(
          (await s.idMap.get("account", ids.a1))?.mergedInto ?? null,
        ).toBeNull();
        // merge is idempotent
        await s.idMap.merge("account", ids.a2, ids.a1, "r4");
        expect((await s.idMap.get("account", ids.a2))?.lastSeenRun).toBe("r4");
      });
      it("setSourceHash/setVerified update bookkeeping; unknown ids are no-ops", async () => {
        const s = await store();
        await s.idMap.put(idRow(ids.a1));
        await s.idMap.setSourceHash("account", "001000000000001", "h1", "r3");
        await s.idMap.setVerified(
          "account",
          ids.a1,
          "h1",
          "2026-01-02T00:00:00Z",
        );
        expect(await s.idMap.get("account", ids.a1)).toMatchObject({
          sourceHash: "h1",
          verifiedHash: "h1",
          verifiedAt: "2026-01-02T00:00:00Z",
          lastSeenRun: "r3",
        });
        await s.idMap.setSourceHash("account", ids.a9, "h", "r3");
        await s.idMap.setVerified("account", ids.a9, "h", "t");
        expect(await s.idMap.get("account", ids.a9)).toBeUndefined();
      });
      it("iterate streams every row of a unit (deleted and merged included), copies only", async () => {
        const s = await store();
        await s.idMap.putMany([
          idRow(ids.a1),
          idRow(ids.a2),
          idRow(ids.a3, { country: "DE" }),
        ]);
        await s.idMap.markDeleted("account", ids.a2, "t");
        const us: string[] = [];
        for await (const r of s.idMap.iterate("account", "US")) {
          us.push(r.sfdcId);
          r.vaultId = "mutated";
        }
        expect(us.sort()).toEqual([ids.a1, ids.a2]);
        const all: string[] = [];
        for await (const r of s.idMap.iterate("account")) all.push(r.sfdcId);
        expect(all).toHaveLength(3);
        expect((await s.idMap.get("account", ids.a1))?.vaultId).not.toBe(
          "mutated",
        );
        const none: string[] = [];
        for await (const r of s.idMap.iterate("call2")) none.push(r.sfdcId);
        expect(none).toEqual([]);
      });
      it("purgeDryRun removes only dry-run rows and reports the count", async () => {
        const s = await store();
        await s.idMap.putMany([
          idRow(ids.a1),
          idRow(ids.a2, { dryRun: true }),
          idRow(ids.a3, { dryRun: true }),
        ]);
        expect((await s.idMap.get("account", ids.a2))?.dryRun).toBe(true);
        expect(await s.idMap.purgeDryRun()).toBe(2);
        expect(await s.idMap.purgeDryRun()).toBe(0);
        expect(await s.idMap.get("account", ids.a2)).toBeUndefined();
        expect(await s.idMap.count("account")).toBe(1);
      });
      it("user rows carry numeric vault ids as strings", async () => {
        const s = await store();
        await s.idMap.put(
          idRow(ids.u1, {
            objectKey: "user",
            vaultObject: "user__sys",
            vaultId: "111",
            country: "GLOBAL",
          }),
        );
        expect((await s.idMap.get("user", ids.u1))?.vaultId).toBe("111");
        expect(await s.idMap.count("user", "GLOBAL")).toBe(1);
      });
    });

    describe("rowResults", () => {
      it("upserts by (run, object, 18-char id) and filters", async () => {
        const s = await store();
        await s.rowResults.upsert([
          rr(ids.a1, { batchNo: 1 }),
          rr(ids.a2, {
            state: "failed",
            errorType: "INVALID_DATA",
            errorMessage: "bad",
            batchNo: 1,
          }),
          rr(ids.a3, {
            state: "failed",
            errorType: "UNRESOLVED_FK",
            batchNo: 2,
          }),
          rr(ids.a4, { state: "failed", batchNo: 2, country: "DE" }),
        ]);
        await s.rowResults.upsert([
          rr("001000000000001", {
            state: "loaded_updated",
            batchNo: 1,
            attempt: 2,
            vaultId: "V1",
          }),
        ]);
        expect(
          await s.rowResults.get("r1", "account", "001000000000001"),
        ).toMatchObject({
          sfdcId: ids.a1,
          state: "loaded_updated",
          attempt: 2,
          vaultId: "V1",
        });
        expect(await s.rowResults.get("r2", "account", ids.a1)).toBeUndefined();
        expect(
          await s.rowResults.query({ runId: "r1", state: "failed" }),
        ).toHaveLength(3);
        expect(
          await s.rowResults.query({
            runId: "r1",
            state: ["failed", "loaded_updated"],
            batchNo: 1,
          }),
        ).toHaveLength(2);
        expect(
          await s.rowResults.query({ runId: "r1", errorType: "INVALID_DATA" }),
        ).toHaveLength(1);
        expect(
          await s.rowResults.query({ runId: "r1", country: "DE" }),
        ).toHaveLength(1);
        expect(
          await s.rowResults.query({ runId: "r1", objectKey: "call2" }),
        ).toHaveLength(0);
        expect(
          await s.rowResults.query({ runId: "r1", limit: 1, offset: 3 }),
        ).toHaveLength(1);
        expect(
          await s.rowResults.query({ runId: "r1", limit: 2 }),
        ).toHaveLength(2);
        expect(await s.rowResults.query({ runId: "r9" })).toHaveLength(0);
        expect(await s.rowResults.countByState("r1", "account", "US")).toEqual({
          loaded_updated: 1,
          failed: 2,
        });
        expect(await s.rowResults.countByState("r1", "account", "FR")).toEqual(
          {},
        );
        expect(
          await s.rowResults.countFailedByType("r1", "account", "US"),
        ).toEqual({ INVALID_DATA: 1, UNRESOLVED_FK: 1 });
        expect(
          await s.rowResults.countFailedByType("r1", "account", "DE"),
        ).toEqual({ UNKNOWN: 1 });
      });
      it("duplicate ids inside one upsert batch: last wins", async () => {
        const s = await store();
        await s.rowResults.upsert([
          rr(ids.a1, { state: "extracted" }),
          rr(ids.a1, { state: "transformed" }),
        ]);
        expect((await s.rowResults.get("r1", "account", ids.a1))?.state).toBe(
          "transformed",
        );
        await s.rowResults.upsert([]);
      });
    });

    describe("pendingFk", () => {
      const p = {
        runId: "r1",
        objectKey: "call2" as const,
        country: "US",
        sfdcId: ids.c1,
        field: "account__v",
        targetObjectKey: "account" as const,
        targetSfdcId: ids.a9,
        attempts: 0,
      };
      it("add upserts by (run, object, id, field) keeping attempts; resolve; counts", async () => {
        const s = await store();
        await s.pendingFk.add([
          p,
          {
            ...p,
            field: "user__v",
            targetObjectKey: "user",
            targetSfdcId: ids.u1,
          },
          { ...p, sfdcId: to18("a0K000000000002"), country: "DE" },
        ]);
        await s.pendingFk.bumpAttempts(
          "r1",
          "call2",
          "a0K000000000001",
          "account__v",
        );
        await s.pendingFk.bumpAttempts("r1", "call2", ids.c1, "nope__v"); // no-op
        await s.pendingFk.add([{ ...p, sfdcId: "a0K000000000001" }]);
        const list = await s.pendingFk.list("r1");
        expect(list).toHaveLength(3);
        const acc = list.find(
          (x) => x.field === "account__v" && x.sfdcId === ids.c1,
        );
        expect(acc).toMatchObject({
          attempts: 1,
          targetSfdcId: ids.a9,
          sfdcId: ids.c1,
        });
        expect(await s.pendingFk.list("r1", { country: "DE" })).toHaveLength(1);
        expect(
          await s.pendingFk.list("r1", { objectKey: "account" }),
        ).toHaveLength(0);
        await s.pendingFk.resolve("r1", "call2", ids.c1, "account__v", "t");
        await s.pendingFk.resolve("r1", "call2", ids.c1, "missing__v", "t"); // no-op
        expect(
          await s.pendingFk.list("r1", { unresolvedOnly: true }),
        ).toHaveLength(2);
        expect(
          (await s.pendingFk.list("r1")).find(
            (x) => x.field === "account__v" && x.sfdcId === ids.c1,
          )?.resolvedAt,
        ).toBe("t");
        expect(await s.pendingFk.countUnresolved("r1", "call2", "US")).toBe(1);
        expect(await s.pendingFk.countUnresolved("r1", "call2", "DE")).toBe(1);
        expect(await s.pendingFk.countUnresolved("r2", "call2", "US")).toBe(0);
        expect(await s.pendingFk.list("r2")).toHaveLength(0);
      });
      it("duplicates in one add batch: last wins, attempts from the first", async () => {
        const s = await store();
        await s.pendingFk.add([
          { ...p, attempts: 2 },
          { ...p, attempts: 5, targetSfdcId: ids.a1 },
        ]);
        expect(await s.pendingFk.list("r1")).toMatchObject([
          { attempts: 2, targetSfdcId: ids.a1 },
        ]);
      });
    });

    describe("fkIndex", () => {
      it("put upserts edges; childrenOf and get normalise ids", async () => {
        const s = await store();
        await s.fkIndex.put([
          {
            objectKey: "call2",
            sfdcId: ids.c1,
            field: "account__v",
            targetObjectKey: "account",
            targetSfdcId: ids.a1,
            runId: "r1",
          },
          {
            objectKey: "call2",
            sfdcId: ids.c1,
            field: "user__v",
            targetObjectKey: "user",
            targetSfdcId: ids.u1,
            runId: "r1",
          },
          {
            objectKey: "address",
            sfdcId: "a0A000000000001",
            field: "account__v",
            targetObjectKey: "account",
            targetSfdcId: ids.a1,
            runId: "r1",
          },
        ]);
        expect(
          await s.fkIndex.childrenOf("account", "001000000000001"),
        ).toHaveLength(2);
        expect(await s.fkIndex.childrenOf("user", ids.u1)).toMatchObject([
          { objectKey: "call2", field: "user__v" },
        ]);
        expect(await s.fkIndex.childrenOf("account", ids.a9)).toEqual([]);
        expect(await s.fkIndex.get("call2", "a0K000000000001")).toHaveLength(2);
        expect(await s.fkIndex.get("address", ids.addr1)).toMatchObject([
          { sfdcId: ids.addr1, targetSfdcId: ids.a1 },
        ]);
        // re-pointing an edge replaces it
        await s.fkIndex.put([
          {
            objectKey: "call2",
            sfdcId: ids.c1,
            field: "account__v",
            targetObjectKey: "account",
            targetSfdcId: ids.a2,
            runId: "r2",
          },
        ]);
        expect(await s.fkIndex.childrenOf("account", ids.a1)).toHaveLength(1);
        expect(await s.fkIndex.childrenOf("account", ids.a2)).toMatchObject([
          { runId: "r2" },
        ]);
        expect(await s.fkIndex.get("call2", ids.c1)).toHaveLength(2);
      });
    });

    describe("checkpoints", () => {
      it("add upserts by (run, job, page); list sorted by page; complete", async () => {
        const s = await store();
        const base = {
          runId: "r1",
          objectKey: "account" as const,
          country: "US",
          jobId: "j",
          rows: 10,
        };
        await s.checkpoints.add({
          ...base,
          pageNo: 1,
          file: "f1",
          locator: "loc-1",
        });
        await s.checkpoints.add({
          ...base,
          pageNo: 0,
          file: "f0",
          locator: null,
        });
        await s.checkpoints.add({
          ...base,
          pageNo: 1,
          file: "f1b",
          locator: "loc-1",
        });
        await s.checkpoints.add({
          ...base,
          jobId: "k",
          pageNo: 0,
          file: "g0",
          country: "DE",
        });
        await s.checkpoints.complete("r1", "j", 0, "t");
        await s.checkpoints.complete("r1", "j", 7, "t"); // no-op
        const cps = await s.checkpoints.list("r1", "account", "US");
        expect(cps.map((c) => [c.pageNo, c.file])).toEqual([
          [0, "f0"],
          [1, "f1b"],
        ]);
        expect(cps[0].completedAt).toBe("t");
        expect(cps[1].completedAt ?? null).toBeNull();
        expect(await s.checkpoints.list("r1", "account", "DE")).toHaveLength(1);
        expect(await s.checkpoints.list("r2", "account", "US")).toHaveLength(0);
      });
    });

    describe("findings", () => {
      it("add/list with filters; previous follows run creation order", async () => {
        const s = await store();
        await s.runs.create(run("r1"));
        await s.runs.create(run("r3"));
        await s.runs.create(run("r2"));
        await s.findings.add("r1", [
          {
            severity: "blocking",
            code: "VT_FIELD_MISSING",
            objectKey: "account",
            country: "US",
            field: "x__v",
            detail: "gone",
          },
          {
            severity: "warning",
            code: "SCOPE_NARROWED",
            objectKey: "call2",
            country: "DE",
            detail: { months: 12 },
            count: 3,
          },
        ]);
        await s.findings.add("r3", [
          {
            severity: "info",
            code: "LEGACY_ID_FIELD_SELECTED",
            objectKey: "account",
            detail: "legacy_crm_id__v",
          },
        ]);
        await s.findings.add("r2", []);
        expect(await s.findings.list("r1")).toHaveLength(2);
        expect(
          await s.findings.list("r1", { severity: "blocking" }),
        ).toMatchObject([{ code: "VT_FIELD_MISSING", runId: "r1" }]);
        expect(
          await s.findings.list("r1", { objectKey: "call2" }),
        ).toMatchObject([{ detail: { months: 12 }, count: 3 }]);
        expect(await s.findings.list("r1", { country: "US" })).toHaveLength(1);
        expect(await s.findings.list("r1", { code: "NOPE" })).toHaveLength(0);
        expect(
          await s.findings.list("r3", { code: "VT_FIELD_MISSING" }),
        ).toHaveLength(0);
        expect((await s.findings.list("r1"))[0].createdAt).toMatch(
          /^\d{4}-\d{2}-\d{2}T/,
        );
        expect(
          (await s.findings.previous("r3")).map((f) => f.code).sort(),
        ).toEqual(["SCOPE_NARROWED", "VT_FIELD_MISSING"]);
        expect((await s.findings.previous("r2")).map((f) => f.code)).toEqual([
          "LEGACY_ID_FIELD_SELECTED",
        ]);
        expect(await s.findings.previous("r1")).toEqual([]);
        expect(await s.findings.previous("unknown")).toEqual([]);
      });
    });

    describe("reconciliation", () => {
      it("upsert replaces the unit row; get/list", async () => {
        const s = await store();
        const row = {
          runId: "r1",
          objectKey: "account" as const,
          country: "US",
          extracted: 3,
          transformed: 3,
          skipped: 1,
          skippedByReason: { erased: 1 },
          pendingFk: 0,
          created: 2,
          updated: 0,
          unchanged: 0,
          failed: 0,
          deleted: 0,
          status: "pass" as const,
        };
        await s.reconciliation.upsert(row);
        await s.reconciliation.upsert({
          ...row,
          created: 3,
          failedByType: { X: 1 },
          vaultCount: 7,
          sfdcScopeCount: null,
        });
        await s.reconciliation.upsert({
          ...row,
          country: "DE",
          status: "fail",
        });
        expect(await s.reconciliation.get("r1", "account", "US")).toMatchObject(
          {
            created: 3,
            skippedByReason: { erased: 1 },
            failedByType: { X: 1 },
            vaultCount: 7,
          },
        );
        expect(
          (await s.reconciliation.get("r1", "account", "US"))?.sfdcScopeCount ??
            null,
        ).toBeNull();
        expect(await s.reconciliation.get("r1", "call2", "US")).toBeUndefined();
        expect(await s.reconciliation.list("r1")).toHaveLength(2);
        expect(await s.reconciliation.list("r2")).toHaveLength(0);
      });
    });

    describe("mappingSnapshots", () => {
      it("keyed by (hash, object, country); latestFor by createdAt", async () => {
        const s = await store();
        const snap = {
          mappingHash: "h",
          objectKey: "account" as const,
          country: "US",
          materialised: {
            objectKey: "account",
            fields: [{ target: "name__v" }],
          } as never,
          createdAt: "2026-01-01T00:00:00Z",
        };
        await s.mappingSnapshots.put(snap);
        await s.mappingSnapshots.put({
          ...snap,
          mappingHash: "h2",
          createdAt: "2026-02-01T00:00:00Z",
        });
        await s.mappingSnapshots.put({
          ...snap,
          mappingHash: "h3",
          country: "DE",
          createdAt: "2026-03-01T00:00:00Z",
        });
        expect(
          (await s.mappingSnapshots.get("h", "account", "US"))?.materialised,
        ).toEqual(snap.materialised);
        expect(
          await s.mappingSnapshots.get("h", "account", "DE"),
        ).toBeUndefined();
        expect(
          (await s.mappingSnapshots.latestFor("account", "US"))?.mappingHash,
        ).toBe("h2");
        expect(
          await s.mappingSnapshots.latestFor("call2", "US"),
        ).toBeUndefined();
      });
    });

    describe("auditLog", () => {
      it("append-only with monotonic ids; list filters and tail limit", async () => {
        const s = await store();
        await s.auditLog.append({
          runId: "r1",
          at: "t1",
          actor: "cli",
          event: "run.start",
          detail: { mode: "init" },
        });
        await s.auditLog.append({
          runId: "r1",
          at: "t2",
          actor: "cli",
          event: "batch",
          detail: { n: 1 },
        });
        await s.auditLog.append({
          runId: null,
          at: "t3",
          actor: "ops",
          event: "run.end",
        });
        const all = await s.auditLog.list();
        expect(all.map((e) => e.id)).toEqual([1, 2, 3]);
        expect(all[0]).toMatchObject({
          detail: { mode: "init" },
          event: "run.start",
        });
        expect(all[2].detail ?? null).toBeNull();
        expect(
          (await s.auditLog.list({ runId: "r1" })).map((e) => e.id),
        ).toEqual([1, 2]);
        expect(
          (await s.auditLog.list({ event: "run.end" })).map((e) => e.id),
        ).toEqual([3]);
        expect((await s.auditLog.list({ limit: 2 })).map((e) => e.id)).toEqual([
          2, 3,
        ]);
        expect(
          (await s.auditLog.list({ runId: "r1", limit: 1 })).map((e) => e.id),
        ).toEqual([2]);
      });
    });

    describe("probeResults", () => {
      it("cached per vault; set overrides vaultDns", async () => {
        const s = await store();
        await s.probeResults.set({
          vaultDns: "x",
          probe: "rollupRecalc",
          result: { available: false },
          checkedAt: "t",
        });
        await s.probeResults.set({
          vaultDns: "x",
          probe: "rollupRecalc",
          result: { available: true, path: "/x" },
          checkedAt: "t2",
        });
        await s.probeResults.set({
          vaultDns: "x",
          probe: "attachments",
          result: {},
          checkedAt: "t",
        });
        expect(await s.probeResults.get("rollupRecalc")).toMatchObject({
          vaultDns: CONTRACT_VAULT_DNS,
          result: { available: true, path: "/x" },
          checkedAt: "t2",
        });
        expect(await s.probeResults.get("nope")).toBeUndefined();
        expect(
          (await s.probeResults.list()).map((p) => p.probe).sort(),
        ).toEqual(["attachments", "rollupRecalc"]);
      });
    });

    describe("countryStatus", () => {
      it("setFrozen/isFrozen/list; null unfreezes", async () => {
        const s = await store();
        expect(await s.countryStatus.isFrozen("NL")).toBe(false);
        await s.countryStatus.setFrozen("NL", "t");
        await s.countryStatus.setFrozen("DE", "t2");
        await s.countryStatus.setFrozen("NL", "t3");
        expect(await s.countryStatus.isFrozen("NL")).toBe(true);
        expect(
          (await s.countryStatus.list()).sort((a, b) =>
            a.country.localeCompare(b.country),
          ),
        ).toEqual([
          { country: "DE", frozenAt: "t2" },
          { country: "NL", frozenAt: "t3" },
        ]);
        await s.countryStatus.setFrozen("NL", null);
        await s.countryStatus.setFrozen("FR", null);
        expect(await s.countryStatus.isFrozen("NL")).toBe(false);
        expect(await s.countryStatus.list()).toEqual([
          { country: "DE", frozenAt: "t2" },
        ]);
      });
    });

    it("returns copies from every read", async () => {
      const s = await store();
      await s.idMap.put(idRow(ids.a1));
      await s.runs.create(run("r1"));
      await s.watermarks.set({
        objectKey: "account",
        country: "US",
        kind: "modstamp",
        value: "v",
        runId: "r1",
        updatedAt: "t",
      });
      (await s.idMap.get("account", ids.a1))!.vaultId = "m";
      (await s.runs.get("r1"))!.countries.push("DE");
      (await s.runs.list())[0].status = "failed";
      (await s.watermarks.list())[0].value = "m";
      expect((await s.idMap.get("account", ids.a1))?.vaultId).toBe(
        `V${ids.a1.slice(-4)}`,
      );
      expect((await s.runs.get("r1"))?.countries).toEqual(["US"]);
      expect((await s.runs.get("r1"))?.status).toBe("running");
      expect((await s.watermarks.get("account", "US", "modstamp"))?.value).toBe(
        "v",
      );
    });

    it("migrate (when present) is idempotent and close resolves", async () => {
      const s = await store();
      if (s.migrate) {
        await s.migrate();
        await s.migrate();
      }
      await s.close();
    });
  });
}
