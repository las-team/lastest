import { describe, expect, it } from "vitest";
import { FakeSfdcClient, parseSoql } from "./fake-sfdc";
import {
  IDS,
  sampleAccountDescribe,
  sampleAccountRows,
  sampleCall2Describe,
  sampleCall2Rows,
} from "./fixtures";

const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};

function client() {
  return new FakeSfdcClient({ bulkPageSize: 2 })
    .addDescribe(sampleAccountDescribe())
    .addRows("Account", sampleAccountRows())
    .addDescribe(sampleCall2Describe())
    .addRows("Call2_vod__c", sampleCall2Rows());
}

describe("FakeSfdcClient", () => {
  it("query excludes deleted rows, queryAll includes them", async () => {
    const c = client();
    expect(await collect(c.query("SELECT Id, Name FROM Account"))).toHaveLength(
      3,
    );
    expect(
      await collect(c.query("SELECT Id, Name FROM Account", { all: true })),
    ).toHaveLength(4);
    expect(await c.count("Account")).toBe(3);
  });
  it("evaluates the scope-style predicates the tool emits", async () => {
    const c = client();
    const soql = `SELECT Id, Status_vod__c FROM Call2_vod__c WHERE (Call_Date_vod__c >= 2024-09-07 OR Status_vod__c = 'Planned_vod') AND Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c IN ('US', 'DE') AND Parent_Call_vod__c = null ORDER BY Call_Date_vod__c DESC LIMIT 5`;
    const rows = await collect(c.query(soql));
    expect(rows.map((r) => r.Id)).toEqual([IDS.call1]);
    const attendees = await collect(
      c.query("SELECT Id FROM Call2_vod__c WHERE Parent_Call_vod__c != null"),
    );
    expect(attendees.map((r) => r.Id)).toEqual([IDS.call2]);
    const window = await collect(
      c.query(
        "SELECT Id FROM Call2_vod__c WHERE SystemModstamp >= 2025-01-01T00:00:00Z AND SystemModstamp < 2026-01-01T00:00:00Z",
      ),
    );
    expect(window).toHaveLength(1);
    expect(
      await collect(c.query("SELECT Id FROM Account WHERE Name LIKE 'Gen%'")),
    ).toHaveLength(1);
    expect(
      await collect(
        c.query(
          "SELECT Id FROM Account WHERE NOT Name = 'Jane Doe' AND IsPersonAccount = true",
        ),
      ),
    ).toHaveLength(1);
    expect(
      await collect(
        c.query(
          "SELECT Id FROM Account WHERE Id IN ('001000000000001AAA', '001000000000002AAA')",
        ),
      ),
    ).toHaveLength(2);
  });
  it("projects relationship columns and rejects unknown fields", async () => {
    const c = client();
    const [r] = await collect(
      c.query(
        "SELECT Id, Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c FROM Call2_vod__c LIMIT 1",
      ),
    );
    expect(r["Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c"]).toBe("US");
    await expect(
      collect(c.query("SELECT Id, Nope__c FROM Account")),
    ).rejects.toThrow(/INVALID_FIELD/);
    await expect(collect(c.query("SELECT Id FROM Nope__c"))).rejects.toThrow(
      /INVALID_TYPE/,
    );
    expect(
      parseSoql("SELECT COUNT() FROM Account WHERE Name = 'x'").count,
    ).toBe(true);
  });
  it("bulkQuery pages CSV with locators and supports resume", async () => {
    const c = client();
    const res = c.bulkQuery("SELECT Id, Name FROM Account", { all: true });
    const pages = await collect(res);
    expect(pages.map((p) => p.rows)).toEqual([2, 2]);
    expect(pages[0]).toMatchObject({
      pageNo: 0,
      locator: null,
      nextLocator: "loc-1",
    });
    expect(pages[1].nextLocator).toBeNull();
    expect(pages[0].csv.split("\n")[0]).toBe("Id,Name");
    expect((await res.job).state).toBe("JobComplete");
    const resumed = await collect(
      c.bulkQuery("SELECT Id, Name FROM Account", {
        all: true,
        resume: { jobId: pages[0].jobId, locator: "loc-1", pageNo: 1 },
      }),
    );
    expect(resumed).toHaveLength(1);
    expect(resumed[0].pageNo).toBe(1);
    const empty = await collect(
      c.bulkQuery("SELECT Id FROM Account WHERE Name = 'zzz'"),
    );
    expect(empty).toHaveLength(1);
    expect(empty[0].rows).toBe(0);
  });
  it("queryIds, deleted/updated feeds and the replicateable guard", async () => {
    const c = client();
    const rows = await collect(
      c.queryIds("Account", ["001000000000001", IDS.account2], ["Name"]),
    );
    expect(rows.map((r) => r.Name).sort()).toEqual([
      "General Hospital",
      "Jane Doe",
    ]);
    c.deleteRow("Account", IDS.account3, "2025-05-01T00:00:00.000Z");
    const del = await c.getDeleted(
      "Account",
      "2025-04-01T00:00:00.000Z",
      "2025-06-01T00:00:00.000Z",
    );
    expect(del.deletedRecords).toEqual([
      { id: IDS.account3, deletedDate: "2025-05-01T00:00:00.000Z" },
    ]);
    expect(del.latestDateCovered).toBe("2025-06-01T00:00:00.000Z");
    const upd = await c.getUpdated(
      "Account",
      "2025-01-01T00:00:00.000Z",
      "2025-02-01T00:00:00.000Z",
    );
    expect(upd.ids).toEqual([IDS.account1]);
    c.addDescribe({
      ...sampleAccountDescribe(),
      name: "UserTerritory2Association",
      replicateable: false,
    });
    await expect(
      c.getDeleted(
        "UserTerritory2Association",
        "2025-01-01T00:00:00Z",
        "2025-02-01T00:00:00Z",
      ),
    ).rejects.toThrow(/not replicable/);
    expect((await c.limits()).DailyApiRequests.Remaining).toBeGreaterThan(0);
    expect(c.calls.map((x) => x.method)).toContain("getDeleted");
  });
  it("failNext injects one transport error then recovers", async () => {
    const c = client();
    c.failNext = {
      method: "limits",
      error: Object.assign(new Error("REQUEST_LIMIT_EXCEEDED"), {
        status: 429,
      }),
      remaining: 1,
    };
    await expect(c.limits()).rejects.toThrow(/REQUEST_LIMIT_EXCEEDED/);
    await expect(c.limits()).resolves.toBeTruthy();
  });
});
