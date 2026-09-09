import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
  appendFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { to18 } from "../transform/ids";
import type { IdMapRow } from "../types";
import { FileStateStore } from "./file";

const DNS = "test.veevavault.com";
const dirs: string[] = [];
const tmp = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "veeva-file-store-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const idRow = (sfdcId: string, extra: Partial<IdMapRow> = {}): IdMapRow => ({
  objectKey: "account",
  sfdcId,
  vaultDns: DNS,
  vaultObject: "account__v",
  vaultId: `V${to18(sfdcId).slice(-4)}`,
  country: "US",
  matchMethod: "created",
  firstSeenRun: "r1",
  lastSeenRun: "r1",
  ...extra,
});
const a1 = to18("001000000000001");
const a2 = to18("001000000000002");

describe("FileStateStore persistence", () => {
  it("creates the directory + meta.json and survives reopen for every table", async () => {
    const dir = path.join(await tmp(), "nested", "state");
    const s = await FileStateStore.open({ dir, vaultDns: DNS });
    await s.runs.create({
      runId: "r1",
      mode: "init",
      countries: ["US"],
      startedAt: "2026-01-01T00:00:00Z",
      status: "running",
      toolVersion: "0",
      configHash: "c",
    });
    await s.runs.create({
      runId: "r2",
      mode: "delta",
      countries: ["US"],
      startedAt: "2026-01-02T00:00:00Z",
      status: "running",
      toolVersion: "0",
      configHash: "c",
    });
    await s.runs.update("r1", { status: "succeeded" });
    await s.watermarks.set({
      objectKey: "account",
      country: "US",
      kind: "modstamp",
      value: "v",
      runId: "r1",
      updatedAt: "t",
    });
    await s.idMap.putMany([idRow(a1), idRow(a2, { dryRun: true })]);
    await s.idMap.markDeleted("account", a1, "d");
    await s.rowResults.upsert([
      {
        runId: "r1",
        objectKey: "account",
        country: "US",
        sfdcId: a1,
        state: "failed",
        errorType: "X",
        attempt: 1,
        updatedAt: "t",
      },
    ]);
    await s.pendingFk.add([
      {
        runId: "r1",
        objectKey: "call2",
        country: "US",
        sfdcId: to18("a0K000000000001"),
        field: "account__v",
        targetObjectKey: "account",
        targetSfdcId: a2,
        attempts: 0,
      },
    ]);
    await s.fkIndex.put([
      {
        objectKey: "call2",
        sfdcId: to18("a0K000000000001"),
        field: "account__v",
        targetObjectKey: "account",
        targetSfdcId: a2,
        runId: "r1",
      },
    ]);
    await s.checkpoints.add({
      runId: "r1",
      objectKey: "account",
      country: "US",
      jobId: "j",
      pageNo: 0,
      rows: 1,
      file: "f",
    });
    await s.findings.add("r1", [
      { severity: "warning", code: "X", detail: "d" },
    ]);
    await s.findings.add("r2", [
      { severity: "info", code: "Y", detail: { a: 1 } },
    ]);
    await s.reconciliation.upsert({
      runId: "r1",
      objectKey: "account",
      country: "US",
      extracted: 1,
      transformed: 1,
      skipped: 0,
      pendingFk: 0,
      created: 1,
      updated: 0,
      unchanged: 0,
      failed: 0,
      deleted: 0,
      status: "pass",
    });
    await s.mappingSnapshots.put({
      mappingHash: "h",
      objectKey: "account",
      country: "US",
      materialised: { x: 1 } as never,
      createdAt: "t",
    });
    await s.auditLog.append({
      runId: "r1",
      at: "t",
      actor: "cli",
      event: "run.start",
    });
    await s.auditLog.append({
      runId: "r1",
      at: "t",
      actor: "cli",
      event: "run.end",
    });
    await s.probeResults.set({
      vaultDns: "x",
      probe: "p",
      result: { ok: true },
      checkedAt: "t",
    });
    await s.countryStatus.setFrozen("NL", "t");
    await s.countryStatus.setFrozen("DE", "t");
    await s.countryStatus.setFrozen("DE", null);
    // no close/compact: the journals alone must be enough
    const meta = JSON.parse(
      await readFile(path.join(dir, "meta.json"), "utf8"),
    );
    expect(meta).toEqual({ format: 1, vaultDns: DNS });

    const r = await FileStateStore.open({ dir, vaultDns: DNS });
    expect((await r.runs.get("r1"))?.status).toBe("succeeded");
    expect((await r.runs.list()).map((x) => x.runId)).toEqual(["r2", "r1"]);
    expect((await r.watermarks.get("account", "US", "modstamp"))?.value).toBe(
      "v",
    );
    expect((await r.idMap.get("account", a1))?.deletedAt).toBe("d");
    expect(await r.idMap.count("account")).toBe(1);
    expect((await r.rowResults.get("r1", "account", a1))?.errorType).toBe("X");
    expect(await r.pendingFk.countUnresolved("r1", "call2", "US")).toBe(1);
    expect(await r.fkIndex.childrenOf("account", a2)).toHaveLength(1);
    expect(await r.checkpoints.list("r1", "account", "US")).toHaveLength(1);
    expect((await r.findings.previous("r2")).map((f) => f.code)).toEqual(["X"]);
    expect((await r.findings.list("r2"))[0].detail).toEqual({ a: 1 });
    expect((await r.reconciliation.get("r1", "account", "US"))?.created).toBe(
      1,
    );
    expect(
      (await r.mappingSnapshots.latestFor("account", "US"))?.materialised,
    ).toEqual({ x: 1 });
    expect((await r.auditLog.list()).map((e) => e.id)).toEqual([1, 2]);
    await r.auditLog.append({ at: "t", actor: "cli", event: "later" });
    expect((await r.auditLog.list({ limit: 1 }))[0].id).toBe(3);
    await r.findings.add("r2", [{ severity: "info", code: "Z", detail: "d" }]);
    expect((await r.findings.list("r2")).map((f) => f.code)).toEqual([
      "Y",
      "Z",
    ]);
    expect((await r.probeResults.get("p"))?.vaultDns).toBe(DNS);
    expect(await r.countryStatus.list()).toEqual([
      { country: "NL", frozenAt: "t" },
    ]);
    expect(await r.idMap.purgeDryRun()).toBe(1);
    await r.close();
    const again = await FileStateStore.open({ dir, vaultDns: DNS });
    expect(await again.idMap.get("account", a2)).toBeUndefined();
    expect(await again.idMap.count("account")).toBe(0);
    await again.close();
  });

  it("compacts into a snapshot, truncates the journal and leaves no temp files", async () => {
    const dir = await tmp();
    const s = await FileStateStore.open({
      dir,
      vaultDns: DNS,
      compactEvery: 3,
    });
    await s.idMap.put(idRow(a1));
    await s.idMap.put(idRow(a2));
    expect(
      (await readFile(path.join(dir, "id_map.log.ndjson"), "utf8"))
        .split("\n")
        .filter(Boolean),
    ).toHaveLength(2);
    await s.idMap.markDeleted("account", a1, "d"); // third entry → auto compaction
    expect(await readFile(path.join(dir, "id_map.log.ndjson"), "utf8")).toBe(
      "",
    );
    const snap = JSON.parse(
      await readFile(path.join(dir, "id_map.snapshot.json"), "utf8"),
    ) as Array<[string, IdMapRow]>;
    expect(snap.map(([k]) => k)).toEqual([`account|${a1}`, `account|${a2}`]);
    expect(snap[0][1].deletedAt).toBe("d");
    await s.idMap.setSourceHash("account", a2, "h", "r2");
    await s.close(); // close compacts everything
    for (const f of await readdir(dir)) expect(f).not.toMatch(/\.tmp-/);
    expect(await readFile(path.join(dir, "id_map.log.ndjson"), "utf8")).toBe(
      "",
    );
    const r = await FileStateStore.open({ dir, vaultDns: DNS });
    expect(await r.idMap.get("account", a2)).toMatchObject({
      sourceHash: "h",
      lastSeenRun: "r2",
    });
    expect((await r.idMap.get("account", a1))?.deletedAt).toBe("d");
    await r.close();
  });

  it("replays journal entries over the snapshot idempotently (crash between snapshot and journal reset)", async () => {
    const dir = await tmp();
    const s = await FileStateStore.open({ dir, vaultDns: DNS });
    await s.idMap.put(idRow(a1));
    await s.idMap.put(idRow(a2));
    await s.idMap.markDeleted("account", a2, "d");
    await s.compact();
    // simulate: snapshot written but the old journal survived
    const log = path.join(dir, "id_map.log.ndjson");
    await writeFile(
      log,
      [
        JSON.stringify({ k: `account|${a1}`, v: idRow(a1) }),
        JSON.stringify({ k: `account|${a2}`, v: idRow(a2) }),
        JSON.stringify({
          k: `account|${a2}`,
          v: { ...idRow(a2), deletedAt: "d" },
        }),
        "",
      ].join("\n"),
    );
    const r = await FileStateStore.open({ dir, vaultDns: DNS });
    expect(await r.idMap.count("account")).toBe(1);
    expect((await r.idMap.get("account", a2))?.deletedAt).toBe("d");
    await r.close();
  });

  it("ignores a torn trailing journal line but rejects corruption in the middle", async () => {
    const dir = await tmp();
    const s = await FileStateStore.open({ dir, vaultDns: DNS });
    await s.idMap.put(idRow(a1));
    const log = path.join(dir, "id_map.log.ndjson");
    await appendFile(log, '{"k":"account|x","v":{"objec');
    const r = await FileStateStore.open({ dir, vaultDns: DNS });
    expect(await r.idMap.count("account")).toBe(1);
    // the torn line is discarded; a later write appends after it, so the store must re-read cleanly
    await r.idMap.put(idRow(a2));
    await r.close();
    const r2 = await FileStateStore.open({ dir, vaultDns: DNS });
    expect(await r2.idMap.count("account")).toBe(2);
    await r2.close();

    const bad = await tmp();
    await writeFile(
      path.join(bad, "meta.json"),
      JSON.stringify({ format: 1, vaultDns: DNS }),
    );
    await writeFile(
      path.join(bad, "runs.log.ndjson"),
      'not json\n{"k":"r1","v":{"runId":"r1"}}\n',
    );
    await expect(
      FileStateStore.open({ dir: bad, vaultDns: DNS }),
    ).rejects.toThrow(/corrupt journal/);
  });

  it("refuses a directory bound to another vault or an unknown format", async () => {
    const dir = await tmp();
    const s = await FileStateStore.open({ dir, vaultDns: DNS });
    await s.close();
    await expect(
      FileStateStore.open({ dir, vaultDns: "prod.veevavault.com" }),
    ).rejects.toThrow(/belongs to vault test\.veevavault\.com/);
    const other = await tmp();
    await writeFile(
      path.join(other, "meta.json"),
      JSON.stringify({ format: 99, vaultDns: DNS }),
    );
    await expect(
      FileStateStore.open({ dir: other, vaultDns: DNS }),
    ).rejects.toThrow(/unsupported format/);
  });

  it("lazily opens on first use and serialises concurrent writes", async () => {
    const dir = await tmp();
    const s = new FileStateStore({ dir, vaultDns: DNS });
    const rows = Array.from({ length: 50 }, (_, i) =>
      idRow(to18(`001${String(i + 1).padStart(12, "0")}`), {
        vaultId: `V${i}`,
      }),
    );
    await Promise.all(rows.map((r) => s.idMap.put(r)));
    await Promise.all([
      s.auditLog.append({ at: "t", actor: "a", event: "e1" }),
      s.auditLog.append({ at: "t", actor: "a", event: "e2" }),
      s.countryStatus.setFrozen("NL", "t"),
    ]);
    expect(await s.idMap.count("account")).toBe(50);
    const lines = (await readFile(path.join(dir, "id_map.log.ndjson"), "utf8"))
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(50);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect((await s.auditLog.list()).map((e) => e.id)).toEqual([1, 2]);
    await s.close();
    const r = await FileStateStore.open({ dir, vaultDns: DNS });
    expect(await r.idMap.count("account")).toBe(50);
    expect(await r.countryStatus.isFrozen("NL")).toBe(true);
    await r.close();
  });

  it("a rejected write (unique vault id) leaves memory and journal untouched", async () => {
    const dir = await tmp();
    const s = await FileStateStore.open({ dir, vaultDns: DNS });
    await s.idMap.put(idRow(a1, { vaultId: "VX" }));
    await expect(
      s.idMap.putMany([
        idRow(a2, { vaultId: "VY" }),
        idRow(to18("001000000000003"), { vaultId: "VX" }),
      ]),
    ).rejects.toThrow(/id_map_vault_uidx/);
    expect(await s.idMap.get("account", a2)).toBeUndefined();
    expect(
      (await readFile(path.join(dir, "id_map.log.ndjson"), "utf8"))
        .split("\n")
        .filter(Boolean),
    ).toHaveLength(1);
    await s.close();
  });
});
