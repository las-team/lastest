import { describe, expect, it } from "vitest";
import {
  buildCount,
  buildDelete,
  buildSelect,
  buildUpdate,
  buildUpsert,
  buildWhere,
  chunk,
  ddlStatements,
  dedupeRows,
  fromRecord,
  ident,
  Params,
  qualified,
  snakeToCamel,
  TABLE_NAMES,
  TABLES,
  toDbValue,
} from "./sql";

describe("table definitions", () => {
  it("cover every §2.4 table plus fk_index, audit_log, probe_results", () => {
    expect(TABLE_NAMES).toEqual(
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
  });
  it("carry the §2.4 primary keys", () => {
    expect(TABLES.id_map.primaryKey).toEqual([
      "vault_dns",
      "object_key",
      "sfdc_id",
    ]);
    expect(TABLES.watermarks.primaryKey).toEqual([
      "object_key",
      "country",
      "kind",
    ]);
    expect(TABLES.row_results.primaryKey).toEqual([
      "run_id",
      "object_key",
      "sfdc_id",
    ]);
    expect(TABLES.fk_index.primaryKey).toEqual([
      "object_key",
      "sfdc_id",
      "field",
    ]);
    expect(TABLES.probe_results.primaryKey).toEqual(["vault_dns", "probe"]);
    expect(TABLES.runs.primaryKey).toEqual(["run_id"]);
    expect(TABLES.audit_log.primaryKey).toEqual(["id"]);
    expect(TABLES.mapping_snapshots.primaryKey).toEqual([
      "mapping_hash",
      "object_key",
      "country",
    ]);
  });
  it("every primary key / index column exists and props are camelCase", () => {
    for (const name of TABLE_NAMES) {
      const def = TABLES[name];
      const cols = new Set(def.columns.map((c) => c.name));
      for (const pk of def.primaryKey)
        expect(cols.has(pk), `${name}.${pk}`).toBe(true);
      for (const idx of def.indexes ?? [])
        for (const col of idx.columns)
          expect(cols.has(col), `${idx.name}.${col}`).toBe(true);
      for (const col of def.columns) {
        expect(col.prop).toBe(snakeToCamel(col.name));
        expect(col.prop).not.toMatch(/_/);
      }
      expect(new Set(def.columns.map((c) => c.prop)).size).toBe(
        def.columns.length,
      );
    }
  });
  it("sfdc id columns are char(18)", () => {
    for (const name of TABLE_NAMES)
      for (const col of TABLES[name].columns)
        if (/sfdc_id$|merged_into/.test(col.name))
          expect(col.type).toBe("char(18)");
  });
});

describe("ddlStatements", () => {
  const ddl = ddlStatements();
  it("creates the schema first, then every table and index with IF NOT EXISTS", () => {
    expect(ddl[0]).toBe('create schema if not exists "veeva_migration"');
    for (const name of TABLE_NAMES)
      expect(
        ddl.some((s) =>
          s.startsWith(
            `create table if not exists "veeva_migration"."${name}" (`,
          ),
        ),
      ).toBe(true);
    expect(ddl.every((s) => /if not exists/.test(s))).toBe(true);
  });
  it("id_map has the partial unique index and fk_index the target index", () => {
    expect(ddl).toContain(
      'create unique index if not exists "id_map_vault_uidx" on "veeva_migration"."id_map" ("vault_dns", "vault_object", "vault_id") where merged_into is null and deleted_at is null',
    );
    expect(ddl).toContain(
      'create index if not exists "fk_index_target_idx" on "veeva_migration"."fk_index" ("target_object_key", "target_sfdc_id")',
    );
  });
  it("renders column types, nullability, defaults, serials and primary keys", () => {
    const idMap = ddl.find((s) => s.includes('"id_map" ('))!;
    expect(idMap).toContain('"sfdc_id" char(18) not null');
    expect(idMap).toContain('"merged_into" char(18)');
    expect(idMap).not.toContain('"merged_into" char(18) not null');
    expect(idMap).toContain('"dry_run" boolean not null default false');
    expect(idMap).toContain(
      'primary key ("vault_dns", "object_key", "sfdc_id")',
    );
    const audit = ddl.find((s) => s.includes('"audit_log" ('))!;
    expect(audit).toContain('"id" bigserial');
    expect(audit).toContain('"detail" jsonb');
    const runs = ddl.find((s) => s.includes('"runs" ('))!;
    expect(runs).toContain('"countries" text[] not null');
    expect(runs).toContain('"seq" bigserial');
  });
  it("honours a custom schema name and rejects bad identifiers", () => {
    expect(ddlStatements("mig_test")[0]).toBe(
      'create schema if not exists "mig_test"',
    );
    expect(() => ddlStatements("bad; drop")).toThrow(/invalid SQL identifier/);
    expect(() => ident('a"b')).toThrow();
    expect(qualified("id_map", "s")).toBe('"s"."id_map"');
  });
});

describe("toDbValue / fromRecord", () => {
  const col = (name: string, table: keyof typeof TABLES = "id_map") =>
    TABLES[table].columns.find((c) => c.name === name)!;
  it("maps undefined to null, jsonb to text, arrays and numbers", () => {
    expect(toDbValue(col("merged_into"), undefined)).toBeNull();
    expect(toDbValue(col("dry_run"), undefined)).toBe(false);
    expect(toDbValue(col("dry_run"), 1)).toBe(true);
    expect(toDbValue(col("detail", "audit_log"), { a: 1 })).toEqual({ a: 1 });
    expect(toDbValue(col("detail", "preflight_findings"), "gone")).toBe("gone");
    expect(toDbValue(col("countries", "runs"), ["US", "DE"])).toEqual([
      "US",
      "DE",
    ]);
    expect(toDbValue(col("attempt", "row_results"), "3")).toBe(3);
    expect(toDbValue(col("vault_id"), 123)).toBe("123");
  });
  it("fromRecord camelCases, strips nulls and coerces bigint strings", () => {
    const row = fromRecord<Record<string, unknown>>("audit_log", {
      id: "42",
      run_id: null,
      at: "t",
      actor: "cli",
      event: "e",
      detail: { x: 1 },
    });
    expect(row).toEqual({
      id: 42,
      at: "t",
      actor: "cli",
      event: "e",
      detail: { x: 1 },
    });
    const rec = fromRecord<Record<string, unknown>>("reconciliation", {
      run_id: "r",
      object_key: "account",
      country: "US",
      extracted: 3,
      skipped_by_reason: { erased: 1 },
      sfdc_scope_count: null,
    });
    expect(rec).toEqual({
      runId: "r",
      objectKey: "account",
      country: "US",
      extracted: 3,
      skippedByReason: { erased: 1 },
    });
    expect("sfdcScopeCount" in rec).toBe(false);
  });
});

describe("buildUpsert", () => {
  const rows = [
    {
      objectKey: "account",
      sfdcId: "001000000000001AAA",
      vaultDns: "v",
      vaultObject: "account__v",
      vaultId: "V1",
      country: "US",
      matchMethod: "created",
      firstSeenRun: "r1",
      lastSeenRun: "r1",
    },
    {
      objectKey: "account",
      sfdcId: "001000000000002AAA",
      vaultDns: "v",
      vaultObject: "account__v",
      vaultId: "V2",
      country: "US",
      matchMethod: "created",
      firstSeenRun: "r1",
      lastSeenRun: "r1",
      dryRun: true,
      deletedAt: null,
    },
  ];
  it("emits one unnest insert with one typed array parameter per column, keeping first_seen_run", () => {
    const { text, params } = buildUpsert("id_map", rows, {
      keep: ["first_seen_run"],
    });
    const cols = TABLES.id_map.columns;
    expect(params).toHaveLength(cols.length);
    expect(text).toContain(
      'insert into "veeva_migration"."id_map" ("object_key", "sfdc_id", "vault_dns"',
    );
    expect(text).toContain('select t."object_key", t."sfdc_id"');
    expect(text).toContain(
      't."dry_run"::boolean from unnest($1::text[], $2::char(18)[], $3::text[]',
    );
    expect(text).toContain(`$${cols.length}::text[]`);
    expect(text).toContain(
      'on conflict ("vault_dns", "object_key", "sfdc_id") do update set "vault_object" = excluded."vault_object"',
    );
    expect(text).not.toContain('"first_seen_run" = excluded');
    expect(text).toContain('"last_seen_run" = excluded."last_seen_run"');
    expect(params[1]).toEqual(["001000000000001AAA", "001000000000002AAA"]);
    const dryRunIdx = cols.findIndex((c) => c.name === "dry_run");
    expect(params[dryRunIdx]).toEqual(["false", "true"]);
    const mergedIdx = cols.findIndex((c) => c.name === "merged_into");
    expect(params[mergedIdx]).toEqual([null, null]);
  });
  it("skips serial columns and supports do nothing / plain insert / returning", () => {
    const { text, params } = buildUpsert(
      "audit_log",
      [{ at: "t", actor: "a", event: "e", detail: { k: 1 } }],
      { onConflict: "none", returning: ["id"] },
    );
    expect(text).not.toContain('"id"::');
    expect(text).not.toContain("on conflict");
    expect(text).toMatch(/returning "id"$/);
    expect(params).toEqual([[null], ["t"], ["a"], ["e"], [{ k: 1 }]]);
    expect(
      buildUpsert("watermarks", [], { onConflict: "nothing" }).text,
    ).toContain('on conflict ("object_key", "country", "kind") do nothing');
  });
  it("falls back to do nothing when every column is part of the key", () => {
    const { text } = buildUpsert(
      "schema_migrations",
      [{ version: 1, appliedAt: "t" }],
      {
        keep: ["applied_at"],
      },
    );
    expect(text).toContain('on conflict ("version") do nothing');
  });
  it("passes array columns as one JSON document per row and projects them back to text[]", () => {
    const { text, params } = buildUpsert("runs", [
      {
        runId: "r1",
        mode: "init",
        countries: ["US", "DE"],
        startedAt: "t",
        status: "running",
        toolVersion: "0",
        configHash: "c",
      },
    ]);
    const cols = TABLES.runs.columns.filter((c) => !c.serial);
    const i = cols.findIndex((c) => c.name === "countries");
    expect(text).toContain(`$${i + 1}::jsonb[]`);
    expect(text).toContain(
      `array(select jsonb_array_elements_text(t."countries"->'v'))::text[]`,
    );
    expect(params[i]).toEqual([{ v: ["US", "DE"] }]);
    expect(text).not.toContain("select *");
  });
  it("uses the requested schema", () => {
    expect(buildUpsert("runs", [], { schema: "s2" }).text).toContain(
      '"s2"."runs"',
    );
  });
});

describe("buildWhere / buildSelect / buildCount / buildUpdate / buildDelete", () => {
  it("numbers placeholders, supports any(), is null and skips falsy conditions", () => {
    const params = new Params();
    const where = buildWhere(
      "row_results",
      [
        { column: "run_id", value: "r1" },
        undefined,
        false,
        { column: "state", op: "any", value: ["failed", "skipped"] },
        { column: "error_type", op: "is null" },
        { column: "batch_no", op: "!=", value: 3 },
      ],
      params,
    );
    expect(where).toBe(
      'where "run_id" = $1 and "state" = any($2::text[]) and "error_type" is null and "batch_no" != $3',
    );
    expect(params.values).toEqual(["r1", ["failed", "skipped"], 3]);
    expect(buildWhere("runs", [], new Params())).toBe("");
    expect(() =>
      buildWhere("runs", [{ column: "nope", value: 1 }], new Params()),
    ).toThrow(/unknown column/);
  });
  it("buildSelect adds order/limit/offset", () => {
    const { text, params } = buildSelect("runs", {
      where: [{ column: "status", value: "succeeded" }],
      orderBy: ['"started_at" desc'],
      limit: 5,
      offset: 10,
      columns: ["run_id"],
    });
    expect(text).toBe(
      'select "run_id" from "veeva_migration"."runs"\nwhere "status" = $1\norder by "started_at" desc\nlimit $2\noffset $3',
    );
    expect(params).toEqual(["succeeded", 5, 10]);
    expect(buildSelect("runs").text).toBe(
      'select * from "veeva_migration"."runs"',
    );
  });
  it("buildCount", () => {
    const { text, params } = buildCount("id_map", [
      { column: "vault_dns", value: "v" },
      { column: "deleted_at", op: "is null" },
    ]);
    expect(text).toBe(
      'select count(*)::int as n from "veeva_migration"."id_map"\nwhere "vault_dns" = $1 and "deleted_at" is null',
    );
    expect(params).toEqual(["v"]);
  });
  it("buildUpdate maps props, refuses unfiltered updates and unknown props", () => {
    const { text, params } = buildUpdate(
      "id_map",
      { sourceHash: "h", lastSeenRun: "r2", deletedAt: null },
      [{ column: "sfdc_id", value: "001000000000001AAA" }],
      { returning: ["sfdc_id"] },
    );
    expect(text).toBe(
      'update "veeva_migration"."id_map" set "source_hash" = $1, "last_seen_run" = $2, "deleted_at" = $3\nwhere "sfdc_id" = $4\nreturning "sfdc_id"',
    );
    expect(params).toEqual(["h", "r2", null, "001000000000001AAA"]);
    expect(() => buildUpdate("id_map", { sourceHash: "h" }, [])).toThrow(
      /unfiltered/,
    );
    expect(() =>
      buildUpdate("id_map", { nope: 1 }, [{ column: "sfdc_id", value: "x" }]),
    ).toThrow(/unknown property/);
    expect(() =>
      buildUpdate("id_map", {}, [{ column: "sfdc_id", value: "x" }]),
    ).toThrow(/nothing to set/);
  });
  it("buildDelete", () => {
    const { text, params } = buildDelete(
      "id_map",
      [{ column: "dry_run", value: true }],
      { returning: ["sfdc_id"] },
    );
    expect(text).toBe(
      'delete from "veeva_migration"."id_map"\nwhere "dry_run" = $1\nreturning "sfdc_id"',
    );
    expect(params).toEqual([true]);
    expect(() => buildDelete("id_map", [])).toThrow(/unfiltered/);
  });
});

describe("dedupeRows / chunk", () => {
  it("dedupes last-wins with keepFirst props", () => {
    const out = dedupeRows(
      [
        { k: "a", v: 1, first: "x" },
        { k: "b", v: 2, first: "y" },
        { k: "a", v: 3, first: "z" },
      ],
      (r) => r.k,
      ["first"],
    );
    expect(out).toEqual([
      { k: "a", v: 3, first: "x" },
      { k: "b", v: 2, first: "y" },
    ]);
  });
  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });
});
