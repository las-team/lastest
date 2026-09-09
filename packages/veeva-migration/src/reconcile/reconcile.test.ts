import { beforeEach, describe, expect, it } from "vitest";
import { hashObject } from "../hash";
import type { PayloadRow } from "../load/types";
import type { ResolvedTarget } from "../preflight/types";
import {
  FakeSfdcClient,
  FakeVaultClient,
  MemoryStateStore,
  buildDescribe,
  buildMaterialisedMapping,
  buildVaultMetadata,
  resolveMetadata,
} from "../testkit";
import { to18 } from "../transform/ids";
import { parseTransform } from "../transform/spec";
import type { RowResult, RowState } from "../types";
import { DefaultReconciler, canonicalValue } from "./index";
import type { ReconcileInput } from "./types";

const ACC1 = to18("001000000000001");
const ACC2 = to18("001000000000002");
const ADDR = [
  to18("a0A000000000001"),
  to18("a0A000000000002"),
  to18("a0A000000000003"),
];
const NOW = "2026-09-07T12:00:00.000Z";

function addressMeta() {
  return buildVaultMetadata("address__v", [
    {
      name: "account__v",
      type: "Object",
      object: { name: "account__v" },
      required: true,
    },
    { name: "city__v", type: "String" },
    { name: "primary__v", type: "Boolean" },
  ]);
}

function payloadRow(
  sfdcId: string,
  account: string,
  city: string,
  name = `addr ${sfdcId}`,
): PayloadRow {
  const payload = {
    legacy_crm_id__v: sfdcId,
    name__v: name,
    account__v: { $fk: { object: "account" as const, sfdcId: account } },
    city__v: city,
    primary__v: true,
  };
  return {
    sfdcId,
    systemModstamp: NOW,
    payload,
    sourceHash: hashObject({ m: "mh", p: payload, s: {} }),
    diagnostics: [],
  };
}

describe("DefaultReconciler (§2.8 / §8.8)", () => {
  let vault: FakeVaultClient;
  let sfdc: FakeSfdcClient;
  let store: MemoryStateStore;
  let rows: PayloadRow[];
  let accountIds: Record<string, string>;
  let addressIds: Record<string, string>;

  const mapping = () =>
    buildMaterialisedMapping({
      objectKey: "address",
      sourceObject: "Address_vod__c",
      targetObject: "address__v",
      dependsOn: ["account"],
      fields: [
        {
          source: "Id",
          target: "legacy_crm_id__v",
          transform: parseTransform("legacyId"),
          required: "K",
        },
        {
          source: "Name",
          target: "name__v",
          transform: parseTransform("text"),
          required: "Y",
        },
        {
          source: "Account_vod__c",
          target: "account__v",
          transform: parseTransform("ref(account)"),
          required: "Y",
        },
        {
          source: "City_vod__c",
          target: "city__v",
          transform: parseTransform("text"),
          required: "n",
        },
        {
          source: "Primary_vod__c",
          target: "primary__v",
          transform: parseTransform("bool"),
          required: "n",
        },
      ],
    });

  const target = (): ResolvedTarget => {
    const m = addressMeta();
    return {
      objectKey: "address",
      targetObject: "address__v",
      legacyIdField: "legacy_crm_id__v",
      metadata: resolveMetadata(m),
      rawMetadata: m,
      objectTypes: [],
      picklists: {},
      replicateable: true,
      columns: [],
    };
  };

  const input = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
    runId: "run-1",
    unit: { objectKey: "address", country: "US" },
    mapping: mapping(),
    target: target(),
    manifest: {
      unit: { objectKey: "address", country: "US" },
      files: [],
      fkSets: new Map(),
      extractedLive: 3,
      extractedDeleted: 0,
      closureRows: 0,
      sfdcScopeCount: 3,
      deletedIds: [],
      predicate: "",
      columns: [],
      queueOwners: new Set(),
    },
    tolerance: 0,
    sampleSize: 200,
    ...over,
  });

  const reconciler = (payloads = rows) =>
    new DefaultReconciler(
      { sfdc, vault, store },
      {
        now: () => new Date(NOW),
        readPayloads: async function* () {
          yield* payloads;
        },
      },
    );

  const rr = (
    sfdcId: string,
    state: RowState,
    extra: Partial<RowResult> = {},
  ): RowResult => ({
    runId: "run-1",
    objectKey: "address",
    country: "US",
    sfdcId,
    state,
    attempt: 1,
    updatedAt: NOW,
    vaultId: addressIds[sfdcId] ?? null,
    ...extra,
  });

  beforeEach(async () => {
    vault = new FakeVaultClient();
    vault
      .addObject(buildVaultMetadata("account__v", []))
      .addObject(addressMeta());
    await vault.authenticate();
    sfdc = new FakeSfdcClient({ now: NOW });
    sfdc.addDescribe(
      buildDescribe("Address_vod__c", [
        { name: "Account_vod__c", type: "reference", referenceTo: ["Account"] },
      ]),
    );
    store = new MemoryStateStore(vault.vaultDns);
    const acc = await vault.upsert(
      "account__v",
      [ACC1, ACC2].map((id) => ({ legacy_crm_id__v: id, name__v: id })),
      { idParam: "legacy_crm_id__v", migrationMode: true },
    );
    accountIds = {
      [ACC1]: acc.data[0].data!.id!,
      [ACC2]: acc.data[1].data!.id!,
    };
    await store.seedIdMap("account", "account__v", accountIds, "US");
    rows = [
      payloadRow(ADDR[0], ACC1, "Boston"),
      payloadRow(ADDR[1], ACC1, "Zürich", "addr Zürich"),
      payloadRow(ADDR[2], ACC2, "Berlin"),
    ];
    // "load" the rows the way the loader would: resolved FKs to Vault, id map with source_hash, row_results
    const res = await vault.upsert(
      "address__v",
      rows.map((r) => ({
        legacy_crm_id__v: r.sfdcId,
        name__v: r.payload.name__v as string,
        account__v:
          accountIds[
            (r.payload.account__v as { $fk: { sfdcId: string } }).$fk.sfdcId
          ],
        city__v: r.payload.city__v as string,
        primary__v: true,
      })),
      { idParam: "legacy_crm_id__v", migrationMode: true },
    );
    addressIds = Object.fromEntries(
      rows.map((r, i) => [r.sfdcId, res.data[i].data!.id!]),
    );
    for (const r of rows) {
      await store.idMap.put({
        objectKey: "address",
        sfdcId: r.sfdcId,
        vaultDns: vault.vaultDns,
        vaultObject: "address__v",
        vaultId: addressIds[r.sfdcId],
        country: "US",
        matchMethod: "created",
        firstSeenRun: "run-1",
        lastSeenRun: "run-1",
        sourceHash: r.sourceHash,
      });
      sfdc.addRows("Address_vod__c", [
        {
          Id: r.sfdcId,
          IsDeleted: false,
          SystemModstamp: NOW,
          Account_vod__c: ACC1,
        },
      ]);
    }
    await store.rowResults.upsert([
      rr(ADDR[0], "loaded_created"),
      rr(ADDR[1], "loaded_created"),
      rr(ADDR[2], "loaded_updated"),
    ]);
  });

  it("counts from row_results satisfy the §2.8 invariants: vault count via VQL PAGESIZE 0, equal aggregate hashes → pass", async () => {
    const r = await reconciler().reconcileUnit(input());
    expect(r.pass).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.row).toMatchObject({
      sfdcScopeCount: 3,
      extracted: 3,
      closure: 0,
      created: 2,
      updated: 1,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      pendingFk: 0,
      deleted: 0,
      vaultCount: 3,
      status: "pass",
    });
    expect(r.row.aggHashSrc).toMatch(/^3:[0-9a-f]+$/);
    expect(r.row.aggHashSrc).toBe(r.row.aggHashTgt);
    expect(r.orphanFks).toEqual([]);
    const countQuery = vault.calls.find((c) => c.method === "vqlCount")!
      .args[0] as string;
    expect(countQuery).toBe(
      "SELECT id FROM address__v WHERE legacy_crm_id__v != null PAGESIZE 0",
    );
    expect(
      (await store.reconciliation.list("run-1")).map((x) => x.status),
    ).toEqual(["pass"]);
    // orphan check is one VQL count per required reference field
    expect(
      vault.calls.filter((c) => c.method === "vqlCount").map((c) => c.args[0]),
    ).toContain(
      "SELECT id FROM address__v WHERE account__v = null AND legacy_crm_id__v != null PAGESIZE 0",
    );
  });

  it("uses the country predicate for country-scoped vault counts", async () => {
    await reconciler().reconcileUnit(
      input({ vaultCountryPredicate: "country__v = 'V0C1'" }),
    );
    expect(vault.calls.find((c) => c.method === "vqlCount")!.args[0]).toBe(
      "SELECT id FROM address__v WHERE legacy_crm_id__v != null AND country__v = 'V0C1' PAGESIZE 0",
    );
  });

  it("fails the gate on failed / pending rows and undocumented skips, with per-type breakdowns", async () => {
    await store.rowResults.upsert([
      rr(ADDR[2], "failed", { errorType: "INVALID_DATA", errorMessage: "bad" }),
    ]);
    const r = await reconciler().reconcileUnit(input());
    expect(r.pass).toBe(false);
    expect(r.row).toMatchObject({
      created: 2,
      updated: 0,
      failed: 1,
      failedByType: { INVALID_DATA: 1 },
      status: "fail",
    });
    expect(r.findings.map((f) => f.code)).toEqual(["RECON_FAILED_ROWS"]);
    expect((await store.findings.list("run-1")).map((f) => f.code)).toEqual([
      "RECON_FAILED_ROWS",
    ]);

    await store.rowResults.upsert([
      rr(ADDR[2], "skipped", { errorType: "erased" }),
      rr(ADDR[1], "skipped", { errorType: "weird" }),
    ]);
    const s = await reconciler().reconcileUnit(input({ runId: "run-1" }));
    expect(s.row).toMatchObject({
      skipped: 2,
      skippedByReason: { erased: 1, weird: 1 },
    });
    expect(s.findings.map((f) => f.code)).toEqual(["RECON_SKIP_UNDOCUMENTED"]);
  });

  it("detects a row loaded without its id-map bookkeeping through the aggregate hashes", async () => {
    await store.idMap.setSourceHash("address", ADDR[1], "stale-hash", "run-0");
    const r = await reconciler().reconcileUnit(input());
    expect(r.pass).toBe(false);
    expect(r.row.aggHashSrc).not.toBe(r.row.aggHashTgt);
    expect(r.findings.map((f) => f.code)).toEqual(["RECON_AGG_HASH_MISMATCH"]);
  });

  it("orphan required FKs found by VQL fail the gate; vault_count below loaded fails too", async () => {
    vault.record("address__v", addressIds[ADDR[0]])!.account__v = null;
    const r = await reconciler().reconcileUnit(input());
    expect(r.pass).toBe(false);
    expect(r.orphanFks).toEqual([{ field: "account__v", count: 1 }]);
    expect(r.findings.map((f) => f.code)).toEqual(["RECON_ORPHAN_FK"]);

    vault.record("address__v", addressIds[ADDR[0]])!.account__v =
      accountIds[ACC1];
    vault.record("address__v", addressIds[ADDR[2]])!.legacy_crm_id__v = null;
    const low = await reconciler().reconcileUnit(input());
    expect(low.row.vaultCount).toBe(2);
    expect(low.findings.map((f) => f.code)).toEqual(["RECON_VAULT_COUNT_LOW"]);
  });

  it("final-delta exceptions file accepts documented failures", async () => {
    await store.rowResults.upsert([
      rr(ADDR[2], "failed", { errorType: "INVALID_DATA" }),
    ]);
    const rec = new DefaultReconciler(
      { sfdc, vault, store },
      {
        readPayloads: async function* () {
          yield* rows;
        },
        exceptions: {
          units: { "address:US": { reason: "triage", allowFailed: 1 } },
        },
      },
    );
    const r = await rec.reconcileUnit(input());
    expect(r.pass).toBe(true);
    expect(r.findings.map((f) => [f.code, f.severity])).toEqual([
      ["RECON_FAILED_ROWS", "info"],
      ["RECON_GATE_EXCEPTION", "info"],
    ]);
  });

  it("sample read-back diffs field by field after canonicalisation and marks clean rows verified", async () => {
    const clean = await reconciler().sample(input());
    expect(clean).toEqual([]);
    expect((await store.idMap.get("address", ADDR[0]))?.verifiedAt).toBe(NOW);
    // drift in Vault: a renamed city and a re-pointed parent
    vault.record("address__v", addressIds[ADDR[1]])!.city__v = "Zurich";
    vault.record("address__v", addressIds[ADDR[2]])!.account__v =
      accountIds[ACC1];
    // sampleSize 1 → first row of the single stratum + boundary cases (longest name = ADDR[0], non-ASCII name = ADDR[1]); ADDR[2] is not sampled
    const diffs = await reconciler().sample(input({ sampleSize: 1 }));
    expect(diffs.map((d) => [d.sfdcId, d.field, d.expected, d.actual])).toEqual(
      [[ADDR[1], "city__v", "Zürich", "Zurich"]],
    );
    const all = await reconciler().sample(input());
    expect(all.map((d) => `${d.sfdcId}:${d.field}`).sort()).toEqual(
      [`${ADDR[1]}:city__v`, `${ADDR[2]}:account__v`].sort(),
    );
    expect(all.find((d) => d.field === "account__v")).toMatchObject({
      expected: accountIds[ACC2],
      actual: accountIds[ACC1],
    });
    const q = vault.calls.filter((c) => c.method === "vql").at(-1)!
      .args[0] as string;
    expect(q).toMatch(
      /^SELECT id, legacy_crm_id__v, name__v, account__v, city__v, primary__v FROM address__v WHERE id IN \(/,
    );
    expect((await store.findings.list("run-1")).map((f) => f.code)).toContain(
      "RECON_SAMPLE_DIFF",
    );
    // a record missing in Vault is reported on `id`
    vault.record("address__v", addressIds[ADDR[0]])!.legacy_crm_id__v = null;
    (vault as unknown as { objects: Map<string, Map<string, unknown>> }).objects
      .get("address__v")!
      .delete(addressIds[ADDR[0]]);
    expect(
      (await reconciler().sample(input())).find((d) => d.sfdcId === ADDR[0]),
    ).toMatchObject({ field: "id", actual: null });
  });

  it("key-set reconciliation compares the id map with Vault legacy ids and live SFDC ids", async () => {
    const ok = await reconciler().keySet(input());
    expect(ok).toEqual({ missingInVault: [], goneInSource: [] });
    vault.record("address__v", addressIds[ADDR[1]])!.legacy_crm_id__v = null;
    sfdc.deleteRow("Address_vod__c", ADDR[2], NOW);
    const ks = await reconciler().keySet(input());
    expect(ks).toEqual({ missingInVault: [ADDR[1]], goneInSource: [ADDR[2]] });
    expect((await store.findings.list("run-1")).map((f) => f.code)).toContain(
      "RECON_KEYSET_MISMATCH",
    );
  });

  it("FK-consistency pass compares fk_index expectations with Vault", async () => {
    await store.fkIndex.put(
      rows.map((r) => ({
        objectKey: "address" as const,
        sfdcId: r.sfdcId,
        field: "account__v",
        targetObjectKey: "account" as const,
        targetSfdcId: (r.payload.account__v as { $fk: { sfdcId: string } }).$fk
          .sfdcId,
        runId: "run-1",
      })),
    );
    expect(await reconciler().fkConsistency(input())).toEqual([]);
    vault.record("address__v", addressIds[ADDR[2]])!.account__v =
      accountIds[ACC1];
    const bad = await reconciler().fkConsistency(input());
    expect(bad).toEqual([
      {
        sfdcId: ADDR[2],
        field: "account__v",
        expected: accountIds[ACC2],
        actual: accountIds[ACC1],
      },
    ]);
  });

  it("canonicalValue normalises numbers, datetimes, booleans, arrays and empties", () => {
    expect(canonicalValue("")).toBeNull();
    expect(canonicalValue(null)).toBeNull();
    expect(canonicalValue([])).toBeNull();
    expect(canonicalValue(["a"])).toBe("a");
    expect(canonicalValue(["a", "b"])).toEqual(["a", "b"]);
    expect(canonicalValue("12.50")).toBe(12.5);
    expect(canonicalValue(12.5)).toBe(12.5);
    expect(canonicalValue("2026-01-01T10:00:00Z")).toBe(
      "2026-01-01T10:00:00.000Z",
    );
    expect(canonicalValue("2026-01-01T10:00:00.000+00:00")).toBe(
      "2026-01-01T10:00:00.000Z",
    );
    expect(canonicalValue("true")).toBe(true);
    expect(canonicalValue(" x ")).toBe("x");
    expect(canonicalValue("001000000000001AAA")).toBe("001000000000001AAA"); // ids are not numbers
  });
});
