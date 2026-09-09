/**
 * Unit tests for `PostgresStateStore` against a recording fake executor —
 * verifies the SQL each repo method issues and the id normalisation /
 * per-vault scoping applied before the statement is built. Behaviour against
 * a real database is covered by `postgres.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { to18 } from "../transform/ids";
import type { IdMapRow } from "../types";
import {
  driverParams,
  PostgresStateStore,
  translateError,
  type SqlExecutor,
} from "./postgres";
import { TABLES } from "./sql";

interface Call {
  text: string;
  params: unknown[];
}

class FakeExecutor implements SqlExecutor {
  calls: Call[] = [];
  responses: Array<Record<string, unknown>[]> = [];
  transactions = 0;
  ended = false;
  failWith: unknown;
  async query(text: string, params: unknown[] = []) {
    this.calls.push({ text, params });
    if (this.failWith) {
      const e = this.failWith;
      this.failWith = undefined;
      throw e;
    }
    return this.responses.shift() ?? [];
  }
  async *cursor(text: string, params: unknown[], batchSize: number) {
    this.calls.push({ text: `cursor(${batchSize}) ${text}`, params });
    for (const r of this.responses.shift() ?? []) yield [r];
  }
  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    this.transactions++;
    return fn(this);
  }
  async end() {
    this.ended = true;
  }
}

const DNS = "test.veevavault.com";
const make = (opts: { schema?: string; batchSize?: number } = {}) => {
  const db = new FakeExecutor();
  const store = new PostgresStateStore({
    vaultDns: DNS,
    executor: db,
    ...opts,
  });
  return { db, store };
};
const a1 = to18("001000000000001");
const row = (sfdcId: string, extra: Partial<IdMapRow> = {}): IdMapRow => ({
  objectKey: "account",
  sfdcId,
  vaultDns: "whatever",
  vaultObject: "account__v",
  vaultId: "V1",
  country: "US",
  matchMethod: "created",
  firstSeenRun: "r1",
  lastSeenRun: "r1",
  ...extra,
});

describe("driverParams", () => {
  it("stringifies booleans inside arrays only", () => {
    expect(driverParams([true, [true, null, false], ["a"], [1, 2], 3])).toEqual(
      [true, ["true", null, "false"], ["a"], [1, 2], 3],
    );
  });
});

describe("PostgresStateStore (fake executor)", () => {
  it("requires a connection or executor and validates the schema name", () => {
    expect(() => new PostgresStateStore({ vaultDns: DNS })).toThrow(
      /databaseUrl or executor/,
    );
    expect(
      () =>
        new PostgresStateStore({
          vaultDns: DNS,
          executor: new FakeExecutor(),
          schema: "x;y",
        }),
    ).toThrow(/identifier/);
  });

  it("migrate runs the DDL under an advisory lock inside one transaction and records the version", async () => {
    const { db, store } = make({ schema: "mig_t" });
    await store.migrate();
    expect(db.transactions).toBe(1);
    expect(db.calls[0].text).toContain("pg_advisory_xact_lock");
    expect(
      db.calls.some((c) =>
        c.text.startsWith('create schema if not exists "mig_t"'),
      ),
    ).toBe(true);
    expect(db.calls.some((c) => c.text.includes('"mig_t"."id_map"'))).toBe(
      true,
    );
    expect(db.calls.some((c) => c.text.includes("id_map_vault_uidx"))).toBe(
      true,
    );
    expect(db.calls.at(-1)?.text).toContain('"mig_t"."schema_migrations"');
    await store.close();
    expect(db.ended).toBe(true);
  });

  it("idMap.get normalises the id and scopes by vault_dns", async () => {
    const { db, store } = make();
    db.responses.push([
      {
        object_key: "account",
        sfdc_id: a1,
        vault_dns: DNS,
        vault_object: "account__v",
        vault_id: "V1",
        country: "US",
        match_method: "created",
        merged_into: null,
        first_seen_run: "r1",
        last_seen_run: "r1",
        dry_run: false,
      },
    ]);
    const got = await store.idMap.get("account", "001000000000001");
    expect(got).toEqual({
      objectKey: "account",
      sfdcId: a1,
      vaultDns: DNS,
      vaultObject: "account__v",
      vaultId: "V1",
      country: "US",
      matchMethod: "created",
      firstSeenRun: "r1",
      lastSeenRun: "r1",
      dryRun: false,
    });
    expect(db.calls[0].text).toContain(
      '"vault_dns" = $1 and "object_key" = $2 and "sfdc_id" = $3',
    );
    expect(db.calls[0].params).toEqual([DNS, "account", a1]);
  });

  it("putMany stamps the vault, normalises ids, dedupes, chunks by batchSize and keeps first_seen_run", async () => {
    const { db, store } = make({ batchSize: 2 });
    await store.idMap.putMany([
      row("001000000000001", { firstSeenRun: "r1" }),
      row(a1, {
        firstSeenRun: "r9",
        lastSeenRun: "r9",
        mergedInto: "001000000000002",
      }),
      row(to18("001000000000003")),
      row(to18("001000000000004")),
    ]);
    expect(db.calls).toHaveLength(2);
    const cols = TABLES.id_map.columns.map((c) => c.name);
    const p = (call: Call, col: string) =>
      call.params[cols.indexOf(col)] as unknown[];
    expect(p(db.calls[0], "sfdc_id")).toEqual([a1, to18("001000000000003")]);
    expect(p(db.calls[0], "vault_dns")).toEqual([DNS, DNS]);
    expect(p(db.calls[0], "first_seen_run")).toEqual(["r1", "r1"]);
    expect(p(db.calls[0], "last_seen_run")).toEqual(["r9", "r1"]);
    expect(p(db.calls[0], "merged_into")).toEqual([
      to18("001000000000002"),
      null,
    ]);
    expect(p(db.calls[0], "dry_run")).toEqual(["false", "false"]);
    expect(db.calls[0].text).toContain(
      'on conflict ("vault_dns", "object_key", "sfdc_id") do update set',
    );
    expect(db.calls[0].text).not.toContain('"first_seen_run" = excluded');
    expect(p(db.calls[1], "sfdc_id")).toEqual([to18("001000000000004")]);
    await store.idMap.putMany([]);
    expect(db.calls).toHaveLength(2);
  });

  it("translates a unique-index violation into an id_map_vault_uidx error", async () => {
    const { db, store } = make();
    db.failWith = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "id_map_vault_uidx"',
      ),
      {
        code: "23505",
        constraint_name: "id_map_vault_uidx",
      },
    );
    await expect(store.idMap.put(row(a1))).rejects.toThrow(
      /^id_map_vault_uidx violation/,
    );
    expect(translateError("boom").message).toBe("boom");
    const plain = new Error("x");
    expect(translateError(plain)).toBe(plain);
  });

  it("bulkGet uses = any(char(18)[]) with deduplicated 18-char ids", async () => {
    const { db, store } = make();
    db.responses.push([
      {
        object_key: "account",
        sfdc_id: a1,
        vault_dns: DNS,
        vault_object: "account__v",
        vault_id: "V1",
        country: "US",
        match_method: "created",
        first_seen_run: "r1",
        last_seen_run: "r1",
      },
    ]);
    const got = await store.idMap.bulkGet("account", [
      "001000000000001",
      a1,
      to18("001000000000002"),
    ]);
    expect([...got.keys()]).toEqual([a1]);
    expect(db.calls[0].text).toContain('"sfdc_id" = any($3::char(18)[])');
    expect(db.calls[0].params[2]).toEqual([a1, to18("001000000000002")]);
    expect((await store.idMap.bulkGet("account", [])).size).toBe(0);
    expect(db.calls).toHaveLength(1);
  });

  it("count/byVaultId/iterate/purgeDryRun filter on live rows and the bound vault", async () => {
    const { db, store } = make({ batchSize: 7 });
    db.responses.push([{ n: 3 }]);
    expect(await store.idMap.count("account", "US")).toBe(3);
    expect(db.calls[0].text).toContain(
      '"country" = $3 and "deleted_at" is null and "merged_into" is null',
    );
    await store.idMap.byVaultId("account__v", "V1");
    expect(db.calls[1].text).toContain(
      '"merged_into" is null and "deleted_at" is null',
    );
    expect(db.calls[1].params).toEqual([DNS, "account__v", "V1", 1]);
    db.responses.push([
      {
        object_key: "account",
        sfdc_id: a1,
        vault_dns: DNS,
        vault_object: "account__v",
        vault_id: "V1",
        country: "US",
        match_method: "created",
        first_seen_run: "r1",
        last_seen_run: "r1",
      },
    ]);
    const seen: string[] = [];
    for await (const r of store.idMap.iterate("account")) seen.push(r.sfdcId);
    expect(seen).toEqual([a1]);
    expect(db.calls[2].text).toMatch(
      /^cursor\(7\) select \* from "veeva_migration"."id_map"/,
    );
    expect(db.calls[2].text).toContain('order by "sfdc_id"');
    expect(db.calls[2].params).toEqual([DNS, "account"]);
    db.responses.push([{ sfdc_id: a1 }, { sfdc_id: "x" }]);
    expect(await store.idMap.purgeDryRun()).toBe(2);
    expect(db.calls[3].text).toBe(
      'delete from "veeva_migration"."id_map"\nwhere "vault_dns" = $1 and "dry_run" = $2\nreturning "sfdc_id"',
    );
  });

  it("merge reads the survivor first and throws when it is missing", async () => {
    const { db, store } = make();
    await expect(
      store.idMap.merge("account", a1, "001000000000002", "r2"),
    ).rejects.toThrow(/survivor/);
    expect(db.transactions).toBe(1);
    expect(db.calls[0].params).toEqual([
      DNS,
      "account",
      to18("001000000000002"),
    ]);
  });

  it("runs.update throws when no row matched; create surfaces duplicates", async () => {
    const { db, store } = make();
    await expect(store.runs.update("r1", { status: "failed" })).rejects.toThrow(
      /not found/,
    );
    expect(db.calls[0].text).toContain('returning "run_id"');
    db.failWith = Object.assign(new Error("dup"), {
      code: "23505",
      constraint_name: "runs_pkey",
    });
    await expect(
      store.runs.create({
        runId: "r1",
        mode: "init",
        countries: ["US"],
        startedAt: "t",
        status: "running",
        toolVersion: "0",
        configHash: "c",
      }),
    ).rejects.toThrow(/already exists/);
    expect(db.calls[1].text).not.toContain("on conflict");
  });

  it("runs.update drops undefined patch values (never writes them as NULL)", async () => {
    const { db, store } = make();
    db.responses.push([{ run_id: "r1" }]);
    await store.runs.update("r1", {
      status: "failed",
      mappingHash: undefined,
      sfdcNowAtStart: undefined,
      freezeAt: null,
    });
    const upd = db.calls[0];
    expect(upd.text).toContain('"status" = $1');
    expect(upd.text).toContain('"freeze_at" = $2');
    expect(upd.text).not.toContain("mapping_hash");
    expect(upd.text).not.toContain("sfdc_now_at_start");
    expect(upd.params.slice(0, 2)).toEqual(["failed", null]);
    // an all-undefined patch issues no update at all (existence check only)
    db.responses.push([{ run_id: "r1" }]);
    await store.runs.update("r1", { mappingHash: undefined });
    expect(db.calls).toHaveLength(2);
    expect(db.calls[1].text).toMatch(/^select/);
  });

  it("rowResults.query builds state any() and pagination; counts use group by", async () => {
    const { db, store } = make();
    await store.rowResults.query({
      runId: "r1",
      state: ["failed", "skipped"],
      batchNo: 2,
      limit: 10,
      offset: 5,
    });
    expect(db.calls[0].text).toContain('"state" = any($2::text[])');
    expect(db.calls[0].text).toContain("limit $4\noffset $5");
    expect(db.calls[0].params).toEqual(["r1", ["failed", "skipped"], 2, 10, 5]);
    db.responses.push([
      { state: "failed", n: "2" },
      { state: "loaded_created", n: 1 },
    ]);
    expect(await store.rowResults.countByState("r1", "account", "US")).toEqual({
      failed: 2,
      loaded_created: 1,
    });
    expect(db.calls[1].text).toContain('group by "state"');
    db.responses.push([{ t: "UNKNOWN", n: 1 }]);
    expect(
      await store.rowResults.countFailedByType("r1", "account", "US"),
    ).toEqual({ UNKNOWN: 1 });
    expect(db.calls[2].text).toContain("coalesce(\"error_type\", 'UNKNOWN')");
    expect(db.calls[2].params).toEqual(["r1", "account", "US", "failed"]);
  });

  it("pendingFk.add keeps attempts; bumpAttempts increments in SQL", async () => {
    const { db, store } = make();
    const p = {
      runId: "r1",
      objectKey: "call2" as const,
      country: "US",
      sfdcId: "a0K000000000001",
      field: "f",
      targetObjectKey: "account" as const,
      targetSfdcId: "001000000000001",
      attempts: 0,
    };
    await store.pendingFk.add([p]);
    const cols = TABLES.pending_fk.columns.map((c) => c.name);
    expect(db.calls[0].params[cols.indexOf("sfdc_id")]).toEqual([
      to18("a0K000000000001"),
    ]);
    expect(db.calls[0].params[cols.indexOf("target_sfdc_id")]).toEqual([a1]);
    expect(db.calls[0].text).not.toContain('"attempts" = excluded');
    await store.pendingFk.bumpAttempts("r1", "call2", "a0K000000000001", "f");
    expect(db.calls[1].text).toContain('set "attempts" = "attempts" + 1 where');
    expect(db.calls[1].params).toEqual([
      "r1",
      "call2",
      to18("a0K000000000001"),
      "f",
    ]);
  });

  it("findings.previous walks run creation order via seq; auditLog.list limit takes the tail", async () => {
    const { db, store } = make();
    db.responses.push(
      [{ run_id: "r1" }],
      [
        {
          id: "1",
          run_id: "r1",
          severity: "info",
          code: "X",
          detail: "d",
          created_at: "t",
        },
      ],
    );
    const prev = await store.findings.previous("r2");
    expect(prev).toEqual([
      {
        id: 1,
        runId: "r1",
        severity: "info",
        code: "X",
        detail: "d",
        createdAt: "t",
      },
    ]);
    expect(db.calls[0].text).toContain(
      '"seq" < (select "seq" from "veeva_migration"."runs" where "run_id" = $1)',
    );
    db.responses.push([]);
    expect(await store.findings.previous("r1")).toEqual([]);
    await store.auditLog.list({ runId: "r1", limit: 2 });
    expect(db.calls.at(-1)?.text).toBe(
      'select * from (select * from "veeva_migration"."audit_log" where "run_id" = $1 order by "id" desc limit $2) sub order by "id" asc',
    );
    await store.auditLog.list();
    expect(db.calls.at(-1)?.text).toBe(
      'select * from "veeva_migration"."audit_log"  order by "id" asc',
    );
  });

  it("probeResults are scoped to the bound vault; countryStatus null deletes", async () => {
    const { db, store } = make();
    await store.probeResults.set({
      vaultDns: "x",
      probe: "p",
      result: { ok: 1 },
      checkedAt: "t",
    });
    const cols = TABLES.probe_results.columns.map((c) => c.name);
    expect(db.calls[0].params[cols.indexOf("vault_dns")]).toEqual([DNS]);
    expect(db.calls[0].params[cols.indexOf("result")]).toEqual([{ ok: 1 }]);
    await store.probeResults.list();
    expect(db.calls[1].params).toEqual([DNS]);
    await store.countryStatus.setFrozen("NL", null);
    expect(db.calls[2].text).toMatch(
      /^delete from "veeva_migration"."country_status"/,
    );
    db.responses.push([{ n: 1 }]);
    expect(await store.countryStatus.isFrozen("NL")).toBe(true);
  });
});
