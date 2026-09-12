import { afterEach, describe, expect, it } from "vitest";
import { parseCountryOf } from "../country-of";
import type { SfdcBulkQueryOptions, SfdcBulkResult } from "../sfdc/types";
import {
  FakeSfdcClient,
  IDS,
  MemoryStateStore,
  SAMPLE_USER_ID,
  buildDescribe,
  buildMaterialisedMapping,
  sampleAccountDescribe,
  sampleAccountRows,
  sampleCall2Describe,
  sampleCall2Rows,
} from "../testkit";
import { to18 } from "../transform/ids";
import { parseTransform } from "../transform/spec";
import type {
  FieldMapping,
  MaterialisedMapping,
  SourceRow,
  Unit,
} from "../types";
import { readCsvRows, writeCsvFile } from "./files";
import { PK_CHUNK_INIT_SOURCES, SfdcExtractor, mergeFkSets } from "./extractor";
import { cleanup, makeTarget, tmpRunDir } from "./test-helpers";
import type { ExtractPlan } from "./types";

const ACC = "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c";
const P = (n: number) => to18(`a0P0000000000${String(n).padStart(2, "0")}`);
const MC = (n: number) => to18(`a0M0000000000${String(n).padStart(2, "0")}`);
const D = (n: number) => to18(`a0D0000000000${String(n).padStart(2, "0")}`);

function f(
  source: string,
  target: string,
  transform: string,
  required: FieldMapping["required"] = "n",
): FieldMapping {
  return { source, target, transform: parseTransform(transform), required };
}

const call2Mapping = buildMaterialisedMapping({
  objectKey: "call2",
  sourceObject: "Call2_vod__c",
  targetObject: "call2__v",
  countryOf: parseCountryOf(["account", "user:User_vod__c", "user:OwnerId"]),
  scope: {
    spec: {
      kind: "dated",
      predicates: [{ field: "Call_Date_vod__c", type: "date" }],
      openPredicate: "Status_vod__c = 'Planned_vod'",
    },
    cutoffDate: "2024-09-09",
    historyMonths: 24,
  },
  load: {
    noTriggers: true,
    partitionBy: { field: "Parent_Call_vod__c", order: ["null", "notNull"] },
  },
  fields: [
    f("Id", "legacy_crm_id__v", "legacyId", "K"),
    f("Account_vod__c", "account__v", "ref(account)", "Y"),
    f("User_vod__c", "user__v", "refUser"),
    f("OwnerId", "ownerid__v", "refUser"),
    f("Status_vod__c", "status_vod__v", "picklist(call2.status)"),
    f("Call_Date_vod__c", "call_date__v", "date"),
    f("Parent_Call_vod__c", "parent_call__v", "ref(call2) secondPass"),
  ],
});

function productDescribe() {
  return buildDescribe(
    "Product_vod__c",
    [
      {
        name: "Parent_Product_vod__c",
        type: "reference",
        referenceTo: ["Product_vod__c"],
        relationshipName: "Parent_Product_vod__r",
      },
    ],
    { keyPrefix: "a0P" },
  );
}
function productRows(): SourceRow[] {
  const r = (n: number, parent: number | null) => ({
    Id: P(n),
    Name: `P${n}`,
    Parent_Product_vod__c: parent === null ? null : P(parent),
    SystemModstamp: `2025-01-0${n}T00:00:00.000Z`,
  });
  return [r(3, 2), r(1, null), r(2, 1), r(4, 5), r(5, 4)];
}
function productMapping(
  load: MaterialisedMapping["load"] = { noTriggers: true },
) {
  return buildMaterialisedMapping({
    objectKey: "product",
    sourceObject: "Product_vod__c",
    targetObject: "product__v",
    countryOf: parseCountryOf("global"),
    load,
    fields: [
      f("Id", "legacy_crm_id__v", "legacyId", "K"),
      f("Name", "name__v", "text", "Y"),
      f(
        "Parent_Product_vod__c",
        "parent_product__v",
        "ref(product) secondPass",
      ),
    ],
  });
}

/** Drops the first row of the first Bulk page once — simulates the "missing rows without PK chunking" report (§2.1.5). */
class DroppingSfdc extends FakeSfdcClient {
  dropped = false;
  bulkQuery(soql: string, opts?: SfdcBulkQueryOptions): SfdcBulkResult {
    const inner = super.bulkQuery(soql, opts);
    if (this.dropped) return inner;
    this.dropped = true;
    return {
      job: inner.job,
      async *[Symbol.asyncIterator]() {
        let first = true;
        for await (const p of inner) {
          if (first) {
            first = false;
            yield { ...p, records: p.records.slice(1), rows: p.rows - 1 };
          } else yield p;
        }
      },
    };
  }
}

describe("SfdcExtractor.extractUnit", () => {
  let runDir: string | undefined;
  afterEach(async () => cleanup(runDir));

  function plan(
    over: Partial<ExtractPlan> & Pick<ExtractPlan, "mapping" | "target">,
  ): ExtractPlan {
    return { runId: "r1", mode: "init", runDir: runDir!, ...over };
  }

  it("init/US call2: exact predicate, no IsDeleted term, queryAll routing, FK sets, checkpoints (REST)", async () => {
    runDir = await tmpRunDir();
    const sfdc = new FakeSfdcClient()
      .addDescribe(sampleCall2Describe())
      .addRows("Call2_vod__c", sampleCall2Rows());
    const call4 = to18("a0K000000000004");
    sfdc.addRows("Call2_vod__c", [
      { ...sampleCall2Rows()[0], Id: call4, Name: "C-4" },
    ]);
    sfdc.deleteRow("Call2_vod__c", call4, "2026-09-01T00:00:00.000Z");
    const store = new MemoryStateStore();
    const ex = new SfdcExtractor({ sfdc, store });
    const unit: Unit = { objectKey: "call2", country: "US" };
    const m = await ex.extractUnit(
      unit,
      plan({
        mapping: call2Mapping,
        target: makeTarget("call2", sampleCall2Describe()),
        cutoffDate: "2024-09-09",
      }),
    );

    const scope =
      "(Call_Date_vod__c >= 2024-09-09) OR (Status_vod__c = 'Planned_vod')";
    const country = `(${ACC} = 'US') OR (${ACC} = null AND User_vod__r.Country_vod__c = 'US') OR (${ACC} = null AND User_vod__r.Country_vod__c = null AND Owner.Country_vod__c = 'US')`;
    expect(m.predicate).toBe(`(${scope}) AND (${country})`);
    expect(m.cutoffDate).toBe("2024-09-09");
    expect(m.strategy).toBe("rest");
    expect(m.partitions).toBe(2);
    expect(m.sfdcScopeCount).toBe(1);
    expect(m.extractedLive).toBe(1);
    expect(m.extractedDeleted).toBe(1);
    expect(m.deletedIds).toMatchObject([
      {
        id: call4,
        source: "queryAll",
        deletedDate: "2026-09-01T00:00:00.000Z",
        partition: 0,
      },
    ]);
    expect(m.files).toHaveLength(1);
    expect(m.files[0]).toMatchObject({ partition: 0, rows: 1, closure: false });
    expect(m.files[0].path).toContain("/US/call2/extract/p0/");
    expect([...m.fkSets.get("account")!]).toEqual([IDS.account1]);
    expect([...m.fkSets.get("user")!]).toEqual([SAMPLE_USER_ID]);
    expect(m.fkSets.has("call2")).toBe(false);
    // no per-id modstamp index on init (nothing to supersede; unbounded on large objects)
    expect(m.liveModstamps.size).toBe(0);
    expect(m.columns).toEqual(
      expect.arrayContaining([
        "Id",
        "IsDeleted",
        "SystemModstamp",
        "Account_vod__c",
        ACC,
        "Owner.Country_vod__c",
      ]),
    );
    expect(m.findings).toEqual([]);

    const soqls = sfdc.calls
      .filter((c) => c.method === "query")
      .map((c) => c.args[0] as string);
    expect(soqls).toHaveLength(2);
    for (const s of soqls) expect(s).not.toMatch(/IsDeleted\s*=/);
    expect(soqls[0]).toContain("(Parent_Call_vod__c = null)");
    expect(soqls[1]).toContain("(Parent_Call_vod__c != null)");
    expect(soqls[0]).not.toMatch(/LAST_N|TODAY/);
    expect(
      sfdc.calls
        .filter((c) => c.method === "query")
        .every((c) => (c.args[1] as { all: boolean }).all),
    ).toBe(true);
    const order = sfdc.calls.map((c) => c.method);
    expect(order.indexOf("count")).toBeLessThan(order.indexOf("query"));
    const cps = await store.checkpoints.list("r1", "call2", "US");
    expect(cps).toHaveLength(2);
    expect(cps[0]).toMatchObject({ pageNo: 0, rows: 1, locator: null });
    // readRows streams the page back as CSV strings
    const rows: SourceRow[] = [];
    for await (const { row } of ex.readRows(m.files)) rows.push(row);
    expect(rows.map((r) => r.Id)).toEqual([IDS.call1]);
    expect(rows[0].IsDeleted).toBe("false");
  });

  it("init/DE: open-item planned attendee row lands in the notNull partition and references its parent", async () => {
    runDir = await tmpRunDir();
    const sfdc = new FakeSfdcClient()
      .addDescribe(sampleCall2Describe())
      .addRows("Call2_vod__c", sampleCall2Rows());
    const ex = new SfdcExtractor({ sfdc, store: new MemoryStateStore() });
    const m = await ex.extractUnit(
      { objectKey: "call2", country: "DE" },
      plan({
        mapping: call2Mapping,
        target: makeTarget("call2", sampleCall2Describe()),
        cutoffDate: "2024-09-09",
      }),
    );
    expect(m.extractedLive).toBe(1);
    expect(m.files[0]).toMatchObject({ partition: 1, rows: 1 });
    expect([...m.fkSets.get("call2")!]).toEqual([IDS.call1]);
    expect(
      mergeFkSets([m.fkSets, new Map([["call2", new Set([IDS.call3])]])]).get(
        "call2",
      )!.size,
    ).toBe(2);
  });

  it("Bulk queryAll above the threshold, page checkpoints with locators, depth ordering with a cycle", async () => {
    runDir = await tmpRunDir();
    const sfdc = new FakeSfdcClient()
      .addDescribe(productDescribe())
      .addRows("Product_vod__c", productRows());
    const store = new MemoryStateStore();
    const ex = new SfdcExtractor({ sfdc, store }, { restThreshold: 0 });
    const m = await ex.extractUnit(
      { objectKey: "product", country: "GLOBAL" },
      plan({
        mapping: productMapping({
          noTriggers: true,
          depthOrderBy: "Parent_Product_vod__c",
        }),
        target: makeTarget("product", productDescribe()),
      }),
    );
    expect(m.strategy).toBe("bulk");
    expect(m.predicate).toBe("");
    expect(m.sfdcScopeCount).toBe(5);
    expect(m.extractedLive).toBe(5);
    const bulk = sfdc.calls.filter((c) => c.method === "bulkQuery");
    expect(bulk).toHaveLength(1);
    expect(bulk[0].args[1]).toMatchObject({ all: true, pkChunking: false });
    expect(bulk[0].args[0]).toBe(
      "SELECT Id, IsDeleted, SystemModstamp, CreatedDate, CreatedById, LastModifiedDate, LastModifiedById, OwnerId, Name, Parent_Product_vod__c FROM Product_vod__c",
    );
    const cps = await store.checkpoints.list("r1", "product", "GLOBAL");
    expect(cps.map((c) => [c.pageNo, c.locator])).toEqual([
      [0, "loc-1"],
      [1, "loc-2"],
      [2, null],
    ]);
    expect(m.files.map((x) => x.partition)).toEqual([0, 1, 2, 21]);
    expect([...m.deferredParentIds].sort()).toEqual([P(4), P(5)].sort());
    expect(m.findings).toMatchObject([
      { code: "MAP_DEPTH_UNRESOLVED", severity: "warning", count: 2 },
    ]);
    const ids: string[] = [];
    for await (const { row } of ex.readRows(m.files)) ids.push(row.Id);
    expect(ids.slice(0, 3)).toEqual([P(1), P(2), P(3)]);
  });

  it("count mismatch → warning + automatic PK-chunked re-run; the re-run replaces the pages", async () => {
    runDir = await tmpRunDir();
    const sfdc = new DroppingSfdc()
      .addDescribe(productDescribe())
      .addRows("Product_vod__c", productRows());
    const store = new MemoryStateStore();
    const ex = new SfdcExtractor({ sfdc, store }, { restThreshold: 0 });
    const m = await ex.extractUnit(
      { objectKey: "product", country: "GLOBAL" },
      plan({
        mapping: productMapping(),
        target: makeTarget("product", productDescribe()),
      }),
    );
    expect(m.findings).toMatchObject([
      { severity: "warning", code: "EXTRACT_COUNT_MISMATCH", count: 1 },
    ]);
    expect(m.findings.some((x) => x.severity === "blocking")).toBe(false);
    const bulk = sfdc.calls.filter((c) => c.method === "bulkQuery");
    expect(bulk).toHaveLength(2);
    expect(bulk[1].args[1]).toMatchObject({ pkChunking: true });
    expect(m.extractedLive).toBe(5);
    expect(m.sfdcScopeCount).toBe(5);
    expect(m.files.reduce((n, x) => n + x.rows, 0)).toBe(5);
    expect([...m.fkSets.get("product")!].sort()).toEqual(
      [P(1), P(2), P(4), P(5)].sort(),
    );
  });

  it("delta: window predicate, getDeleted feed + queryAll deletes, latestDateCovered", async () => {
    runDir = await tmpRunDir();
    const sfdc = new FakeSfdcClient()
      .addDescribe(sampleCall2Describe())
      .addRows("Call2_vod__c", sampleCall2Rows());
    sfdc.upsertRow("Call2_vod__c", {
      ...sampleCall2Rows()[0],
      SystemModstamp: "2026-09-05T00:00:00.000Z",
    });
    const gone = to18("a0K000000000005");
    sfdc.addRows("Call2_vod__c", [{ ...sampleCall2Rows()[0], Id: gone }]);
    sfdc.deleteRow("Call2_vod__c", gone, "2026-09-06T00:00:00.000Z");
    const ex = new SfdcExtractor({ sfdc, store: new MemoryStateStore() });
    const window = {
      wmLo: "2026-09-01T09:50:00Z",
      wmHi: "2026-09-09T11:55:00Z",
    };
    const m = await ex.extractUnit(
      { objectKey: "call2", country: "US" },
      plan({
        mode: "delta",
        mapping: call2Mapping,
        target: makeTarget("call2", sampleCall2Describe()),
        cutoffDate: "2024-09-09",
        window,
        deletedSince: "2026-09-01T10:00:00Z",
      }),
    );
    expect(m.predicate).toContain(
      "(SystemModstamp >= 2026-09-01T09:50:00Z AND SystemModstamp < 2026-09-09T11:55:00Z)",
    );
    expect(m.predicate).toContain("Call_Date_vod__c >= 2024-09-09"); // scope still ANDed (§4.1)
    expect(m.extractedLive).toBe(1);
    expect(m.extractedDeleted).toBe(1);
    expect(m.deletedIds.map((d) => [d.id, d.source])).toEqual([
      [gone, "queryAll"],
      [gone, "feed"],
    ]);
    expect(m.deletedLatestCovered).toBe("2026-09-09T11:55:00Z");
    // last-wins routing input (§4.3 step 5) is kept for delta windows
    expect(m.liveModstamps.get(IDS.call1)).toBe("2026-09-05T00:00:00.000Z");
    expect(sfdc.calls.find((c) => c.method === "getDeleted")?.args).toEqual([
      "Call2_vod__c",
      "2026-09-01T10:00:00Z",
      "2026-09-09T11:55:00Z",
    ]);
    expect(sfdc.calls.some((c) => c.method === "getUpdated")).toBe(true);
    expect(m.findings.some((x) => x.code === "DELTA_COUNT_MISMATCH")).toBe(
      false,
    );
  });

  it("delta: non-replicateable object → SF_NOT_REPLICATEABLE + key-set reconciliation, no feeds", async () => {
    runDir = await tmpRunDir();
    const describe = buildDescribe(
      "UserTerritory2Association",
      [
        {
          name: "UserId",
          type: "reference",
          referenceTo: ["User"],
          relationshipName: "User",
        },
      ],
      { replicateable: false, systemFields: { name: false, owner: false } },
    );
    const live = to18("0MT000000000001");
    const gone = to18("0MT000000000002");
    const sfdc = new FakeSfdcClient()
      .addDescribe(describe)
      .addRows("UserTerritory2Association", [
        {
          Id: live,
          UserId: SAMPLE_USER_ID,
          SystemModstamp: "2026-09-05T00:00:00.000Z",
        },
      ]);
    const store = new MemoryStateStore();
    await store.seedIdMap(
      "user_territory",
      "user_territory__v",
      { [live]: "V1", [gone]: "V2" },
      "GLOBAL",
    );
    const mapping = buildMaterialisedMapping({
      objectKey: "user_territory",
      sourceObject: "UserTerritory2Association",
      targetObject: "user_territory__v",
      countryOf: parseCountryOf("global"),
      fields: [
        f("Id", "legacy_crm_id__v", "legacyId", "K"),
        f("UserId", "user__v", "refUser", "Y"),
      ],
    });
    const ex = new SfdcExtractor({ sfdc, store });
    const m = await ex.extractUnit(
      { objectKey: "user_territory", country: "GLOBAL" },
      plan({
        mode: "delta",
        mapping,
        target: makeTarget("user_territory", describe),
        window: { wmLo: "2026-09-01T00:00:00Z", wmHi: "2026-09-09T11:55:00Z" },
      }),
    );
    expect(m.findings).toMatchObject([
      { severity: "info", code: "SF_NOT_REPLICATEABLE" },
    ]);
    expect(m.deletedIds).toEqual([
      { id: gone, deletedDate: "2026-09-09T11:55:00Z", source: "keySet" },
    ]);
    expect(
      sfdc.calls.some(
        (c) => c.method === "getDeleted" || c.method === "getUpdated",
      ),
    ).toBe(false);
    expect(m.deletedLatestCovered).toBeUndefined();
  });

  it("delta: a delete watermark older than 30 days blocks and skips the feed", async () => {
    runDir = await tmpRunDir();
    const sfdc = new FakeSfdcClient()
      .addDescribe(sampleCall2Describe())
      .addRows("Call2_vod__c", sampleCall2Rows());
    const ex = new SfdcExtractor({ sfdc, store: new MemoryStateStore() });
    const m = await ex.extractUnit(
      { objectKey: "call2", country: "US" },
      plan({
        mode: "delta",
        mapping: call2Mapping,
        target: makeTarget("call2", sampleCall2Describe()),
        cutoffDate: "2024-09-09",
        window: { wmLo: "2026-09-01T09:50:00Z", wmHi: "2026-09-09T11:55:00Z" },
        deletedSince: "2026-06-01T00:00:00Z",
      }),
    );
    expect(m.findings).toMatchObject([
      { severity: "blocking", code: "DELETE_WINDOW_EXCEEDED" },
    ]);
    expect(sfdc.calls.some((c) => c.method === "getDeleted")).toBe(false);
  });

  it("parent id-set country strategy: REST IN chunks from the id map + this run's parents", async () => {
    runDir = await tmpRunDir();
    const describe = buildDescribe(
      "Call2_Detail_vod__c",
      [
        {
          name: "Call2_vod__c",
          type: "reference",
          referenceTo: ["Call2_vod__c"],
          relationshipName: "Call2_vod__r",
          nillable: false,
          cascadeDelete: true,
        },
      ],
      { keyPrefix: "a0D", systemFields: { owner: false, name: "autoNumber" } },
    );
    const sfdc = new FakeSfdcClient()
      .addDescribe(describe)
      .addRows("Call2_Detail_vod__c", [
        { Id: D(1), Call2_vod__c: IDS.call1 },
        { Id: D(2), Call2_vod__c: IDS.call2 },
        { Id: D(3), Call2_vod__c: IDS.call3 },
      ]);
    const store = new MemoryStateStore();
    await store.seedIdMap("call2", "call2__v", { [IDS.call1]: "V1" }, "US");
    await store.seedIdMap("call2", "call2__v", { [IDS.call2]: "V2" }, "DE");
    const mapping = buildMaterialisedMapping({
      objectKey: "call2_detail",
      sourceObject: "Call2_Detail_vod__c",
      targetObject: "call2_detail__v",
      countryOf: parseCountryOf("parent:call2:Call2_vod__c"),
      dependsOn: ["call2"],
      fields: [
        f("Id", "legacy_crm_id__v", "legacyId", "K"),
        f("Call2_vod__c", "call2__v", "ref(call2)", "Y"),
      ],
    });
    const opts = {
      parentCountryOf: () => undefined,
      parentIds: async () => [IDS.call3],
    };
    const ex = new SfdcExtractor({ sfdc, store }, opts);
    const m = await ex.extractUnit(
      { objectKey: "call2_detail", country: "US" },
      plan({ mapping, target: makeTarget("call2_detail", describe) }),
    );
    expect(m.countryStrategy).toBe("idSet");
    expect(m.extractedLive).toBe(2);
    expect(m.sfdcScopeCount).toBe(2);
    const soql = sfdc.calls.find((c) => c.method === "query")!
      .args[0] as string;
    expect(soql).toContain(`Call2_vod__c IN ('${IDS.call1}','${IDS.call3}')`);
    expect([...m.fkSets.get("call2")!].sort()).toEqual(
      [IDS.call1, IDS.call3].sort(),
    );

    // client-side filter mode (large parent sets): same rows; the reported
    // scope count is netted of the rows the client filter dropped so the
    // §2.8 gate (sfdc_scope_count == extracted_live) can pass
    const ex2 = new SfdcExtractor(
      {
        sfdc: new FakeSfdcClient()
          .addDescribe(describe)
          .addRows("Call2_Detail_vod__c", sfdc.getRows("Call2_Detail_vod__c")),
        store,
      },
      { ...opts, idSetRestMax: 0 },
    );
    const m2 = await ex2.extractUnit(
      { objectKey: "call2_detail", country: "US" },
      plan({
        runId: "r2",
        mapping,
        target: makeTarget("call2_detail", describe),
      }),
    );
    expect(m2.extractedLive).toBe(2);
    expect(m2.filteredOut).toBe(1);
    expect(m2.sfdcScopeCount).toBe(2);
    expect(m2.findings.some((x) => x.code === "EXTRACT_COUNT_MISMATCH")).toBe(
      false,
    );
  });

  it("const:<other> country → empty unit without touching Salesforce", async () => {
    runDir = await tmpRunDir();
    const sfdc = new FakeSfdcClient().addDescribe(productDescribe());
    const ex = new SfdcExtractor({ sfdc, store: new MemoryStateStore() });
    const mapping = {
      ...productMapping(),
      countryOf: parseCountryOf("const:US"),
    };
    const m = await ex.extractUnit(
      { objectKey: "product", country: "DE" },
      plan({ mapping, target: makeTarget("product", productDescribe()) }),
    );
    expect(m.findings).toMatchObject([{ code: "EXTRACT_COUNTRY_EMPTY" }]);
    expect(sfdc.calls).toEqual([]);
    expect(m.strategy).toBe("empty");
  });

  it("--limit uses REST with LIMIT and skips the count reconciliation", async () => {
    runDir = await tmpRunDir();
    const sfdc = new FakeSfdcClient()
      .addDescribe(sampleAccountDescribe())
      .addRows("Account", sampleAccountRows());
    const mapping = buildMaterialisedMapping({
      objectKey: "account",
      sourceObject: "Account",
      targetObject: "account__v",
      countryOf: parseCountryOf("field:Country_vod__r.Alpha_2_Code_vod__c"),
      fields: [
        f("Id", "legacy_crm_id__v", "legacyId", "K"),
        f("Name", "name__v", "text", "Y"),
      ],
    });
    const ex = new SfdcExtractor(
      { sfdc, store: new MemoryStateStore() },
      { restThreshold: 0 },
    );
    const m = await ex.extractUnit(
      { objectKey: "account", country: "US" },
      plan({
        mapping,
        target: makeTarget("account", sampleAccountDescribe()),
        limit: 1,
      }),
    );
    expect(m.strategy).toBe("rest");
    expect(m.extractedLive).toBe(1);
    expect(sfdc.calls.find((c) => c.method === "query")!.args[0]).toMatch(
      / LIMIT 1$/,
    );
    expect(m.findings).toEqual([]);
  });

  it("load.orderBy: REST orders in SOQL, Bulk gets an external merge-sort", async () => {
    runDir = await tmpRunDir();
    const describe = buildDescribe(
      "Multichannel_Consent_vod__c",
      [
        { name: "Capture_Datetime_vod__c", type: "datetime" },
        {
          name: "Account_vod__c",
          type: "reference",
          referenceTo: ["Account"],
          relationshipName: "Account_vod__r",
        },
      ],
      { keyPrefix: "a0M" },
    );
    const rows: SourceRow[] = [
      {
        Id: MC(3),
        Capture_Datetime_vod__c: "2025-03-01T00:00:00.000Z",
        Account_vod__c: IDS.account1,
      },
      {
        Id: MC(1),
        Capture_Datetime_vod__c: "2025-01-01T00:00:00.000Z",
        Account_vod__c: IDS.account1,
      },
      {
        Id: MC(5),
        Capture_Datetime_vod__c: null,
        Account_vod__c: IDS.account1,
      },
      {
        Id: MC(2),
        Capture_Datetime_vod__c: "2025-01-01T00:00:00.000Z",
        Account_vod__c: IDS.account1,
      },
      {
        Id: MC(4),
        Capture_Datetime_vod__c: "2024-12-31T00:00:00.000Z",
        Account_vod__c: IDS.account1,
      },
    ];
    const mapping = buildMaterialisedMapping({
      objectKey: "multichannel_consent",
      sourceObject: "Multichannel_Consent_vod__c",
      targetObject: "multichannel_consent__v",
      countryOf: parseCountryOf("global"),
      load: { noTriggers: true, orderBy: ["Capture_Datetime_vod__c", "Id"] },
      fields: [
        f("Id", "legacy_crm_id__v", "legacyId", "K"),
        f("Capture_Datetime_vod__c", "capture_datetime__v", "datetime", "Y"),
        f("Account_vod__c", "account__v", "ref(account)", "Y"),
      ],
    });
    const expected = [MC(4), MC(1), MC(2), MC(3), MC(5)];

    const bulkSfdc = new FakeSfdcClient()
      .addDescribe(describe)
      .addRows("Multichannel_Consent_vod__c", rows);
    const bulkEx = new SfdcExtractor(
      { sfdc: bulkSfdc, store: new MemoryStateStore() },
      { restThreshold: 0, sortChunkRows: 1000 },
    );
    const mb = await bulkEx.extractUnit(
      { objectKey: "multichannel_consent", country: "GLOBAL" },
      plan({ mapping, target: makeTarget("multichannel_consent", describe) }),
    );
    expect(mb.strategy).toBe("bulk");
    expect(mb.files.every((x) => x.path.includes("/sorted/"))).toBe(true);
    const got: string[] = [];
    for await (const { row } of bulkEx.readRows(mb.files)) got.push(row.Id);
    expect(got).toEqual(expected);

    const restSfdc = new FakeSfdcClient()
      .addDescribe(describe)
      .addRows("Multichannel_Consent_vod__c", rows);
    const restEx = new SfdcExtractor({
      sfdc: restSfdc,
      store: new MemoryStateStore(),
    });
    const mr = await restEx.extractUnit(
      { objectKey: "multichannel_consent", country: "GLOBAL" },
      plan({
        runId: "r2",
        mapping,
        target: makeTarget("multichannel_consent", describe),
      }),
    );
    expect(restSfdc.calls.find((c) => c.method === "query")!.args[0]).toMatch(
      / ORDER BY Capture_Datetime_vod__c, Id$/,
    );
    expect(mr.files.every((x) => x.path.includes("/extract/"))).toBe(true);
    const got2: string[] = [];
    for await (const { row } of restEx.readRows(mr.files)) got2.push(row.Id);
    expect(got2).toEqual(expected);
  });

  it("resumes a completed Bulk extract of the same run from the checkpoints without re-querying", async () => {
    runDir = await tmpRunDir();
    const sfdc = new FakeSfdcClient()
      .addDescribe(productDescribe())
      .addRows("Product_vod__c", productRows());
    const store = new MemoryStateStore();
    const p = plan({
      mapping: productMapping(),
      target: makeTarget("product", productDescribe()),
    });
    const first = await new SfdcExtractor(
      { sfdc, store },
      { restThreshold: 0 },
    ).extractUnit({ objectKey: "product", country: "GLOBAL" }, p);
    expect(sfdc.calls.filter((c) => c.method === "bulkQuery")).toHaveLength(1);
    const second = await new SfdcExtractor(
      { sfdc, store },
      { restThreshold: 0 },
    ).extractUnit({ objectKey: "product", country: "GLOBAL" }, p);
    expect(sfdc.calls.filter((c) => c.method === "bulkQuery")).toHaveLength(1);
    expect(second.extractedLive).toBe(first.extractedLive);
    expect(second.files.map((x) => x.path)).toEqual(
      first.files.map((x) => x.path),
    );
    expect([...second.fkSets.get("product")!].sort()).toEqual(
      [...first.fkSets.get("product")!].sort(),
    );
    expect(second.findings).toEqual([]);
  });

  it("a resumed-complete Bulk extract still runs the count check and re-queries when a page lost rows", async () => {
    runDir = await tmpRunDir();
    const sfdc = new FakeSfdcClient()
      .addDescribe(productDescribe())
      .addRows("Product_vod__c", productRows());
    const store = new MemoryStateStore();
    const p = plan({
      mapping: productMapping(),
      target: makeTarget("product", productDescribe()),
    });
    const first = await new SfdcExtractor(
      { sfdc, store },
      { restThreshold: 0 },
    ).extractUnit({ objectKey: "product", country: "GLOBAL" }, p);
    // simulate a torn page on disk: drop one row from the first page file
    const page = first.files[0];
    const rows = await readCsvRows(page.path);
    await writeCsvFile(page.path, rows.slice(1), first.columns);
    const second = await new SfdcExtractor(
      { sfdc, store },
      { restThreshold: 0 },
    ).extractUnit({ objectKey: "product", country: "GLOBAL" }, p);
    expect(second.findings).toMatchObject([
      { severity: "warning", code: "EXTRACT_COUNT_MISMATCH", count: 1 },
    ]);
    const bulk = sfdc.calls.filter((c) => c.method === "bulkQuery");
    expect(bulk).toHaveLength(2);
    expect(bulk[1].args[1]).toMatchObject({ pkChunking: true });
    expect(second.extractedLive).toBe(5);
    expect(second.sfdcScopeCount).toBe(5);
    expect(second.files.reduce((n, x) => n + x.rows, 0)).toBe(5);
  });

  it("PK chunking is on from the first pass on init for the §2.1.5 large objects and above the row threshold", async () => {
    runDir = await tmpRunDir();
    expect(PK_CHUNK_INIT_SOURCES.has("Call2_vod__c")).toBe(true);
    expect(PK_CHUNK_INIT_SOURCES.has("Account")).toBe(true);
    const mk = () =>
      new FakeSfdcClient()
        .addDescribe(sampleCall2Describe())
        .addRows("Call2_vod__c", sampleCall2Rows());
    const call2Plan = (over: Partial<ExtractPlan> = {}) =>
      plan({
        mapping: call2Mapping,
        target: makeTarget("call2", sampleCall2Describe()),
        cutoffDate: "2024-09-09",
        ...over,
      });
    const unit: Unit = { objectKey: "call2", country: "US" };

    // restThreshold −1: Bulk even for the empty `notNull` partition
    const init = mk();
    await new SfdcExtractor(
      { sfdc: init, store: new MemoryStateStore() },
      { restThreshold: -1 },
    ).extractUnit(unit, call2Plan());
    const initJobs = init.calls.filter((c) => c.method === "bulkQuery");
    expect(initJobs).toHaveLength(2); // one job per partition
    for (const j of initJobs)
      expect(j.args[1]).toMatchObject({ pkChunking: true });

    // delta windows are small: no chunking unless the count says otherwise
    const delta = mk();
    await new SfdcExtractor(
      { sfdc: delta, store: new MemoryStateStore() },
      { restThreshold: 0 },
    ).extractUnit(
      unit,
      call2Plan({
        mode: "delta",
        runId: "r2",
        window: { wmLo: "2020-01-01T00:00:00Z", wmHi: "2026-09-09T11:55:00Z" },
      }),
    );
    for (const j of delta.calls.filter((c) => c.method === "bulkQuery"))
      expect(j.args[1]).toMatchObject({ pkChunking: false });

    // the list is a configurable default
    const off = mk();
    await new SfdcExtractor(
      { sfdc: off, store: new MemoryStateStore() },
      { restThreshold: 0, pkChunkInitSources: [] },
    ).extractUnit(unit, call2Plan({ runId: "r3" }));
    for (const j of off.calls.filter((c) => c.method === "bulkQuery"))
      expect(j.args[1]).toMatchObject({ pkChunking: false });

    // scoped COUNT() above the threshold chunks any object
    const big = new FakeSfdcClient()
      .addDescribe(productDescribe())
      .addRows("Product_vod__c", productRows());
    await new SfdcExtractor(
      { sfdc: big, store: new MemoryStateStore() },
      { restThreshold: 0, pkChunkRowThreshold: 4 },
    ).extractUnit(
      { objectKey: "product", country: "GLOBAL" },
      plan({
        runId: "r4",
        mapping: productMapping(),
        target: makeTarget("product", productDescribe()),
      }),
    );
    expect(
      big.calls.find((c) => c.method === "bulkQuery")!.args[1],
    ).toMatchObject({ pkChunking: true });
  });

  it("delta: rows re-queried after the /updated/ cross-check join the ordered stream", async () => {
    runDir = await tmpRunDir();
    const describe = buildDescribe(
      "Multichannel_Consent_vod__c",
      [{ name: "Capture_Datetime_vod__c", type: "datetime" }],
      { keyPrefix: "a0M" },
    );
    const rows: SourceRow[] = [
      {
        Id: MC(3),
        Capture_Datetime_vod__c: "2025-03-01T00:00:00.000Z",
        SystemModstamp: "2026-09-05T00:00:00.000Z",
      },
      {
        Id: MC(1),
        Capture_Datetime_vod__c: "2025-01-01T00:00:00.000Z",
        SystemModstamp: "2026-09-05T00:00:00.000Z",
      },
      {
        Id: MC(2),
        Capture_Datetime_vod__c: "2025-02-01T00:00:00.000Z",
        SystemModstamp: "2026-09-05T00:00:00.000Z",
      },
    ];
    /**
     * A lagging index: COUNT() and the first window query both miss MC(1)
     * (consistent with each other, so the step 8 check passes) while the
     * /updated/ feed still reports it.
     */
    class SkippingSfdc extends FakeSfdcClient {
      lagging = true;
      async count(objectName: string, whereClause?: string) {
        const n = await super.count(objectName, whereClause);
        return this.lagging ? n - 1 : n;
      }
      async *query(
        soql: string,
        opts?: Parameters<FakeSfdcClient["query"]>[1],
      ) {
        for await (const r of super.query(soql, opts)) {
          if (this.lagging && r.Id === MC(1)) {
            this.lagging = false;
            continue;
          }
          yield r;
        }
      }
    }
    const sfdc = new SkippingSfdc()
      .addDescribe(describe)
      .addRows("Multichannel_Consent_vod__c", rows);
    const mapping = buildMaterialisedMapping({
      objectKey: "multichannel_consent",
      sourceObject: "Multichannel_Consent_vod__c",
      targetObject: "multichannel_consent__v",
      countryOf: parseCountryOf("global"),
      load: { noTriggers: true, orderBy: ["Capture_Datetime_vod__c", "Id"] },
      fields: [
        f("Id", "legacy_crm_id__v", "legacyId", "K"),
        f("Capture_Datetime_vod__c", "capture_datetime__v", "datetime", "Y"),
      ],
    });
    const ex = new SfdcExtractor({ sfdc, store: new MemoryStateStore() });
    const m = await ex.extractUnit(
      { objectKey: "multichannel_consent", country: "GLOBAL" },
      plan({
        mode: "delta",
        mapping,
        target: makeTarget("multichannel_consent", describe),
        window: { wmLo: "2026-09-01T00:00:00Z", wmHi: "2026-09-09T11:55:00Z" },
      }),
    );
    expect(m.findings).toMatchObject([
      { code: "DELTA_COUNT_MISMATCH", severity: "warning", count: 1 },
    ]);
    expect(sfdc.calls.some((c) => c.method === "queryIds")).toBe(true);
    expect(m.extractedLive).toBe(3);
    // the re-queried row is not appended after the ordered pages
    const got: string[] = [];
    for await (const { row } of ex.readRows(m.files)) got.push(row.Id);
    expect(got).toEqual([MC(1), MC(2), MC(3)]);
    expect(m.files.every((x) => x.path.includes("/sorted/"))).toBe(true);
  });

  it("load.orderBy over several id-set IN chunks: per-chunk ORDER BY is not a global order → external sort", async () => {
    runDir = await tmpRunDir();
    const describe = buildDescribe(
      "Call2_Detail_vod__c",
      [
        {
          name: "Call2_vod__c",
          type: "reference",
          referenceTo: ["Call2_vod__c"],
          relationshipName: "Call2_vod__r",
        },
        { name: "Seq_vod__c", type: "datetime" },
      ],
      { keyPrefix: "a0D", systemFields: { owner: false, name: "autoNumber" } },
    );
    // 401 parents → two IN chunks (400 + 1); the child of the 401st parent
    // has the smallest sort key, so concatenating the chunk results in
    // query order is NOT the global order
    const parents: Record<string, string> = {};
    const children: SourceRow[] = [];
    for (let i = 1; i <= 401; i++) {
      const pid = to18(`a0K${String(i).padStart(12, "0")}`);
      parents[pid] = `V${i}`;
      children.push({
        Id: to18(`a0D${String(i).padStart(12, "0")}`),
        Call2_vod__c: pid,
        Seq_vod__c: `2025-01-01T00:00:00.000Z`.replace(
          "00:00:00",
          i === 401 ? "00:00:00" : "00:00:01",
        ),
      });
    }
    const sfdc = new FakeSfdcClient()
      .addDescribe(describe)
      .addRows("Call2_Detail_vod__c", children);
    const store = new MemoryStateStore();
    await store.seedIdMap("call2", "call2__v", parents, "US");
    const mapping = buildMaterialisedMapping({
      objectKey: "call2_detail",
      sourceObject: "Call2_Detail_vod__c",
      targetObject: "call2_detail__v",
      countryOf: parseCountryOf("parent:call2:Call2_vod__c"),
      dependsOn: ["call2"],
      load: { noTriggers: true, orderBy: ["Seq_vod__c", "Id"] },
      fields: [
        f("Id", "legacy_crm_id__v", "legacyId", "K"),
        f("Call2_vod__c", "call2__v", "ref(call2)", "Y"),
        f("Seq_vod__c", "seq__v", "datetime"),
      ],
    });
    const ex = new SfdcExtractor(
      { sfdc, store },
      { parentCountryOf: () => undefined },
    );
    const m = await ex.extractUnit(
      { objectKey: "call2_detail", country: "US" },
      plan({ mapping, target: makeTarget("call2_detail", describe) }),
    );
    expect(m.countryStrategy).toBe("idSet");
    expect(sfdc.calls.filter((c) => c.method === "query")).toHaveLength(2);
    expect(m.extractedLive).toBe(401);
    expect(m.files.every((x) => x.path.includes("/sorted/"))).toBe(true);
    const got: string[] = [];
    for await (const { row } of ex.readRows(m.files)) got.push(row.Id);
    expect(got[0]).toBe(to18(`a0D${String(401).padStart(12, "0")}`));
    expect(got).toHaveLength(401);
  });
});
