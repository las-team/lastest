import { describe, expect, it } from "vitest";
import {
  FakeSfdcClient,
  IDS,
  MemoryStateStore,
  buildDescribe,
  sampleCall2Describe,
  sampleCall2Rows,
} from "../testkit";
import { to18 } from "../transform/ids";
import {
  checkDeleteWindow,
  collectParentChangeFanOut,
  crossCheckUpdated,
  detectUndeletes,
  fetchDeletedFeed,
  keySetReconcile,
  planDeltaWindow,
  routeDeletes,
  windowPredicate,
  type DeletedRow,
} from "./delta";

const NOW = "2026-09-09T12:00:00.000Z";

describe("planDeltaWindow (§4.1)", () => {
  it("wm_lo = watermark − overlap, wm_hi = sfdc_now − safety lag, unquoted literals", () => {
    const w = planDeltaWindow({
      mode: "delta",
      watermark: {
        value: "2026-09-01T10:00:00.000Z",
        cutoffDate: "2024-09-09",
      },
      sfdcNow: NOW,
      cutoffDate: "2024-09-09",
    });
    expect(w).toMatchObject({
      wmLo: "2026-09-01T09:50:00Z",
      wmHi: "2026-09-09T11:55:00Z",
      predicate:
        "SystemModstamp >= 2026-09-01T09:50:00Z AND SystemModstamp < 2026-09-09T11:55:00Z",
      reextract: false,
      findings: [],
    });
    expect(w.predicate).not.toMatch(/'/);
  });

  it("final-delta caps wm_hi at freezeAt", () => {
    const w = planDeltaWindow({
      mode: "final-delta",
      watermark: { value: "2026-09-01T10:00:00Z" },
      sfdcNow: NOW,
      freezeAt: "2026-09-09T08:00:00Z",
    });
    expect(w.wmHi).toBe("2026-09-09T08:00:00Z");
    // a freeze later than now − lag does not move wm_hi forward
    const w2 = planDeltaWindow({
      mode: "final-delta",
      watermark: { value: "2026-09-01T10:00:00Z" },
      sfdcNow: NOW,
      freezeAt: "2026-09-10T00:00:00Z",
    });
    expect(w2.wmHi).toBe("2026-09-09T11:55:00Z");
  });

  it("first delta of a unit and init have no lower bound", () => {
    const first = planDeltaWindow({ mode: "delta", sfdcNow: NOW });
    expect(first.wmLo).toBeUndefined();
    expect(first.predicate).toBe("SystemModstamp < 2026-09-09T11:55:00Z");
    const init = planDeltaWindow({
      mode: "init",
      sfdcNow: NOW,
      overlapMinutes: 15,
      safetyLagMinutes: 0,
    });
    expect(init).toMatchObject({
      wmHi: "2026-09-09T12:00:00Z",
      reextract: false,
    });
    expect(init.predicate).toBeUndefined();
  });

  it("a wider cutoff forces a full re-extract (SCOPE_CUTOFF_CHANGED); a narrower one only warns", () => {
    const wider = planDeltaWindow({
      mode: "delta",
      watermark: { value: "2026-09-01T10:00:00Z", cutoffDate: "2024-09-09" },
      sfdcNow: NOW,
      cutoffDate: "2023-09-09",
      objectKey: "sample_transaction",
      country: "US",
    });
    expect(wider.reextract).toBe(true);
    expect(wider.wmLo).toBeUndefined();
    expect(wider.findings).toMatchObject([
      {
        severity: "warning",
        code: "SCOPE_CUTOFF_CHANGED",
        objectKey: "sample_transaction",
        country: "US",
      },
    ]);
    const narrower = planDeltaWindow({
      mode: "delta",
      watermark: { value: "2026-09-01T10:00:00Z", cutoffDate: "2024-09-09" },
      sfdcNow: NOW,
      cutoffDate: "2025-01-01",
    });
    expect(narrower.reextract).toBe(false);
    expect(narrower.wmLo).toBe("2026-09-01T09:50:00Z");
    expect(narrower.findings[0].code).toBe("SCOPE_CUTOFF_CHANGED");
  });

  it("validates the overlap range (5–15)", () => {
    expect(() =>
      planDeltaWindow({ mode: "delta", sfdcNow: NOW, overlapMinutes: 3 }),
    ).toThrow(/5–15/);
    expect(() => planDeltaWindow({ mode: "delta", sfdcNow: "nope" })).toThrow(
      /Invalid datetime/,
    );
  });

  it("windowPredicate renders a plan window without fractional seconds", () => {
    expect(
      windowPredicate({
        wmLo: "2026-09-01T09:50:00.123Z",
        wmHi: "2026-09-09T11:55:00.000Z",
      }),
    ).toBe(
      "SystemModstamp >= 2026-09-01T09:50:00Z AND SystemModstamp < 2026-09-09T11:55:00Z",
    );
  });
});

describe("delete sources (§4.4)", () => {
  it("checkDeleteWindow blocks delta beyond 30 days, warns otherwise", () => {
    expect(
      checkDeleteWindow(
        "2026-09-01T00:00:00Z",
        "2026-09-09T00:00:00Z",
        "delta",
      ),
    ).toEqual([]);
    expect(
      checkDeleteWindow(
        "2026-07-01T00:00:00Z",
        "2026-09-09T00:00:00Z",
        "delta",
        { objectKey: "call2", country: "US" },
      ),
    ).toMatchObject([
      {
        severity: "blocking",
        code: "DELETE_WINDOW_EXCEEDED",
        objectKey: "call2",
        country: "US",
      },
    ]);
    expect(
      checkDeleteWindow(
        "2026-07-01T00:00:00Z",
        "2026-09-09T00:00:00Z",
        "verify",
      )[0].severity,
    ).toBe("warning");
    expect(
      checkDeleteWindow(undefined, "2026-09-09T00:00:00Z", "delta"),
    ).toEqual([]);
  });

  it("fetchDeletedFeed normalises ids and reports latestDateCovered", async () => {
    const sfdc = new FakeSfdcClient().addDescribe(sampleCall2Describe());
    sfdc.addDeleted(
      "Call2_vod__c",
      "a0K000000000009",
      "2026-09-05T00:00:00.000Z",
    );
    const r = await fetchDeletedFeed(
      sfdc,
      "Call2_vod__c",
      "2026-09-01T00:00:00Z",
      "2026-09-09T00:00:00Z",
    );
    expect(r.rows).toEqual([
      {
        id: to18("a0K000000000009"),
        deletedDate: "2026-09-05T00:00:00.000Z",
        source: "feed",
      },
    ]);
    expect(r.latestDateCovered).toBe("2026-09-09T00:00:00Z");
  });

  it("keySetReconcile routes id-map rows missing from the source as deleted at wm_hi", async () => {
    const sfdc = new FakeSfdcClient()
      .addDescribe(sampleCall2Describe())
      .addRows("Call2_vod__c", sampleCall2Rows());
    const store = new MemoryStateStore();
    const gone = to18("a0K000000000077");
    await store.seedIdMap(
      "call2",
      "call2__v",
      { [IDS.call1]: "V1", [gone]: "V2" },
      "US",
    );
    await store.seedIdMap(
      "call2",
      "call2__v",
      { [to18("a0K000000000088")]: "V3" },
      "DE",
    );
    const r = await keySetReconcile(
      sfdc,
      store,
      { objectKey: "call2", country: "US" },
      "Call2_vod__c",
      "2026-09-09T11:55:00Z",
    );
    expect(r).toEqual([
      { id: gone, deletedDate: "2026-09-09T11:55:00Z", source: "keySet" },
    ]);
    const soql = sfdc.calls.find((c) => c.method === "query")
      ?.args[0] as string;
    expect(soql).toBe("SELECT Id FROM Call2_vod__c");
  });

  it("keySetReconcile applies the country predicate", async () => {
    const sfdc = new FakeSfdcClient()
      .addDescribe(sampleCall2Describe())
      .addRows("Call2_vod__c", sampleCall2Rows());
    const store = new MemoryStateStore();
    await keySetReconcile(
      sfdc,
      store,
      { objectKey: "call2", country: "US" },
      "Call2_vod__c",
      "2026-09-09T11:55:00Z",
      "(Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c = 'US')",
    );
    const soql = sfdc.calls.find((c) => c.method === "query")
      ?.args[0] as string;
    expect(soql).toBe(
      "SELECT Id FROM Call2_vod__c WHERE (Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c = 'US')",
    );
  });
});

describe("routeDeletes (§4.3 step 5, last-wins)", () => {
  const A = to18("a0K000000000001");
  const B = to18("a0K000000000002");
  const C = to18("a0K000000000003");
  const deleted: DeletedRow[] = [
    {
      id: "a0K000000000001",
      deletedDate: "2026-09-05T00:00:00Z",
      source: "feed",
    },
    {
      id: A,
      deletedDate: "2026-09-06T00:00:00Z",
      source: "queryAll",
      masterRecordId: C,
    },
    { id: B, deletedDate: "2026-09-05T00:00:00Z", source: "queryAll" },
    { id: C, deletedDate: "2026-09-02T00:00:00Z", source: "keySet" },
  ];
  const live = new Map([[B, "2026-09-07T00:00:00Z"]]); // B updated after its delete → undelete wins

  it("dedupes by id (latest deletedDate, master kept), supersedes by a later modstamp, applies per policy", () => {
    const r = routeDeletes(deleted, "delete", live);
    expect(r.action).toBe("delete");
    expect(r.apply).toEqual([
      {
        id: A,
        deletedDate: "2026-09-06T00:00:00Z",
        source: "queryAll",
        masterRecordId: C,
      },
      { id: C, deletedDate: "2026-09-02T00:00:00Z", source: "keySet" },
    ]);
    expect(r.superseded.map((d) => d.id)).toEqual([B]);
    expect(r.ignored).toEqual([]);
  });

  it("policy ignore lists rows for the report only", () => {
    const r = routeDeletes(deleted, "ignore", live);
    expect(r.apply).toEqual([]);
    expect(r.ignored.map((d) => d.id)).toEqual([A, C]);
    expect(routeDeletes(deleted, "inactivate").action).toBe("inactivate");
    expect(routeDeletes(deleted, "inactivate").apply).toHaveLength(3);
  });
});

describe("id-map assisted checks", () => {
  it("detectUndeletes finds live ids previously marked deleted", async () => {
    const store = new MemoryStateStore();
    await store.seedIdMap(
      "call2",
      "call2__v",
      { [IDS.call1]: "V1", [IDS.call2]: "V2" },
      "US",
    );
    await store.idMap.markDeleted("call2", IDS.call1, "2026-09-01T00:00:00Z");
    expect(
      await detectUndeletes(store, "call2", [IDS.call1, IDS.call2, IDS.call3]),
    ).toEqual([IDS.call1]);
  });

  it("collectParentChangeFanOut lists children from fk_index (§4.2)", async () => {
    const store = new MemoryStateStore();
    await store.fkIndex.put([
      {
        objectKey: "call2",
        sfdcId: IDS.call1,
        field: "Account_vod__c",
        targetObjectKey: "account",
        targetSfdcId: IDS.account1,
        runId: "r1",
      },
      {
        objectKey: "address",
        sfdcId: to18("a0A000000000001"),
        field: "Account_vod__c",
        targetObjectKey: "account",
        targetSfdcId: IDS.account1,
        runId: "r1",
      },
      {
        objectKey: "call2",
        sfdcId: IDS.call2,
        field: "Account_vod__c",
        targetObjectKey: "account",
        targetSfdcId: IDS.account2,
        runId: "r1",
      },
    ]);
    const children = await collectParentChangeFanOut(store, "account", [
      IDS.account1,
      IDS.account1,
    ]);
    expect(children.map((c) => `${c.objectKey}:${c.sfdcId}`).sort()).toEqual([
      `address:${to18("a0A000000000001")}`,
      `call2:${IDS.call1}`,
    ]);
  });

  it("crossCheckUpdated: exact units warn on shortfall, scoped units only inform", async () => {
    const sfdc = new FakeSfdcClient()
      .addDescribe(buildDescribe("User", []))
      .addRows("User", [
        {
          Id: "005000000000001AAA",
          SystemModstamp: "2026-09-05T00:00:00.000Z",
        },
        {
          Id: "005000000000002AAA",
          SystemModstamp: "2026-09-06T00:00:00.000Z",
        },
      ]);
    const window = {
      wmLo: "2026-09-01T00:00:00Z",
      wmHi: "2026-09-09T00:00:00Z",
    };
    const unit = { objectKey: "user" as const, country: "GLOBAL" };
    const exact = await crossCheckUpdated(
      sfdc,
      "User",
      window,
      new Set(["005000000000001AAA"]),
      unit,
      true,
    );
    expect(exact.missing).toEqual(["005000000000002AAA"]);
    expect(exact.findings).toMatchObject([
      { severity: "warning", code: "DELTA_COUNT_MISMATCH", count: 1 },
    ]);
    const loose = await crossCheckUpdated(
      sfdc,
      "User",
      window,
      new Set(),
      unit,
      false,
    );
    expect(loose.findings).toMatchObject([
      { severity: "info", code: "DELTA_UPDATED_UNSEEN", count: 2 },
    ]);
    const none = await crossCheckUpdated(
      sfdc,
      "User",
      { wmHi: window.wmHi },
      new Set(),
      unit,
      true,
    );
    expect(none.findings).toEqual([]);
  });
});
