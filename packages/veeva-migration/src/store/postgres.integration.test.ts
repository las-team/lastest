/**
 * Integration suite for `PostgresStateStore` — needs a real database:
 *   MIG_TEST_DATABASE_URL=postgres://user@host:5432/db pnpm vitest run \
 *     packages/veeva-migration/src/store/postgres.integration.test.ts
 * Skipped (not failed) when the variable is unset. Runs (1) the reference
 * `src/testkit/memory-store.test.ts` suite unchanged apart from `makeStore`
 * and (2) the shared `stateStoreContract`. Each `makeStore()` drops and
 * recreates a private schema so every test starts from an empty store.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import type { StateStore } from "./types";
import type { IdMapRow, RunRecord } from "../types";
import { stateStoreContract } from "./contract";
import {
  PostgresStateStore,
  postgresExecutor,
  type SqlExecutor,
} from "./postgres";

const url = process.env.MIG_TEST_DATABASE_URL;
const SCHEMA = `mig_test_${process.pid}`;

const sql = url
  ? postgres(url, { max: 2, prepare: false, onnotice: () => undefined })
  : undefined;
const pool: SqlExecutor | undefined = sql ? postgresExecutor(sql) : undefined;
/** Shared pool: `close()` on a store must not end it mid-suite. */
const shared: SqlExecutor | undefined = pool
  ? { ...pool, end: async () => undefined }
  : undefined;

const makeStore = async (): Promise<StateStore> => {
  if (!shared) throw new Error("MIG_TEST_DATABASE_URL unset");
  await shared.query(`drop schema if exists "${SCHEMA}" cascade`);
  return PostgresStateStore.connect({
    vaultDns: "test.veevavault.com",
    executor: shared,
    schema: SCHEMA,
  });
};

afterAll(async () => {
  if (shared) await shared.query(`drop schema if exists "${SCHEMA}" cascade`);
  await pool?.end();
});

// ---------------------------------------------------------------------------
// (1) src/testkit/memory-store.test.ts — verbatim apart from makeStore
// ---------------------------------------------------------------------------

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
  vaultDns: "test.veevavault.com",
  vaultObject: "account__v",
  vaultId: `V${sfdcId.slice(-4)}`,
  country: "US",
  matchMethod: "created",
  firstSeenRun: "r1",
  lastSeenRun: "r1",
  ...extra,
});

describe.skipIf(!url)("StateStore contract (postgres, reference suite)", () => {
  it("runs: create/get/update/list/latestSucceeded", async () => {
    const s = await makeStore();
    await s.runs.create(run("r1"));
    await s.runs.create(run("r2", { mode: "delta" }));
    await expect(s.runs.create(run("r1"))).rejects.toThrow();
    await s.runs.update("r1", {
      status: "succeeded",
      finishedAt: "x",
      mappingHash: "mh",
    });
    expect(await s.runs.get("r1")).toMatchObject({
      status: "succeeded",
      mappingHash: "mh",
    });
    expect((await s.runs.list({ mode: "delta" })).map((r) => r.runId)).toEqual([
      "r2",
    ]);
    expect((await s.runs.latestSucceeded())?.runId).toBe("r1");
    expect((await s.runs.list())[0].runId).toBe("r2"); // newest first
  });
  it("watermarks keyed by (object, country, kind)", async () => {
    const s = await makeStore();
    await s.watermarks.set({
      objectKey: "call2",
      country: "US",
      kind: "modstamp",
      value: "2026-01-01T00:00:00Z",
      cutoffDate: "2024-01-01",
      runId: "r1",
      updatedAt: "t",
    });
    await s.watermarks.set({
      objectKey: "call2",
      country: "US",
      kind: "deleted",
      value: "2026-01-01T00:00:00Z",
      runId: "r1",
      updatedAt: "t",
    });
    await s.watermarks.set({
      objectKey: "call2",
      country: "US",
      kind: "modstamp",
      value: "2026-02-01T00:00:00Z",
      cutoffDate: "2024-01-01",
      runId: "r2",
      updatedAt: "t",
    });
    expect((await s.watermarks.get("call2", "US", "modstamp"))?.value).toBe(
      "2026-02-01T00:00:00Z",
    );
    expect(await s.watermarks.get("call2", "DE", "modstamp")).toBeUndefined();
    expect(await s.watermarks.list({ objectKey: "call2" })).toHaveLength(2);
  });
  it("idMap: normalises ids, keeps firstSeenRun, bulkGet, reverse lookup, unique vault id", async () => {
    const s = await makeStore();
    await s.idMap.put(idRow("001000000000001"));
    await s.idMap.put(
      idRow("001000000000001AAA", { lastSeenRun: "r2", firstSeenRun: "r2" }),
    );
    const row = await s.idMap.get("account", "001000000000001");
    expect(row).toMatchObject({
      sfdcId: "001000000000001AAA",
      firstSeenRun: "r1",
      lastSeenRun: "r2",
      vaultDns: "test.veevavault.com",
    });
    await s.idMap.putMany([
      idRow("001000000000002AAA"),
      idRow("001000000000003AAA"),
    ]);
    const got = await s.idMap.bulkGet("account", [
      "001000000000002AAA",
      "001000000000003",
      "001000000000009AAA",
    ]);
    expect([...got.keys()].sort()).toEqual([
      "001000000000002AAA",
      "001000000000003AAA",
    ]);
    expect((await s.idMap.byVaultId("account__v", "V2AAA"))?.sfdcId).toBe(
      "001000000000002AAA",
    );
    await expect(
      s.idMap.put(idRow("001000000000004AAA", { vaultId: "V2AAA" })),
    ).rejects.toThrow(/id_map_vault_uidx/);
    expect(await s.idMap.count("account")).toBe(3);
    expect(await s.idMap.count("account", "DE")).toBe(0);
  });
  it("idMap: markDeleted/undelete, merge, hashes, iterate, purgeDryRun", async () => {
    const s = await makeStore();
    await s.idMap.putMany([
      idRow("001000000000001AAA"),
      idRow("001000000000002AAA"),
      idRow("001000000000005AAA", { dryRun: true }),
    ]);
    await s.idMap.markDeleted(
      "account",
      "001000000000001AAA",
      "2026-01-01T00:00:00Z",
    );
    expect(
      (await s.idMap.get("account", "001000000000001AAA"))?.deletedAt,
    ).toBe("2026-01-01T00:00:00Z");
    expect(await s.idMap.count("account")).toBe(2);
    await s.idMap.markDeleted("account", "001000000000001AAA", null);
    expect(await s.idMap.count("account")).toBe(3);
    await s.idMap.merge(
      "account",
      "001000000000002AAA",
      "001000000000001AAA",
      "r3",
    );
    const loser = await s.idMap.get("account", "001000000000002AAA");
    expect(loser).toMatchObject({
      mergedInto: "001000000000001AAA",
      vaultId: "V1AAA",
      matchMethod: "merged",
    });
    await s.idMap.merge(
      "account",
      "001000000000007AAA",
      "001000000000001AAA",
      "r3",
    ); // loser not yet mapped → inserted
    expect(
      (await s.idMap.get("account", "001000000000007AAA"))?.mergedInto,
    ).toBe("001000000000001AAA");
    await expect(
      s.idMap.merge(
        "account",
        "001000000000002AAA",
        "001000000000099AAA",
        "r3",
      ),
    ).rejects.toThrow();
    await s.idMap.setSourceHash("account", "001000000000001AAA", "h1", "r3");
    await s.idMap.setVerified("account", "001000000000001AAA", "h1", "t");
    expect(await s.idMap.get("account", "001000000000001AAA")).toMatchObject({
      sourceHash: "h1",
      verifiedHash: "h1",
      lastSeenRun: "r3",
    });
    const seen: string[] = [];
    for await (const r of s.idMap.iterate("account", "US")) seen.push(r.sfdcId);
    expect(seen).toHaveLength(4);
    expect(await s.idMap.purgeDryRun()).toBe(1);
    expect(await s.idMap.get("account", "001000000000005AAA")).toBeUndefined();
  });
  it("rowResults: upsert, query filters, counts", async () => {
    const s = await makeStore();
    const base = {
      runId: "r1",
      objectKey: "account" as const,
      country: "US",
      attempt: 1,
      updatedAt: "t",
    };
    await s.rowResults.upsert([
      {
        ...base,
        sfdcId: "001000000000001AAA",
        state: "loaded_created",
        batchNo: 1,
      },
      {
        ...base,
        sfdcId: "001000000000002AAA",
        state: "failed",
        errorType: "INVALID_DATA",
        batchNo: 1,
      },
      {
        ...base,
        sfdcId: "001000000000003AAA",
        state: "failed",
        errorType: "UNRESOLVED_FK",
        batchNo: 2,
      },
    ]);
    await s.rowResults.upsert([
      {
        ...base,
        sfdcId: "001000000000001AAA",
        state: "loaded_updated",
        batchNo: 1,
        attempt: 2,
      },
    ]);
    expect(
      (await s.rowResults.get("r1", "account", "001000000000001"))?.state,
    ).toBe("loaded_updated");
    expect(
      await s.rowResults.query({ runId: "r1", state: "failed" }),
    ).toHaveLength(2);
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
      await s.rowResults.query({ runId: "r1", limit: 1, offset: 2 }),
    ).toHaveLength(1);
    expect(await s.rowResults.countByState("r1", "account", "US")).toEqual({
      loaded_updated: 1,
      failed: 2,
    });
    expect(await s.rowResults.countFailedByType("r1", "account", "US")).toEqual(
      { INVALID_DATA: 1, UNRESOLVED_FK: 1 },
    );
  });
  it("pendingFk and fkIndex", async () => {
    const s = await makeStore();
    const p = {
      runId: "r1",
      objectKey: "call2" as const,
      country: "US",
      sfdcId: "a0K000000000001EAA",
      field: "account__v",
      targetObjectKey: "account" as const,
      targetSfdcId: "001000000000009AAA",
      attempts: 0,
    };
    await s.pendingFk.add([
      p,
      {
        ...p,
        field: "user__v",
        targetObjectKey: "user",
        targetSfdcId: "005000000000001AAA",
      },
    ]);
    await s.pendingFk.bumpAttempts(
      "r1",
      "call2",
      "a0K000000000001EAA",
      "account__v",
    );
    await s.pendingFk.add([p]); // upsert keeps attempts
    expect(
      (await s.pendingFk.list("r1")).find((x) => x.field === "account__v")
        ?.attempts,
    ).toBe(1);
    await s.pendingFk.resolve(
      "r1",
      "call2",
      "a0K000000000001EAA",
      "account__v",
      "t",
    );
    expect(await s.pendingFk.list("r1", { unresolvedOnly: true })).toHaveLength(
      1,
    );
    expect(await s.pendingFk.countUnresolved("r1", "call2", "US")).toBe(1);
    await s.fkIndex.put([
      {
        objectKey: "call2",
        sfdcId: "a0K000000000001EAA",
        field: "account__v",
        targetObjectKey: "account",
        targetSfdcId: "001000000000001AAA",
        runId: "r1",
      },
      {
        objectKey: "address",
        sfdcId: "a0A000000000001AAA",
        field: "account__v",
        targetObjectKey: "account",
        targetSfdcId: "001000000000001AAA",
        runId: "r1",
      },
    ]);
    expect(
      await s.fkIndex.childrenOf("account", "001000000000001"),
    ).toHaveLength(2);
    expect(await s.fkIndex.get("call2", "a0K000000000001EAA")).toHaveLength(1);
  });
  it("checkpoints, findings, reconciliation, snapshots, audit, probes, frozen countries", async () => {
    const s = await makeStore();
    await s.runs.create(run("r1"));
    await s.runs.create(run("r2"));
    await s.checkpoints.add({
      runId: "r1",
      objectKey: "account",
      country: "US",
      jobId: "j",
      pageNo: 1,
      rows: 10,
      file: "f1",
    });
    await s.checkpoints.add({
      runId: "r1",
      objectKey: "account",
      country: "US",
      jobId: "j",
      pageNo: 0,
      rows: 10,
      file: "f0",
      locator: null,
    });
    await s.checkpoints.complete("r1", "j", 0, "t");
    const cps = await s.checkpoints.list("r1", "account", "US");
    expect(cps.map((c) => c.pageNo)).toEqual([0, 1]);
    expect(cps[0].completedAt).toBe("t");
    await s.findings.add("r1", [
      {
        severity: "blocking",
        code: "VT_FIELD_MISSING",
        objectKey: "account",
        country: "US",
        field: "x__v",
        detail: "gone",
      },
    ]);
    await s.findings.add("r2", [
      {
        severity: "info",
        code: "LEGACY_ID_FIELD_SELECTED",
        objectKey: "account",
        detail: "legacy_crm_id__v",
      },
    ]);
    expect(await s.findings.list("r1", { severity: "blocking" })).toHaveLength(
      1,
    );
    expect(
      await s.findings.list("r2", { code: "VT_FIELD_MISSING" }),
    ).toHaveLength(0);
    expect((await s.findings.previous("r2")).map((f) => f.code)).toEqual([
      "VT_FIELD_MISSING",
    ]);
    await s.reconciliation.upsert({
      runId: "r1",
      objectKey: "account",
      country: "US",
      extracted: 3,
      transformed: 3,
      skipped: 0,
      pendingFk: 0,
      created: 3,
      updated: 0,
      unchanged: 0,
      failed: 0,
      deleted: 0,
      status: "pass",
    });
    expect((await s.reconciliation.get("r1", "account", "US"))?.created).toBe(
      3,
    );
    expect(await s.reconciliation.list("r1")).toHaveLength(1);
    const snap = {
      mappingHash: "h",
      objectKey: "account" as const,
      country: "US",
      materialised: {} as never,
      createdAt: "2026-01-01T00:00:00Z",
    };
    await s.mappingSnapshots.put(snap);
    await s.mappingSnapshots.put({
      ...snap,
      mappingHash: "h2",
      createdAt: "2026-02-01T00:00:00Z",
    });
    expect(
      (await s.mappingSnapshots.get("h", "account", "US"))?.mappingHash,
    ).toBe("h");
    expect(
      (await s.mappingSnapshots.latestFor("account", "US"))?.mappingHash,
    ).toBe("h2");
    await s.auditLog.append({
      runId: "r1",
      at: "t",
      actor: "cli",
      event: "run.start",
      detail: { mode: "init" },
    });
    await s.auditLog.append({
      runId: "r1",
      at: "t",
      actor: "cli",
      event: "run.end",
    });
    expect((await s.auditLog.list({ runId: "r1" })).map((e) => e.id)).toEqual([
      1, 2,
    ]);
    expect(await s.auditLog.list({ event: "run.end", limit: 1 })).toHaveLength(
      1,
    );
    await s.probeResults.set({
      vaultDns: "x",
      probe: "rollupRecalc",
      result: { available: false },
      checkedAt: "t",
    });
    expect((await s.probeResults.get("rollupRecalc"))?.result).toEqual({
      available: false,
    });
    expect((await s.probeResults.list())[0].vaultDns).toBe(
      "test.veevavault.com",
    );
    await s.countryStatus.setFrozen("NL", "t");
    expect(await s.countryStatus.isFrozen("NL")).toBe(true);
    expect(await s.countryStatus.list()).toEqual([
      { country: "NL", frozenAt: "t" },
    ]);
    await s.countryStatus.setFrozen("NL", null);
    expect(await s.countryStatus.isFrozen("NL")).toBe(false);
    await s.close();
  });
  it("returns copies, not live references", async () => {
    const s = await makeStore();
    await s.idMap.put(idRow("001000000000001AAA"));
    const a = (await s.idMap.get("account", "001000000000001AAA"))!;
    a.vaultId = "mutated";
    expect((await s.idMap.get("account", "001000000000001AAA"))?.vaultId).toBe(
      "V1AAA",
    );
  });
});

// ---------------------------------------------------------------------------
// (2) shared contract + postgres specifics
// ---------------------------------------------------------------------------

if (url) {
  stateStoreContract("postgres", makeStore, { cleanup: async () => undefined });
} else {
  describe("StateStore contract (postgres)", () => {
    it.skip("skipped: MIG_TEST_DATABASE_URL unset", () => undefined);
  });
}

describe.skipIf(!url)("PostgresStateStore specifics", () => {
  it("migrate is idempotent and concurrent-safe; schema objects exist", async () => {
    const s = (await makeStore()) as PostgresStateStore;
    await Promise.all([s.migrate(), s.migrate(), s.migrate()]);
    const tables = await shared!.query(
      `select table_name from information_schema.tables where table_schema = $1 order by 1`,
      [SCHEMA],
    );
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining([
        "id_map",
        "watermarks",
        "runs",
        "row_results",
        "pending_fk",
        "extract_checkpoints",
        "preflight_findings",
        "reconciliation",
        "mapping_snapshots",
        "fk_index",
        "audit_log",
        "probe_results",
      ]),
    );
    const idx = await shared!.query(
      `select indexdef from pg_indexes where schemaname = $1 and indexname = 'id_map_vault_uidx'`,
      [SCHEMA],
    );
    expect(idx[0]?.indexdef).toMatch(
      /UNIQUE INDEX id_map_vault_uidx .* WHERE \(\(merged_into IS NULL\) AND \(deleted_at IS NULL\)\)/,
    );
    const version = await shared!.query(
      `select version from "${SCHEMA}"."schema_migrations"`,
    );
    expect(version).toEqual([{ version: 1 }]);
  });

  it("scopes the id map per vault_dns within one database", async () => {
    const a = await makeStore();
    const b = new PostgresStateStore({
      vaultDns: "sandbox.veevavault.com",
      executor: shared!,
      schema: SCHEMA,
    });
    await a.idMap.put(idRow("001000000000001AAA", { vaultId: "V1" }));
    await b.idMap.put(idRow("001000000000001AAA", { vaultId: "V1" })); // same vault id, other vault → allowed
    expect((await a.idMap.get("account", "001000000000001AAA"))?.vaultDns).toBe(
      "test.veevavault.com",
    );
    expect((await b.idMap.get("account", "001000000000001AAA"))?.vaultDns).toBe(
      "sandbox.veevavault.com",
    );
    expect(await a.idMap.count("account")).toBe(1);
    expect(await b.idMap.count("account")).toBe(1);
    await b.idMap.put(idRow("001000000000002AAA", { vaultId: "V2" }));
    expect(await a.idMap.count("account")).toBe(1);
    expect(await b.probeResults.list()).toEqual([]);
    await a.probeResults.set({
      vaultDns: "x",
      probe: "p",
      result: {},
      checkedAt: "t",
    });
    expect(await b.probeResults.list()).toEqual([]);
    expect(await a.idMap.purgeDryRun()).toBe(0);
  });

  it("bulk paths: 2 500 rows in unnest batches, bulkGet, cursor iterate, jsonb round trip", async () => {
    const s = await makeStore();
    const rows = Array.from({ length: 2500 }, (_, i) =>
      idRow(`001${String(i + 1).padStart(12, "0")}AAA`, {
        vaultId: `V${i + 1}`,
        objectType: i % 2 ? "person__v" : null,
      }),
    );
    await s.idMap.putMany(rows);
    expect(await s.idMap.count("account", "US")).toBe(2500);
    const got = await s.idMap.bulkGet(
      "account",
      rows.slice(0, 1200).map((r) => r.sfdcId),
    );
    expect(got.size).toBe(1200);
    let n = 0;
    for await (const r of s.idMap.iterate("account")) {
      n++;
      expect(r.vaultDns).toBe("test.veevavault.com");
    }
    expect(n).toBe(2500);
    await s.rowResults.upsert(
      rows.map((r) => ({
        runId: "r1",
        objectKey: "account" as const,
        country: "US",
        sfdcId: r.sfdcId,
        state: "loaded_created" as const,
        attempt: 1,
        updatedAt: "t",
        errorMessage: 'it\'s "quoted", with {braces} and \\ backslash',
      })),
    );
    expect(
      (await s.rowResults.get("r1", "account", rows[7].sfdcId))?.errorMessage,
    ).toBe('it\'s "quoted", with {braces} and \\ backslash');
    await s.findings.add("r1", [
      {
        severity: "info",
        code: "C",
        detail: { text: 'a "b" \\ c', arr: [1, { x: null }] },
      },
    ]);
    expect((await s.findings.list("r1"))[0].detail).toEqual({
      text: 'a "b" \\ c',
      arr: [1, { x: null }],
    });
    await s.runs.create(run("r1", { countries: ["US", "DE"], wave: 'w "1"' }));
    expect(await s.runs.get("r1")).toMatchObject({
      countries: ["US", "DE"],
      wave: 'w "1"',
    });
  });
});
