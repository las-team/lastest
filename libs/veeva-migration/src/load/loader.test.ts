import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultLoader } from "./loader";
import type { LoadPlan, PayloadRow } from "./types";
import { readPendingQueue } from "./pending";
import {
  FakeVaultClient,
  MemoryStateStore,
  buildMaterialisedMapping,
  buildVaultMetadata,
  resolveMetadata,
} from "../testkit";
import { to18 } from "../transform/ids";
import type { ResolvedTarget } from "../preflight/types";
import type { ObjectKey, Unit } from "../types";
import { hashObject } from "../hash";
import { VaultApiError } from "../vault/types";

const ACC1 = to18("001000000000001");
const ACC2 = to18("001000000000002");
const ADDR1 = to18("a0A000000000001");
const ADDR2 = to18("a0A000000000002");
const USER1 = to18("005000000000001");

function accountMeta() {
  return buildVaultMetadata("account__v", [
    { name: "external_id__v", type: "String", unique: true },
    { name: "mobile_id__v", type: "String" },
    { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
    {
      name: "primary_parent__v",
      type: "Object",
      object: { name: "account__v" },
    },
    { name: "inactive__v", type: "Boolean" },
  ]);
}
function addressMeta() {
  return buildVaultMetadata("address__v", [
    {
      name: "account__v",
      type: "Object",
      object: { name: "account__v" },
      required: true,
    },
    { name: "inactive__v", type: "Boolean" },
  ]);
}

function target(
  meta: ReturnType<typeof buildVaultMetadata>,
  objectKey: ObjectKey,
): ResolvedTarget {
  const metadata = resolveMetadata(meta);
  return {
    objectKey,
    targetObject: meta.name,
    legacyIdField: "legacy_crm_id__v",
    metadata,
    rawMetadata: meta,
    objectTypes: [],
    picklists: {},
    replicateable: true,
    columns: [],
  };
}

function row(
  sfdcId: string,
  payload: PayloadRow["payload"],
  extra: Partial<PayloadRow> = {},
): PayloadRow {
  const p = { legacy_crm_id__v: sfdcId, name__v: `row ${sfdcId}`, ...payload };
  return {
    sfdcId,
    systemModstamp: "2026-01-01T00:00:00.000Z",
    payload: p,
    sourceHash: hashObject({ m: "h", p, s: extra.secondPass ?? {} }),
    diagnostics: [],
    ...extra,
  };
}

async function* iter<T>(items: T[]): AsyncIterable<T> {
  for (const i of items) yield i;
}

describe("DefaultLoader", () => {
  let runDir: string;
  let vault: FakeVaultClient;
  let store: MemoryStateStore;
  let loader: DefaultLoader;
  const unitOf = (objectKey: ObjectKey): Unit => ({ objectKey, country: "US" });
  const planFor = (
    objectKey: ObjectKey,
    meta: ReturnType<typeof buildVaultMetadata>,
    over: Partial<LoadPlan> = {},
  ): LoadPlan => ({
    runId: "run-1",
    unit: unitOf(objectKey),
    mapping: buildMaterialisedMapping({
      objectKey,
      targetObject: meta.name,
      fields: [],
      match: [
        { method: "legacy_id" },
        {
          method: "mobile_id",
          keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
        },
      ],
      ...(over.mapping ?? {}),
    }),
    target: target(meta, objectKey),
    runDir,
    dryRun: false,
    migrationMode: true,
    unchangedFieldBehavior: "AlwaysIgnore",
    batchSize: 500,
    batchWallTimeMs: 60000,
    ...over,
  });

  beforeEach(async () => {
    runDir = mkdtempSync(path.join(os.tmpdir(), "vm-load-"));
    vault = new FakeVaultClient();
    vault.addObject(accountMeta()).addObject(addressMeta());
    await vault.authenticate();
    store = new MemoryStateStore(vault.vaultDns);
    await store.seedIdMap("user", "user__sys", { [USER1]: "1001" }, "GLOBAL");
    loader = new DefaultLoader(
      {
        vault,
        store,
        country: "US",
        targetObjectOf: (k) =>
          k === "account"
            ? "account__v"
            : k === "address"
              ? "address__v"
              : undefined,
      },
      { retry: { sleep: async () => {}, policy: { maxAttempts: 3 } } },
    );
  });
  afterEach(() => rmSync(runDir, { recursive: true, force: true }));

  it("upserts by idParam, resolves $user, writes row_results and the id map", async () => {
    const plan = planFor("account", accountMeta());
    const res = await loader.loadBatches(
      iter([row(ACC1, { ownerid__v: { $user: USER1 } }), row(ACC2, {})]),
      plan,
    );
    expect(res.created).toBe(2);
    expect(res.failed).toBe(0);
    const call = vault.calls.find((c) => c.method === "upsert")!;
    expect(call.headers).toMatchObject({
      idParam: "legacy_crm_id__v",
      migrationMode: true,
      noTriggers: true,
      unchangedFieldBehavior: "AlwaysIgnore",
      referenceId: "run-1:account:1",
    });
    const sent = call.args[1] as Array<Record<string, unknown>>;
    expect(sent[0].ownerid__v).toBe(1001);
    const map = await store.idMap.get("account", ACC1);
    expect(map?.matchMethod).toBe("created");
    expect(map?.sourceHash).toBeTruthy();
    const rr = await store.rowResults.get("run-1", "account", ACC1);
    expect(rr?.state).toBe("loaded_created");
    expect(rr?.vaultId).toBe(map?.vaultId);
  });

  it("resolves $fk through the id map at send time and parks unresolved rows in pending_fk", async () => {
    await loader.loadBatches(
      iter([row(ACC1, {})]),
      planFor("account", accountMeta()),
    );
    const plan = planFor("address", addressMeta());
    const res = await loader.loadBatches(
      iter([
        row(ADDR1, {
          account__v: { $fk: { object: "account", sfdcId: ACC1 } },
        }),
        row(ADDR2, {
          account__v: { $fk: { object: "account", sfdcId: ACC2 } },
        }),
      ]),
      plan,
    );
    expect(res.created).toBe(1);
    expect(res.pendingFk).toBe(1);
    const accVault = (await store.idMap.get("account", ACC1))!.vaultId;
    expect(vault.records("address__v")[0].account__v).toBe(accVault);
    expect((await store.rowResults.get("run-1", "address", ADDR2))?.state).toBe(
      "pending_fk",
    );
    expect(
      await store.pendingFk.countUnresolved("run-1", "address", "US"),
    ).toBe(1);
    expect((await readPendingQueue(plan)).map((e) => e.row.sfdcId)).toEqual([
      ADDR2,
    ]);

    // parent lands → the queue resolves on retry
    await loader.loadBatches(
      iter([row(ACC2, {})]),
      planFor("account", accountMeta()),
    );
    const retry = await loader.retryPending(plan, 1);
    expect(retry.created).toBe(1);
    expect(
      await store.pendingFk.countUnresolved("run-1", "address", "US"),
    ).toBe(0);
    expect((await store.rowResults.get("run-1", "address", ADDR2))?.state).toBe(
      "loaded_created",
    );
    expect(await readPendingQueue(plan)).toEqual([]);
  });

  it("finalises leftovers as failed(UNRESOLVED_FK)", async () => {
    const plan = planFor("address", addressMeta());
    await loader.loadBatches(
      iter([
        row(ADDR1, {
          account__v: { $fk: { object: "account", sfdcId: ACC1 } },
        }),
      ]),
      plan,
    );
    const fin = await loader.finalisePending(plan);
    expect(fin.failed).toBe(1);
    expect(fin.targets.account).toEqual([ACC1]);
    expect(await store.rowResults.get("run-1", "address", ADDR1)).toMatchObject(
      { state: "failed", errorType: "UNRESOLVED_FK" },
    );
    expect(loader.drainFindings().map((f) => f.code)).toContain(
      "UNRESOLVED_FK",
    );
  });

  it("hash-skips unchanged rows and dedupes duplicate keys last-wins", async () => {
    const plan = planFor("account", accountMeta());
    const first = await loader.loadBatches(iter([row(ACC1, {})]), plan);
    expect(first.created).toBe(1);
    const again = await loader.loadBatches(iter([row(ACC1, {})]), {
      ...plan,
      runId: "run-2",
    });
    expect(again.unchanged).toBe(1);
    expect(vault.calls.filter((c) => c.method === "upsert")).toHaveLength(1);
    // duplicate keys inside a batch: the newer SystemModstamp wins
    const older = row(
      ACC2,
      { name__v: "old" },
      { systemModstamp: "2026-01-01T00:00:00.000Z" },
    );
    const newer = row(
      ACC2,
      { name__v: "new" },
      { systemModstamp: "2026-02-01T00:00:00.000Z" },
    );
    const res = await loader.loadBatches(iter([newer, older]), {
      ...plan,
      runId: "run-3",
    });
    expect(res.created).toBe(1);
    const sent = vault.calls.filter((c) => c.method === "upsert").at(-1)!
      .args[1] as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(1);
    expect(sent[0].name__v).toBe("new");
  });

  it("matches pre-existing records by a secondary key and updates them by id", async () => {
    const existing = vault.putRecord("account__v", {
      name__v: "Pre-existing",
      mobile_id__v: "MOB-1",
    });
    const plan = planFor("account", accountMeta());
    const res = await loader.loadBatches(
      iter([row(ACC1, { mobile_id__v: "MOB-1" })]),
      plan,
    );
    expect(res.updated).toBe(1);
    expect(res.created).toBe(0);
    expect(vault.calls.some((c) => c.method === "vql")).toBe(true);
    const upd = vault.calls.find((c) => c.method === "update")!;
    expect((upd.args[1] as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: existing.id,
      legacy_crm_id__v: ACC1,
    });
    const map = await store.idMap.get("account", ACC1);
    expect(map).toMatchObject({
      vaultId: existing.id,
      matchMethod: "mobile_id",
    });
    expect(vault.record("account__v", existing.id)?.legacy_crm_id__v).toBe(
      ACC1,
    );
  });

  it("sameCountry restricts secondary-key candidates to the row's country__v (§3.3)", async () => {
    const meta = buildVaultMetadata("account__v", [
      { name: "external_id__v", type: "String", unique: true },
      { name: "mobile_id__v", type: "String" },
      { name: "country__v", type: "Object", object: { name: "country__v" } },
      { name: "inactive__v", type: "Boolean" },
    ]);
    vault.addObject(meta);
    const us = vault.putRecord("account__v", {
      name__v: "US twin",
      mobile_id__v: "MOB-1",
      country__v: "V-US",
    });
    vault.putRecord("account__v", {
      name__v: "DE twin",
      mobile_id__v: "MOB-1",
      country__v: "V-DE",
    });
    const rule = {
      method: "mobile_id" as const,
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
    };
    const input = (id: string) =>
      iter([row(id, { mobile_id__v: "MOB-1", country__v: "V-US" })]);

    const strict = planFor("account", meta);
    strict.mapping.match = [
      { method: "legacy_id" },
      { ...rule, sameCountry: true },
    ];
    const r1 = await loader.loadBatches(input(ACC1), strict);
    expect(r1.updated).toBe(1);
    expect(r1.created).toBe(0);
    const vql = vault.calls.filter((c) => c.method === "vql").at(-1)!;
    expect(String(vql.args[0])).toContain("country__v");
    expect(await store.idMap.get("account", ACC1)).toMatchObject({
      vaultId: us.id,
      matchMethod: "mobile_id",
    });

    // without the flag the two twins are ambiguous → no hit, row is created
    const loose = planFor("account", meta);
    loose.mapping.match = [{ method: "legacy_id" }, rule];
    const r2 = await loader.loadBatches(input(ACC2), loose);
    expect(r2.updated).toBe(0);
    expect(r2.created).toBe(1);
  });

  it("fails unmatched rows under createPolicy match-only and never creates", async () => {
    const plan = planFor("account", accountMeta());
    plan.mapping.options = {
      ...plan.mapping.options,
      createPolicy: "match-only",
    };
    const res = await loader.loadBatches(iter([row(ACC1, {})]), plan);
    expect(res.failed).toBe(1);
    expect(vault.calls.some((c) => c.method === "upsert")).toBe(false);
    expect(
      (await store.rowResults.get("run-1", "account", ACC1))?.errorType,
    ).toBe("MATCH_ONLY_UNMATCHED");
  });

  it("dry-run writes nothing to Vault and simulates counts", async () => {
    const plan = planFor("account", accountMeta(), { dryRun: true });
    const res = await loader.loadBatches(
      iter([row(ACC1, {}), row(ACC2, {})]),
      plan,
    );
    expect(res.created).toBe(2);
    expect(
      vault.calls.filter((c) => c.method === "upsert" || c.method === "update"),
    ).toHaveLength(0);
    expect(vault.records("account__v")).toHaveLength(0);
    // §8.9: only dry_run-flagged rows, purged at the next real run
    expect(await store.idMap.get("account", ACC1)).toMatchObject({
      dryRun: true,
      vaultId: `dry-run:${ACC1}`,
    });
    expect(await store.idMap.purgeDryRun()).toBeGreaterThan(0);
    expect(await store.idMap.get("account", ACC1)).toBeUndefined();
  });

  it("dry-run: children resolve parents simulated earlier in the same dry run (§8.9)", async () => {
    const dry = { dryRun: true };
    await loader.loadBatches(
      iter([row(ACC1, {})]),
      planFor("account", accountMeta(), dry),
    );
    const res = await loader.loadBatches(
      iter([
        row(ADDR1, {
          account__v: { $fk: { object: "account", sfdcId: ACC1 } },
        }),
      ]),
      planFor("address", addressMeta(), dry),
    );
    expect(res).toMatchObject({ created: 1, pendingFk: 0 });
    expect(vault.records("address__v")).toHaveLength(0);
    // a real run never resolves through dry-run rows
    const real = await loader.loadBatches(
      iter([
        row(ADDR1, {
          account__v: { $fk: { object: "account", sfdcId: ACC1 } },
        }),
      ]),
      planFor("address", addressMeta(), { runId: "run-2" }),
    );
    expect(real).toMatchObject({ created: 0, pendingFk: 1 });
  });

  it("match-only rows that are matched but never written are marked so reconciliation skips their hash", async () => {
    const meta = accountMeta();
    const base = planFor("account", meta);
    const plan: LoadPlan = {
      ...base,
      mapping: {
        ...base.mapping,
        options: { ...base.mapping.options, createPolicy: "match-only" },
      },
    };
    await vault.upsert(
      "account__v",
      [{ legacy_crm_id__v: ACC1, name__v: "x" }],
      {
        idParam: "legacy_crm_id__v",
      },
    );
    vault.calls.length = 0;
    const res = await loader.loadBatches(iter([row(ACC1, {})]), plan);
    expect(res).toMatchObject({ unchanged: 1, created: 0, updated: 0 });
    expect(vault.calls.filter((c) => c.method === "update")).toHaveLength(0);
    expect(await store.rowResults.get("run-1", "account", ACC1)).toMatchObject({
      state: "loaded_unchanged",
      errorType: "matched",
    });
    expect((await store.idMap.get("account", ACC1))?.sourceHash).toBeFalsy();
    // same row on a later run: still matched-only, still marked
    const again = await loader.loadBatches(iter([row(ACC1, {})]), {
      ...plan,
      runId: "run-2",
    });
    expect(again.unchanged).toBe(1);
    expect(
      (await store.rowResults.get("run-2", "account", ACC1))?.errorType,
    ).toBe("matched");
  });

  it("a fresh match whose Vault object type differs is routed through changetype, never a plain PUT (§2.5.6)", async () => {
    const meta = buildVaultMetadata(
      "account__v",
      [{ name: "mobile_id__v", type: "String" }],
      { objectTypes: ["professional__v", "business__v"] },
    );
    vault.addObject(meta);
    await vault.upsert(
      "account__v",
      [
        {
          legacy_crm_id__v: ACC1,
          name__v: "pre-existing",
          "object_type__v.api_name__v": "professional__v",
        },
      ],
      { idParam: "legacy_crm_id__v" },
    );
    const plan = planFor("account", meta);
    const changed = row(
      ACC1,
      { "object_type__v.api_name__v": "business__v" },
      { objectType: "business__v" },
    );
    const blocked = await loader.loadBatches(iter([changed]), {
      ...plan,
      mapping: {
        ...plan.mapping,
        options: { ...plan.mapping.options, allowTypeChange: false },
      },
    });
    expect(blocked.failed).toBe(1);
    expect(
      (await store.rowResults.get("run-1", "account", ACC1))?.errorType,
    ).toBe("TYPE_CHANGE_BLOCKED");
    expect(vault.calls.filter((c) => c.method === "update")).toHaveLength(0);
    // the matcher recorded Vault's type, not the payload's
    expect((await store.idMap.get("account", ACC1))?.objectType).toBe(
      "professional__v",
    );
    const allowed = await loader.loadBatches(iter([changed]), {
      ...plan,
      runId: "run-2",
    });
    expect(allowed.typeChanged).toBe(1);
    expect(vault.calls.some((c) => c.method === "changeType")).toBe(true);
    expect((await store.idMap.get("account", ACC1))?.objectType).toBe(
      "business__v",
    );
  });

  it("batch numbers continue across loadBatches / pending / delete calls of a unit (reference ids never repeat)", async () => {
    const plan = planFor("account", accountMeta());
    await loader.loadBatches(iter([row(ACC1, {})]), plan);
    await loader.loadBatches(iter([row(ACC2, {})]), plan);
    const refs = vault.calls
      .filter((c) => c.method === "upsert")
      .map((c) => (c.headers as { referenceId: string }).referenceId);
    expect(refs).toEqual(["run-1:account:1", "run-1:account:2"]);
    await loader.applyDeletes(
      {
        unit: plan.unit,
        policy: "delete",
        ids: [{ sfdcId: ACC1, deletedDate: "2026-02-01T00:00:00.000Z" }],
      },
      plan,
    );
    const del = vault.calls.find((c) => c.method === "deleteRecords")!;
    expect((del.headers as { referenceId: string }).referenceId).toBe(
      "run-1:account:3",
    );
    // a new loader for the same run resumes the counter from row_results
    const resumed = new DefaultLoader(
      { vault, store, country: "US", targetObjectOf: () => "account__v" },
      { retry: { sleep: async () => {}, policy: { maxAttempts: 3 } } },
    );
    await resumed.loadBatches(iter([row(to18("001000000000003"), {})]), plan);
    expect(
      (vault.calls.at(-1)!.headers as { referenceId: string }).referenceId,
    ).toBe("run-1:account:4");
  });

  it("records unresolved pass-2 references as pending_fk diagnostics and closes them once patched", async () => {
    const plan = planFor("account", accountMeta());
    const parent = row(ACC2, {});
    const child = row(
      ACC1,
      {},
      {
        secondPass: {
          primary_parent__v: { $fk: { object: "account", sfdcId: ACC2 } },
        },
      },
    );
    await loader.loadBatches(iter([child]), plan);
    const first = await loader.secondPass(iter([child]), plan);
    expect(first).toMatchObject({ unresolved: 1, patched: 0 });
    expect(first.unresolvedIds).toEqual([ACC1]);
    expect(
      await store.pendingFk.countUnresolved("run-1", "account", "US"),
    ).toBe(1);
    await loader.loadBatches(iter([parent]), plan);
    const second = await loader.secondPass(iter([child]), plan);
    expect(second).toMatchObject({ unresolved: 0, patched: 1 });
    expect(
      await store.pendingFk.countUnresolved("run-1", "account", "US"),
    ).toBe(0);
    const acc2 = (await store.idMap.get("account", ACC2))!.vaultId;
    expect(
      vault.record(
        "account__v",
        (await store.idMap.get("account", ACC1))!.vaultId,
      )?.primary_parent__v,
    ).toBe(acc2);
  });

  it("applies SFDC merges: loser → survivor in the id map and children re-pointed (§3.4 a, §4.2)", async () => {
    await loader.loadBatches(
      iter([row(ACC1, {}), row(ACC2, {})]),
      planFor("account", accountMeta()),
    );
    const addrPlan = planFor("address", addressMeta());
    await loader.loadBatches(
      iter([
        row(ADDR1, {
          account__v: { $fk: { object: "account", sfdcId: ACC2 } },
        }),
      ]),
      addrPlan,
    );
    await store.fkIndex.put([
      {
        objectKey: "address",
        sfdcId: ADDR1,
        field: "account__v",
        targetObjectKey: "account",
        targetSfdcId: ACC2,
        runId: "run-1",
      },
    ]);
    const acc1 = (await store.idMap.get("account", ACC1))!;
    const r = await loader.applyMerges(
      {
        unit: unitOf("account"),
        merges: [
          {
            loser: ACC2,
            survivor: ACC1,
            deletedDate: "2026-02-01T00:00:00.000Z",
          },
        ],
      },
      planFor("account", accountMeta()),
    );
    expect(r).toMatchObject({
      merged: 1,
      childrenRepointed: 1,
      childrenFailed: 0,
    });
    const loser = (await store.idMap.get("account", ACC2))!;
    expect(loser.mergedInto).toBe(ACC1);
    const addr = (await store.idMap.get("address", ADDR1))!;
    expect(vault.record("address__v", addr.vaultId)?.account__v).toBe(
      acc1.vaultId,
    );
    expect(addr.sourceHash).toBeFalsy(); // next delta re-sends the child whole
    expect(await store.rowResults.get("run-1", "address", ADDR1)).toMatchObject(
      {
        state: "loaded_updated",
      },
    );
    // survivor unmapped → skipped, nothing written
    const skipped = await loader.applyMerges(
      {
        unit: unitOf("account"),
        merges: [
          {
            loser: ACC1,
            survivor: to18("001000000000009"),
            deletedDate: "2026-02-01T00:00:00.000Z",
          },
        ],
      },
      planFor("account", accountMeta()),
    );
    expect(skipped).toMatchObject({ merged: 0, skipped: 1 });
  });

  it("aborts the unit on a structural failure with a blocking finding", async () => {
    const plan = planFor("account", accountMeta());
    const res = await loader.loadBatches(
      iter([row(ACC1, { bogus_column__v: "x" })]),
      plan,
    );
    expect(res.aborted?.reason).toMatch(/INVALID_DATA/);
    expect(res.failed).toBe(1);
    expect(loader.drainFindings().map((f) => f.code)).toContain(
      "LOAD_STRUCTURAL_FAILURE",
    );
    expect(vault.calls.filter((c) => c.method === "upsert")).toHaveLength(1); // never retried
  });

  it("retries retryable transport errors and records row-level failures", async () => {
    vault.failNext = {
      method: "upsert",
      error: new VaultApiError("API_LIMIT_EXCEEDED", "burst", "FAILURE"),
      remaining: 1,
    };
    vault.rowFailures.push({
      object: "account__v",
      field: "legacy_crm_id__v",
      value: ACC2,
      type: "INVALID_DATA",
      message: "bad value",
    });
    const plan = planFor("account", accountMeta());
    const res = await loader.loadBatches(
      iter([row(ACC1, {}), row(ACC2, {})]),
      plan,
    );
    expect(vault.calls.filter((c) => c.method === "upsert")).toHaveLength(2);
    expect(res.created).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.aborted).toBeUndefined();
    expect(await store.rowResults.get("run-1", "account", ACC2)).toMatchObject({
      state: "failed",
      errorType: "INVALID_DATA",
    });
  });

  it("patches self references in pass 2 by Vault id", async () => {
    const plan = planFor("account", accountMeta());
    const rows = [
      row(ACC1, {}),
      row(
        ACC2,
        {},
        {
          secondPass: {
            primary_parent__v: { $fk: { object: "account", sfdcId: ACC1 } },
          },
        },
      ),
    ];
    await loader.loadBatches(iter(rows), plan);
    const sp = await loader.secondPass(iter(rows), plan);
    expect(sp).toMatchObject({ patched: 1, failed: 0, unresolved: 0 });
    const parent = (await store.idMap.get("account", ACC1))!.vaultId;
    const child = (await store.idMap.get("account", ACC2))!.vaultId;
    expect(vault.record("account__v", child)?.primary_parent__v).toBe(parent);
    const upd = vault.calls.filter((c) => c.method === "update").at(-1)!;
    expect(upd.headers?.idParam).toBeUndefined();
  });

  it("applies delete policies: delete, inactivate, ignore; last-wins vs. modstamp", async () => {
    const accPlan = planFor("account", accountMeta());
    await loader.loadBatches(iter([row(ACC1, {}), row(ACC2, {})]), accPlan);
    const addrPlan = planFor("address", addressMeta());
    await loader.loadBatches(
      iter([
        row(ADDR1, {
          account__v: { $fk: { object: "account", sfdcId: ACC1 } },
        }),
      ]),
      addrPlan,
    );

    // inactivate account 1 (+ business flag), account 2 survives: updated after the delete event
    accPlan.mapping.options = {
      ...accPlan.mapping.options,
      deletePolicy: "inactivate",
      inactivateBy: [{ field: "inactive__v", value: true }],
    };
    const del = await loader.applyDeletes(
      {
        unit: accPlan.unit,
        policy: "inactivate",
        ids: [
          { sfdcId: ACC1, deletedDate: "2026-03-01T00:00:00.000Z" },
          { sfdcId: ACC2, deletedDate: "2026-03-01T00:00:00.000Z" },
        ],
        seenModstamps: new Map([[ACC2, "2026-03-02T00:00:00.000Z"]]),
      },
      accPlan,
    );
    expect(del).toMatchObject({
      routed: 2,
      applied: 1,
      ignored: 1,
      failed: 0,
      pending: 0,
    });
    const v1 = (await store.idMap.get("account", ACC1))!;
    expect(v1.deletedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(vault.record("account__v", v1.vaultId)).toMatchObject({
      status__v: "inactive__v",
      inactive__v: true,
    });
    expect((await store.rowResults.get("run-1", "account", ACC1))?.state).toBe(
      "inactivated",
    );

    // hard delete the address
    const del2 = await loader.applyDeletes(
      {
        unit: addrPlan.unit,
        policy: "delete",
        ids: [{ sfdcId: ADDR1, deletedDate: "2026-03-01T00:00:00.000Z" }],
      },
      addrPlan,
    );
    expect(del2.applied).toBe(1);
    expect(vault.records("address__v")).toHaveLength(0);
    // repeated delete is a no-op
    const del3 = await loader.applyDeletes(
      {
        unit: addrPlan.unit,
        policy: "delete",
        ids: [{ sfdcId: ADDR1, deletedDate: "2026-03-05T00:00:00.000Z" }],
      },
      addrPlan,
    );
    expect(del3).toMatchObject({ applied: 0, ignored: 1 });
    // ignore policy
    const del4 = await loader.applyDeletes(
      {
        unit: accPlan.unit,
        policy: "ignore",
        ids: [{ sfdcId: ACC2, deletedDate: "2026-03-09T00:00:00.000Z" }],
      },
      accPlan,
    );
    expect(del4).toMatchObject({ routed: 1, ignored: 1, applied: 0 });

    // undelete re-links to the same Vault id and restores status__v
    const res = await loader.loadBatches(
      iter([row(ACC1, { name__v: "back" })]),
      { ...accPlan, runId: "run-9" },
    );
    expect(res.updated).toBe(1);
    const after = (await store.idMap.get("account", ACC1))!;
    expect(after.vaultId).toBe(v1.vaultId);
    expect(after.deletedAt).toBeNull();
    expect(vault.record("account__v", v1.vaultId)?.status__v).toBe("active__v");
  });

  it("routes object-type changes through changetype or blocks them", async () => {
    const meta = buildVaultMetadata(
      "account__v",
      [{ name: "mobile_id__v", type: "String" }],
      { objectTypes: ["professional__v", "business__v"] },
    );
    vault.addObject(meta);
    const plan = planFor("account", meta);
    await loader.loadBatches(
      iter([
        row(
          ACC1,
          { "object_type__v.api_name__v": "professional__v" },
          { objectType: "professional__v" },
        ),
      ]),
      plan,
    );
    expect((await store.idMap.get("account", ACC1))?.objectType).toBe(
      "professional__v",
    );
    const changed = row(
      ACC1,
      { "object_type__v.api_name__v": "business__v" },
      { objectType: "business__v" },
    );
    const blocked = await loader.loadBatches(iter([changed]), {
      ...plan,
      runId: "run-2",
      mapping: {
        ...plan.mapping,
        options: { ...plan.mapping.options, allowTypeChange: false },
      },
    });
    expect(blocked.failed).toBe(1);
    expect(
      (await store.rowResults.get("run-2", "account", ACC1))?.errorType,
    ).toBe("TYPE_CHANGE_BLOCKED");
    const allowed = await loader.loadBatches(iter([changed]), {
      ...plan,
      runId: "run-3",
    });
    expect(allowed.typeChanged).toBe(1);
    expect(vault.calls.some((c) => c.method === "changeType")).toBe(true);
    expect((await store.idMap.get("account", ACC1))?.objectType).toBe(
      "business__v",
    );
  });

  it("resumes: rows with a terminal row_results state in the same run are not re-sent", async () => {
    const plan = planFor("account", accountMeta());
    await loader.loadBatches(iter([row(ACC1, {})]), plan);
    const again = await loader.loadBatches(
      iter([row(ACC1, {}), row(ACC2, {})]),
      plan,
    );
    expect(again.created).toBe(1);
    const sent = vault.calls.filter((c) => c.method === "upsert").at(-1)!
      .args[1] as unknown[];
    expect(sent).toHaveLength(1);
  });
});
