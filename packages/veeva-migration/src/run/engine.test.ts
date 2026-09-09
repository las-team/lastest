import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_CODES } from "./types";
import {
  ACC,
  ADDR,
  CALL,
  NOW,
  T0,
  makeHarness,
  seedUsers,
  type Harness,
} from "./test-helpers";
import { unitId } from "../types";
import { VaultApiError } from "../vault/types";

describe("DefaultRunEngine", () => {
  let runDir: string;
  let h: Harness;
  beforeEach(async () => {
    runDir = mkdtempSync(path.join(os.tmpdir(), "vm-run-"));
    h = makeHarness(runDir);
    await seedUsers(h.store);
  });
  afterEach(() => rmSync(runDir, { recursive: true, force: true }));

  const init = (extra: Record<string, unknown> = {}) =>
    h.engine.execute({ mode: "init", config: h.config, wave: "w1", ...extra });

  it("plans units × wave countries in dependency order with pass-2 patches", async () => {
    const plan = await h.engine.plan({
      mode: "init",
      config: h.config,
      wave: "w1",
    });
    expect(plan.countries).toEqual(["US"]);
    expect(plan.steps.map((s) => s.keys)).toEqual([
      ["account"],
      ["address", "call2"],
    ]);
    expect(plan.steps[0].pass2).toEqual([
      {
        objectKey: "account",
        target: "primary_parent__v",
        source: "Primary_Parent_vod__c",
        refKey: "account",
      },
    ]);
    expect(plan.steps[1].units.map(unitId)).toEqual(["address:US", "call2:US"]);
    expect(plan.mappings.get("call2:US")?.mappingHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(plan.cutoffDates.get("US")).toBe("2024-09-07");
  });

  it("init: loads account → address → call2 resolving FKs through the id map and patching self references", async () => {
    const summary = await init();
    expect(summary.exitCode).toBe(EXIT_CODES.success);
    expect(summary.units.map((u) => `${unitId(u.unit)}=${u.status}`)).toEqual([
      "account:US=succeeded",
      "address:US=succeeded",
      "call2:US=succeeded",
    ]);

    const accounts = h.vault.records("account__v");
    expect(accounts.map((a) => a.legacy_crm_id__v).sort()).toEqual(
      [ACC[0], ACC[1]].sort(),
    ); // DE account out of the wave
    const acc0 = (await h.store.idMap.get("account", ACC[0]))!;
    const acc1 = (await h.store.idMap.get("account", ACC[1]))!;
    expect(h.vault.record("account__v", acc1.vaultId)?.primary_parent__v).toBe(
      acc0.vaultId,
    ); // pass 2
    const addresses = h.vault.records("address__v");
    expect(addresses.map((a) => a.account__v).sort()).toEqual(
      [acc0.vaultId, acc1.vaultId].sort(),
    );
    const call1 = (await h.store.idMap.get("call2", CALL[1]))!;
    const call0 = (await h.store.idMap.get("call2", CALL[0]))!;
    expect(h.vault.record("call2__v", call1.vaultId)).toMatchObject({
      account__v: acc1.vaultId,
      parent_call__v: call0.vaultId,
      call_date__v: "2026-01-05",
    });

    // payload files never hold Vault ids
    const payload = JSON.parse(
      readFileSync(
        path.join(
          runDir,
          summary.runId,
          "US",
          "address",
          "payload",
          "batch-00000.json",
        ),
        "utf8",
      ),
    ) as Array<{ payload: Record<string, unknown> }>;
    expect(payload[0].payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: ACC[0] },
    });

    // watermarks advanced to wm_hi = sfdc_now − 5 min, with the cutoff in force
    const wm = await h.store.watermarks.get("call2", "US", "modstamp");
    expect(wm).toMatchObject({
      value: "2026-09-07T11:55:00.000Z",
      cutoffDate: "2024-09-07",
      runId: summary.runId,
    });
    expect(
      (await h.store.watermarks.get("address", "US", "deleted"))?.value,
    ).toBe("2026-09-07T11:55:00.000Z");

    // reconciliation rows pass the §2.8 invariants
    const recon = await h.store.reconciliation.list(summary.runId);
    expect(recon.map((r) => `${r.objectKey}:${r.status}`)).toEqual([
      "account:pass",
      "address:pass",
      "call2:pass",
    ]);
    const acc = recon.find((r) => r.objectKey === "account")!;
    expect(acc).toMatchObject({
      sfdcScopeCount: 2,
      extracted: 2,
      created: 2,
      updated: 0,
      unchanged: 0,
      failed: 0,
      pendingFk: 0,
      skipped: 0,
      vaultCount: 2,
    });
    expect(acc.aggHashSrc).toBe(acc.aggHashTgt);
    // run record + report
    const run = (await h.store.runs.get(summary.runId))!;
    expect(run.status).toBe("succeeded");
    expect(run.sfdcNowAtStart).toBe(NOW);
    expect(existsSync(summary.reportPath!)).toBe(true);
    expect(existsSync(path.join(runDir, summary.runId, "report.json"))).toBe(
      true,
    );
    expect(readFileSync(summary.reportPath!, "utf8")).toContain(
      "account:US | pass",
    );
    expect(h.vault.session).toBeUndefined(); // session ended
  });

  it("init is re-runnable: a second init hash-skips unchanged rows", async () => {
    await init();
    const upserts = h.vault.calls.filter((c) => c.method === "upsert").length;
    const second = await init();
    expect(second.exitCode).toBe(0);
    expect(h.vault.calls.filter((c) => c.method === "upsert").length).toBe(
      upserts,
    );
    const recon = (await h.store.reconciliation.list(second.runId)).find(
      (r) => r.objectKey === "account",
    )!;
    expect(recon).toMatchObject({ created: 0, unchanged: 2, status: "pass" });
  });

  it("dry-run writes nothing to Vault, no id map, no watermarks — but payload files and simulated counts", async () => {
    const summary = await init({ dryRun: true });
    expect(summary.exitCode).toBe(0);
    expect(h.vault.records("account__v")).toHaveLength(0);
    expect(
      h.vault.calls.filter((c) =>
        ["upsert", "update", "deleteRecords"].includes(c.method),
      ),
    ).toHaveLength(0);
    expect(await h.store.watermarks.list()).toEqual([]);
    // §8.9: the only id-map rows are flagged dry_run (purged by the next real run)
    expect(await h.store.idMap.get("account", ACC[0])).toMatchObject({
      dryRun: true,
    });
    expect(
      existsSync(
        path.join(
          runDir,
          summary.runId,
          "US",
          "account",
          "payload",
          "batch-00000.json",
        ),
      ),
    ).toBe(true);
    const run = (await h.store.runs.get(summary.runId))!;
    expect(run.dryRun).toBe(true);
    const report = JSON.parse(
      readFileSync(path.join(runDir, summary.runId, "report.json"), "utf8"),
    ) as {
      dryRun: boolean;
      reconciliation: Array<{ objectKey: string; created: number }>;
    };
    expect(report.dryRun).toBe(true);
    // children simulated against parents simulated in the same run: would_create, nothing pending or re-fetched
    const recon = await h.store.reconciliation.list(summary.runId);
    for (const key of ["account", "address", "call2"]) {
      const r = recon.find((x) => x.objectKey === key)!;
      expect(r).toMatchObject({
        created: 2,
        pendingFk: 0,
        failed: 0,
        closure: 0,
        status: "pass",
      });
    }
    expect(
      (await h.store.findings.list(summary.runId)).map((f) => f.code),
    ).not.toContain("UNRESOLVED_FK");
    // the next real run purges the dry-run rows and loads for real
    const real = await init();
    expect(real.exitCode).toBe(0);
    expect(await h.store.idMap.get("account", ACC[0])).toMatchObject({
      matchMethod: "created",
    });
    expect((await h.store.idMap.get("account", ACC[0]))!.dryRun).toBeFalsy();
    expect(h.vault.records("address__v")).toHaveLength(2);
  });

  it("extract count mismatch: re-extracts with PK chunking, a second mismatch fails the unit and keeps the watermark (§2.8)", async () => {
    const orig = h.sfdc.count.bind(h.sfdc);
    h.sfdc.count = async (object, where) =>
      (await orig(object, where)) + (object === "Account" ? 1 : 0);
    const summary = await init();
    expect(summary.exitCode).toBe(EXIT_CODES.unitFailures);
    expect(
      summary.units.find((u) => u.unit.objectKey === "account"),
    ).toMatchObject({ status: "failed" });
    expect(
      h.sfdc.calls.filter(
        (c) => c.method === "count" && c.args[0] === "Account",
      ).length,
    ).toBeGreaterThanOrEqual(2);
    const findings = await h.store.findings.list(summary.runId);
    expect(
      findings.some(
        (f) => f.code === "EXTRACT_COUNT_MISMATCH" && f.severity === "blocking",
      ),
    ).toBe(true);
    expect(
      summary.units.find((u) => u.unit.objectKey === "account")?.reason,
    ).toMatch(/EXTRACT_COUNT_MISMATCH/);
    expect(
      await h.store.watermarks.get("account", "US", "modstamp"),
    ).toBeUndefined();
    // the other units are unaffected
    expect(
      (await h.store.watermarks.get("address", "US", "modstamp"))?.value,
    ).toBe("2026-09-07T11:55:00.000Z");
  });

  it("closure never writes into a parent unit that preflight blocked", async () => {
    h.preflight.blockedUnits.push({ objectKey: "account", country: "US" });
    const summary = await init();
    expect(h.vault.records("account__v")).toHaveLength(0);
    const findings = await h.store.findings.list(summary.runId);
    const unavailable = findings.filter(
      (f) => f.code === "CLOSURE_PARENT_UNAVAILABLE",
    );
    expect(unavailable.length).toBeGreaterThan(0);
    expect(unavailable[0].objectKey).toBe("account");
    // children could not resolve their parents → pending, then UNRESOLVED_FK
    const addr = (await h.store.reconciliation.list(summary.runId)).find(
      (r) => r.objectKey === "address",
    )!;
    expect(addr.failedByType).toMatchObject({ UNRESOLVED_FK: 2 });
  });

  it("pass 2 also patches parents loaded by closure after their step (§6.1)", async () => {
    // a US address references the DE account (outside the wave); that account's own
    // self reference points at a US account loaded in step 1
    h.sfdc.upsertRow("Account", {
      ...h.sfdc.getRows("Account")[2],
      Primary_Parent_vod__c: ACC[0],
    });
    const addr3 = "a0A000000000003";
    h.sfdc.addRows("Address_vod__c", [
      {
        Id: addr3,
        IsDeleted: false,
        SystemModstamp: T0,
        CreatedDate: T0,
        CreatedById: "005000000000001AAA",
        LastModifiedDate: T0,
        LastModifiedById: "005000000000001AAA",
        Name: "3 Cross St",
        Account_vod__c: ACC[2],
        City_vod__c: "Boston",
        "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c": "US",
      },
    ]);
    const summary = await init();
    expect(summary.exitCode).toBe(0);
    const acc0 = (await h.store.idMap.get("account", ACC[0]))!;
    const acc2 = (await h.store.idMap.get("account", ACC[2]))!;
    expect(h.vault.record("account__v", acc2.vaultId)?.primary_parent__v).toBe(
      acc0.vaultId,
    );
    const recon = (await h.store.reconciliation.list(summary.runId)).find(
      (r) => r.objectKey === "account",
    )!;
    expect(recon).toMatchObject({ extracted: 2, closure: 1, created: 3 });
  });

  it("delta: an SFDC account merge maps the loser to the survivor and re-points its children (§3.4 a, §4.2)", async () => {
    await init();
    const acc0 = (await h.store.idMap.get("account", ACC[0]))!;
    const acc1 = (await h.store.idMap.get("account", ACC[1]))!;
    const addr1 = (await h.store.idMap.get("address", ADDR[1]))!;
    expect(h.vault.record("address__v", addr1.vaultId)?.account__v).toBe(
      acc1.vaultId,
    );
    h.clock.now = "2026-09-08T12:00:00.000Z";
    (h.sfdc as unknown as { opts: { now: string } }).opts.now =
      "2026-09-08T12:00:00.000Z";
    // ACC[1] merged into ACC[0]: deleted loser row carries MasterRecordId
    h.sfdc.upsertRow("Account", {
      ...h.sfdc.getRows("Account")[1],
      IsDeleted: true,
      MasterRecordId: ACC[0],
      SystemModstamp: "2026-09-08T09:00:00.000Z",
    });
    h.sfdc.addDeleted("Account", ACC[1], "2026-09-08T09:00:00.000Z");
    const delta = await h.engine.execute({
      mode: "delta",
      config: h.config,
      wave: "w1",
    });
    expect(delta.exitCode).toBe(0);
    const loser = (await h.store.idMap.get("account", ACC[1]))!;
    expect(loser.mergedInto).toBe(ACC[0]);
    expect(loser.deletedAt).toBeTruthy(); // inactivate policy applied first
    expect(h.vault.record("address__v", addr1.vaultId)?.account__v).toBe(
      acc0.vaultId,
    );
    const call1 = (await h.store.idMap.get("call2", CALL[1]))!;
    expect(h.vault.record("call2__v", call1.vaultId)?.account__v).toBe(
      acc0.vaultId,
    );
    expect(
      (await h.store.idMap.get("address", ADDR[1]))?.sourceHash,
    ).toBeFalsy();
    const findings = await h.store.findings.list(delta.runId);
    expect(
      findings.find((f) => f.code === "ACCOUNT_MERGED")?.detail,
    ).toMatchObject({ merged: 1, childrenRepointed: 2 });
  });

  it("a widened cutoff (SCOPE_CUTOFF_CHANGED) re-extracts in full but still consumes the delete feed", async () => {
    await init();
    h.clock.now = "2026-09-08T12:00:00.000Z";
    (h.sfdc as unknown as { opts: { now: string } }).opts.now =
      "2026-09-08T12:00:00.000Z";
    h.sfdc.deleteRow("Address_vod__c", ADDR[1], "2026-09-08T09:30:00.000Z");
    const h2 = makeHarness(
      runDir,
      {
        store: h.store,
        sfdc: h.sfdc,
        vaults: h.deps.vaults,
        preflight: h.preflight,
      },
      { scope: { cutoffDate: "2020-01-01" } },
    );
    h2.clock.now = "2026-09-08T12:00:00.000Z";
    const delta = await h2.engine.execute({
      mode: "delta",
      config: h2.config,
      wave: "w1",
    });
    expect(delta.exitCode).toBe(0);
    const findings = await h.store.findings.list(delta.runId);
    expect(findings.map((f) => f.code)).toContain("SCOPE_CUTOFF_CHANGED");
    expect(
      h.sfdc.calls.some(
        (c) => c.method === "getDeleted" && c.args[0] === "Address_vod__c",
      ),
    ).toBe(true);
    const addr = (await h.store.reconciliation.list(delta.runId)).find(
      (r) => r.objectKey === "address",
    )!;
    expect(addr).toMatchObject({ deleted: 1, deletedApplied: 1 });
    expect(
      (await h.store.idMap.get("address", ADDR[1]))?.deletedAt,
    ).toBeTruthy();
    expect(
      (await h.store.watermarks.get("address", "US", "modstamp"))?.cutoffDate,
    ).toBe("2020-01-01");
  });

  it("delta: loads only the window, applies delete policies, advances watermarks only on success", async () => {
    const first = await init();
    const wmBefore = (await h.store.watermarks.get(
      "account",
      "US",
      "modstamp",
    ))!;
    // a later change + a deleted address + a deleted call (ignore policy)
    h.clock.now = "2026-09-08T12:00:00.000Z";
    h.sfdc.upsertRow("Account", {
      ...h.sfdc.getRows("Account")[0],
      Name: "Acme Hospital Renamed",
      SystemModstamp: "2026-09-08T09:00:00.000Z",
      LastModifiedDate: "2026-09-08T09:00:00.000Z",
    });
    h.sfdc.deleteRow("Address_vod__c", ADDR[1], "2026-09-08T09:30:00.000Z");
    h.sfdc.deleteRow("Call2_vod__c", CALL[1], "2026-09-08T09:30:00.000Z");
    (h.sfdc as unknown as { opts: { now: string } }).opts.now =
      "2026-09-08T12:00:00.000Z";
    const delta = await h.engine.execute({
      mode: "delta",
      config: h.config,
      wave: "w1",
    });
    expect(delta.exitCode).toBe(0);
    const acc0 = (await h.store.idMap.get("account", ACC[0]))!;
    expect(h.vault.record("account__v", acc0.vaultId)?.name__v).toBe(
      "Acme Hospital Renamed",
    );
    const recon = await h.store.reconciliation.list(delta.runId);
    const accRecon = recon.find((r) => r.objectKey === "account")!;
    expect(accRecon).toMatchObject({
      extracted: 1,
      updated: 1,
      created: 0,
      status: "pass",
    });
    const addrRecon = recon.find((r) => r.objectKey === "address")!;
    expect(addrRecon).toMatchObject({
      deleted: 1,
      deletedApplied: 1,
      status: "pass",
    });
    expect(h.vault.records("address__v")).toHaveLength(1);
    expect(
      (await h.store.idMap.get("address", ADDR[1]))?.deletedAt,
    ).toBeTruthy();
    const callRecon = recon.find((r) => r.objectKey === "call2")!;
    expect(callRecon).toMatchObject({
      deleted: 1,
      deletedIgnored: 1,
      deletedApplied: 0,
    });
    expect(h.vault.records("call2__v")).toHaveLength(2);
    const wmAfter = (await h.store.watermarks.get(
      "account",
      "US",
      "modstamp",
    ))!;
    expect(wmAfter.value).toBe("2026-09-08T11:55:00.000Z");
    expect(wmAfter.value > wmBefore.value).toBe(true);
    expect(wmAfter.runId).toBe(delta.runId);
    expect(first.runId).not.toBe(delta.runId);

    // a failing delta does not move the watermark
    h.clock.now = "2026-09-09T12:00:00.000Z";
    (h.sfdc as unknown as { opts: { now: string } }).opts.now =
      "2026-09-09T12:00:00.000Z";
    h.sfdc.upsertRow("Account", {
      ...h.sfdc.getRows("Account")[0],
      Name: "Again",
      SystemModstamp: "2026-09-09T09:00:00.000Z",
    });
    h.vault.failNext = {
      method: "upsert",
      error: new VaultApiError(
        "INSUFFICIENT_ACCESS",
        "no permission",
        "FAILURE",
      ),
      remaining: 1,
    };
    const failed = await h.engine.execute({
      mode: "delta",
      config: h.config,
      wave: "w1",
    });
    expect(failed.exitCode).toBe(EXIT_CODES.unitFailures);
    expect(
      failed.units.find((u) => u.unit.objectKey === "account")?.status,
    ).toBe("failed");
    expect(
      (await h.store.watermarks.get("account", "US", "modstamp"))!.value,
    ).toBe("2026-09-08T11:55:00.000Z");
    // dependants still ran (their own watermarks moved), the failed unit is reported with a blocking finding
    const findings = await h.store.findings.list(failed.runId);
    expect(findings.map((f) => f.code)).toContain("LOAD_STRUCTURAL_FAILURE");
  });

  it("delta with an empty window skips everything and still passes", async () => {
    await init();
    (h.sfdc as unknown as { opts: { now: string } }).opts.now = NOW;
    const delta = await h.engine.execute({
      mode: "delta",
      config: h.config,
      wave: "w1",
    });
    expect(delta.exitCode).toBe(0);
    const recon = await h.store.reconciliation.list(delta.runId);
    expect(recon.every((r) => r.status === "pass" && r.extracted === 0)).toBe(
      true,
    );
  });

  it("stops with exit 2 on blocking preflight findings and writes nothing", async () => {
    h.preflight.findings.push({
      severity: "blocking",
      code: "VT_API_VERSION_MISSING",
      detail: "v26.2 not offered",
    });
    const summary = await init();
    expect(summary.exitCode).toBe(EXIT_CODES.blockingFindings);
    expect(h.vault.records("account__v")).toHaveLength(0);
    expect((await h.store.runs.get(summary.runId))?.status).toBe("blocked");
    expect(existsSync(summary.reportPath!)).toBe(true);
  });

  it("preflight mode is read-only and exits 0/2 by findings", async () => {
    const ok = await h.engine.execute({
      mode: "preflight",
      config: h.config,
      wave: "w1",
    });
    expect(ok.exitCode).toBe(0);
    expect(h.vault.records("account__v")).toHaveLength(0);
    h.preflight.findings.push({
      severity: "blocking",
      code: "LEGACY_ID_FIELD_MISSING",
      objectKey: "call2",
      detail: "x",
    });
    const bad = await h.engine.execute({
      mode: "preflight",
      config: h.config,
      wave: "w1",
    });
    expect(bad.exitCode).toBe(EXIT_CODES.blockingFindings);
  });

  it("blocked units are skipped while the rest of the wave runs", async () => {
    h.preflight.blockedUnits.push({ objectKey: "call2", country: "US" });
    const summary = await init();
    expect(summary.exitCode).toBe(0);
    expect(
      summary.units.find((u) => u.unit.objectKey === "call2")?.status,
    ).toBe("blocked");
    expect(h.vault.records("call2__v")).toHaveLength(0);
    expect(h.vault.records("address__v")).toHaveLength(2);
    expect(
      await h.store.watermarks.get("call2", "US", "modstamp"),
    ).toBeUndefined();
  });

  it("closure fetches out-of-scope parents referenced by in-scope children", async () => {
    // old call outside the 24-month scope referenced as parent by an in-scope call
    const oldCall = "a0K000000000009";
    h.sfdc.addRows("Call2_vod__c", [
      {
        Id: oldCall,
        IsDeleted: false,
        SystemModstamp: "2020-01-01T00:00:00.000Z",
        CreatedDate: "2020-01-01T00:00:00.000Z",
        CreatedById: "005000000000001AAA",
        LastModifiedDate: T0,
        LastModifiedById: "005000000000001AAA",
        Name: "C-old",
        Account_vod__c: ACC[0],
        Call_Date_vod__c: "2020-01-01",
        "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c": "US",
      },
    ]);
    h.sfdc.upsertRow("Call2_vod__c", {
      ...h.sfdc.getRows("Call2_vod__c")[0],
      Parent_Call_vod__c: oldCall,
    });
    const summary = await init();
    expect(summary.exitCode).toBe(0);
    expect(
      h.vault
        .records("call2__v")
        .map((c) => c.name__v)
        .sort(),
    ).toEqual(["C-1", "C-2", "C-old"]);
    const recon = (await h.store.reconciliation.list(summary.runId)).find(
      (r) => r.objectKey === "call2",
    )!;
    expect(recon).toMatchObject({
      extracted: 2,
      closure: 1,
      created: 3,
      status: "pass",
    });
  });

  it("final-delta applies the gate with tolerance 0, freezes the country and later deltas skip it", async () => {
    await init();
    (h.sfdc as unknown as { opts: { now: string } }).opts.now =
      "2026-09-08T12:00:00.000Z";
    h.clock.now = "2026-09-08T12:00:00.000Z";
    const fd = await h.engine.execute({
      mode: "final-delta",
      config: h.config,
      wave: "w1",
      freezeAt: "2026-09-08T10:00:00.000Z",
    });
    expect(fd.exitCode).toBe(0);
    expect((await h.store.runs.get(fd.runId))?.freezeAt).toBe(
      "2026-09-08T10:00:00.000Z",
    );
    expect(
      (await h.store.watermarks.get("account", "US", "modstamp"))?.value,
    ).toBe("2026-09-08T10:00:00.000Z");
    expect(await h.store.countryStatus.isFrozen("US")).toBe(true);
    const next = await h.engine.execute({
      mode: "delta",
      config: h.config,
      wave: "w1",
    });
    expect(next.units.every((u) => u.status === "skipped")).toBe(true);
    const again = await h.engine.execute({
      mode: "delta",
      config: h.config,
      wave: "w1",
      unfreeze: true,
    });
    expect(again.units.every((u) => u.status === "succeeded")).toBe(true);
  });

  it("final-delta fails the gate (exit 4) when rows fail, unless an exceptions file accepts them", async () => {
    await init();
    (h.sfdc as unknown as { opts: { now: string } }).opts.now =
      "2026-09-08T12:00:00.000Z";
    h.clock.now = "2026-09-08T12:00:00.000Z";
    h.sfdc.upsertRow("Account", {
      ...h.sfdc.getRows("Account")[0],
      Name: "Renamed",
      SystemModstamp: "2026-09-08T09:00:00.000Z",
    });
    h.vault.rowFailures.push({
      object: "account__v",
      field: "legacy_crm_id__v",
      value: ACC[0],
      type: "INVALID_DATA",
      message: "bad",
    });
    const fd = await h.engine.execute({
      mode: "final-delta",
      config: h.config,
      wave: "w1",
      freezeAt: "2026-09-08T10:00:00.000Z",
    });
    expect(fd.exitCode).toBe(EXIT_CODES.gateFailed);
    expect(await h.store.countryStatus.isFrozen("US")).toBe(false);
    const findings = await h.store.findings.list(fd.runId);
    expect(findings.map((f) => f.code)).toContain("RECON_FAILED_ROWS");
    // accepted exception → pass
    const file = path.join(runDir, "exceptions.json");
    await import("node:fs").then((fs) =>
      fs.writeFileSync(
        file,
        JSON.stringify({
          units: { "account:US": { reason: "row in triage", allowFailed: 1 } },
        }),
      ),
    );
    const fd2 = await h.engine.execute({
      mode: "final-delta",
      config: h.config,
      wave: "w1",
      freezeAt: "2026-09-08T10:00:00.000Z",
      acceptGateExceptions: file,
      justification: "hypercare",
    });
    expect(fd2.exitCode).toBe(0);
    expect(
      (await h.store.auditLog.list({ runId: fd2.runId })).map((a) => a.event),
    ).toContain("override.accept-gate-exceptions");
  });

  it("retry-failed re-transforms failed rows of an earlier run from the stored extract", async () => {
    h.vault.rowFailures.push({
      object: "address__v",
      field: "legacy_crm_id__v",
      value: ADDR[0],
      type: "INVALID_DATA",
      message: "bad",
    });
    const first = await init();
    expect(
      (await h.store.rowResults.get(first.runId, "address", ADDR[0]))?.state,
    ).toBe("failed");
    expect(h.vault.records("address__v")).toHaveLength(1);
    h.vault.rowFailures.length = 0;
    const retry = await h.engine.execute({
      mode: "retry-failed",
      config: h.config,
      wave: "w1",
      runId: first.runId,
    });
    expect(retry.exitCode).toBe(0);
    expect(h.vault.records("address__v")).toHaveLength(2);
    expect(
      (await h.store.rowResults.get(retry.runId, "address", ADDR[0]))?.state,
    ).toBe("loaded_created");
    // only the failed row was re-sent
    const sent = h.vault.calls
      .filter((c) => c.method === "upsert" && c.args[0] === "address__v")
      .at(-1)!.args[1] as unknown[];
    expect(sent).toHaveLength(1);
  });

  it("verify is read-only and reports orphan required FKs", async () => {
    await init();
    const before = h.vault.calls.length;
    const ok = await h.engine.execute({
      mode: "verify",
      config: h.config,
      wave: "w1",
    });
    expect(ok.exitCode).toBe(0);
    expect(
      h.vault.calls
        .slice(before)
        .every(
          (c) => !["upsert", "update", "deleteRecords"].includes(c.method),
        ),
    ).toBe(true);
    // break a required reference in Vault → orphan
    const addr = h.vault.records("address__v")[0];
    addr.account__v = null;
    const bad = await h.engine.execute({
      mode: "verify",
      config: h.config,
      wave: "w1",
    });
    expect(bad.exitCode).toBe(EXIT_CODES.gateFailed);
    expect(
      (await h.store.findings.list(bad.runId)).map((f) => f.code),
    ).toContain("RECON_ORPHAN_FK");
  });

  it("report mode re-renders a stored run", async () => {
    const first = await init();
    const lines: string[] = [];
    const h2 = makeHarness(runDir, {
      store: h.store,
      out: (t) => lines.push(t),
    });
    const rep = await h2.engine.execute({
      mode: "report",
      config: h.config,
      runId: first.runId,
    });
    expect(rep.exitCode).toBe(0);
    expect(lines.join("\n")).toContain(`# Migration run ${first.runId}`);
    const missing = await h2.engine.execute({
      mode: "report",
      config: h.config,
      runId: "nope",
    });
    expect(missing.exitCode).toBe(EXIT_CODES.configError);
  });
});
