import { describe, expect, it } from "vitest";
import { API, authRoutes, makeTestClient } from "./test-support";
import {
  chunkIn,
  normalisePicklistArrays,
  picklistFieldsFromDescribe,
  vqlContains,
  vqlDate,
  vqlDateTime,
  vqlIn,
  vqlInClauses,
  vqlString,
  vqlValue,
  withPageSizeZero,
} from "./vql";

describe("VQL literal helpers (§2.5.5)", () => {
  it("quotes strings and escapes ' and \\ with a backslash", () => {
    expect(vqlString("O'Brien")).toBe("'O\\'Brien'");
    expect(vqlString("a\\b")).toBe("'a\\\\b'");
    expect(vqlString("")).toBe("''");
  });

  it("formats scalars", () => {
    expect(vqlValue(null)).toBe("null");
    expect(vqlValue(true)).toBe("true");
    expect(vqlValue(12.5)).toBe("12.5");
    expect(vqlValue("x")).toBe("'x'");
    expect(vqlValue(new Date("2025-03-04T05:06:07.089Z"))).toBe(
      "'2025-03-04T05:06:07.089Z'",
    );
    expect(() => vqlValue(Number.NaN)).toThrow(/Non-finite/);
  });

  it("formats dates and datetimes in UTC", () => {
    expect(vqlDate(new Date("2025-03-04T23:59:59Z"))).toBe("'2025-03-04'");
    expect(vqlDate("2025-03-04T23:59:59.000Z")).toBe("'2025-03-04'");
    expect(vqlDateTime("2025-03-04T05:06:07Z")).toBe(
      "'2025-03-04T05:06:07.000Z'",
    );
    expect(() => vqlDateTime("not a date")).toThrow(/Invalid datetime/);
  });

  it("chunks IN lists at 500 and deduplicates", () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `id${i}`);
    expect(chunkIn(ids).map((c) => c.length)).toEqual([500, 500, 1]);
    expect(() => vqlIn(ids)).toThrow(/max 500/);
    const clauses = vqlInClauses("legacy_crm_id__v", [...ids, "id0", "id1"]);
    expect(clauses).toHaveLength(3);
    expect(clauses[0].startsWith("legacy_crm_id__v IN ('id0','id1',")).toBe(
      true,
    );
    expect(clauses[2]).toBe("legacy_crm_id__v IN ('id1000')");
    expect(vqlInClauses("f", ["a", "b", "c"], 2)).toEqual([
      "f IN ('a','b')",
      "f IN ('c')",
    ]);
    expect(vqlContains(["a__v", "b__v"])).toBe("CONTAINS ('a__v','b__v')");
  });

  it("rewrites trailing paging clauses to PAGESIZE 0", () => {
    expect(withPageSizeZero("SELECT id FROM account__v")).toBe(
      "SELECT id FROM account__v PAGESIZE 0",
    );
    expect(withPageSizeZero("SELECT id FROM account__v LIMIT 100")).toBe(
      "SELECT id FROM account__v PAGESIZE 0",
    );
    expect(
      withPageSizeZero(
        "SELECT id FROM a__v WHERE x = 'y' PAGESIZE 1000 SKIP 2000 ",
      ),
    ).toBe("SELECT id FROM a__v WHERE x = 'y' PAGESIZE 0");
  });

  it("normalises picklist columns to arrays", () => {
    const pl = picklistFieldsFromDescribe({
      fields: [
        { name: "status__v", type: "picklist" },
        { name: "name__v", type: "String" },
      ],
    });
    expect([...pl]).toEqual(["status__v"]);
    expect(
      normalisePicklistArrays({ status__v: "active__v", name__v: "x" }, pl),
    ).toEqual({ status__v: ["active__v"], name__v: "x" });
    expect(normalisePicklistArrays({ status__v: "a__v,b__v" }, pl)).toEqual({
      status__v: ["a__v", "b__v"],
    });
    expect(normalisePicklistArrays({ status__v: null }, pl)).toEqual({
      status__v: null,
    });
    const row = { status__v: ["active__v"] };
    expect(normalisePicklistArrays(row, pl)).toBe(row); // untouched → same object
  });
});

describe("vql paging (POST next_page)", () => {
  const q = "SELECT id, status__v, name__v FROM account__v";

  it("posts q= as a form, asks for the describe, normalises picklists and follows next_page with POST", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/query`,
        body: {
          responseStatus: "SUCCESS",
          responseDetails: {
            pagesize: 2,
            pageoffset: 0,
            size: 2,
            total: 3,
            next_page: `${API}/query/uuid-1?pagesize=2&pageoffset=2`,
          },
          queryDescribe: {
            object: { name: "account__v" },
            fields: [
              { name: "id", type: "id" },
              { name: "status__v", type: "Picklist" },
              { name: "name__v", type: "String" },
            ],
          },
          data: [
            { id: "V01", status__v: ["active__v"], name__v: "A" },
            { id: "V02", status__v: "inactive__v", name__v: "B" },
          ],
        },
      },
      {
        method: "POST",
        path: `${API}/query/uuid-1`,
        body: {
          responseStatus: "SUCCESS",
          responseDetails: {
            pagesize: 2,
            pageoffset: 2,
            size: 1,
            total: 3,
            previous_page: `${API}/query/uuid-1?pagesize=2&pageoffset=0`,
          },
          data: [{ id: "V03", status__v: null, name__v: "C" }],
        },
      },
    ]);
    await t.client.authenticate();
    const pages = [];
    for await (const p of t.client.vql(q)) pages.push(p);
    expect(pages).toHaveLength(2);
    expect(pages[0].data).toEqual([
      { id: "V01", status__v: ["active__v"], name__v: "A" },
      { id: "V02", status__v: ["inactive__v"], name__v: "B" },
    ]);
    expect(pages[0].responseDetails.total).toBe(3);
    expect(pages[1].data).toEqual([
      { id: "V03", status__v: null, name__v: "C" },
    ]);
    expect(pages[1].responseDetails.next_page).toBeUndefined();

    const first = t.fetch.calls.find((c) => c.pathname === `${API}/query`)!;
    expect(first.method).toBe("POST");
    expect(first.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(first.form?.get("q")).toBe(q);
    expect(first.headers["x-vaultapi-describequery"]).toBe("true");
    const next = t.fetch.calls.find(
      (c) => c.pathname === `${API}/query/uuid-1`,
    )!;
    expect(next.method).toBe("POST");
    expect(next.search.get("pageoffset")).toBe("2");
    expect(next.headers["x-vaultapi-describequery"]).toBeUndefined();
    expect(next.headers.authorization).toBe("SESSION-1");
  });

  it("vqlRows flattens pages", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/query`,
        body: {
          responseStatus: "SUCCESS",
          responseDetails: { pagesize: 1000, pageoffset: 0, size: 2, total: 2 },
          data: [{ id: "1" }, { id: "2" }],
        },
      },
    ]);
    await t.client.authenticate();
    const rows = [];
    for await (const r of t.client.vqlRows(q)) rows.push(r);
    expect(rows).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("vqlCount sends PAGESIZE 0 and returns responseDetails.total", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/query`,
        body: {
          responseStatus: "SUCCESS",
          responseDetails: { pagesize: 0, pageoffset: 0, size: 0, total: 4321 },
          data: [],
        },
      },
    ]);
    await t.client.authenticate();
    await expect(t.client.vqlCount(`${q} LIMIT 10`)).resolves.toBe(4321);
    expect(t.fetch.calls.at(-1)?.form?.get("q")).toBe(`${q} PAGESIZE 0`);
  });

  it("surfaces INVALID_FILTER as a structural VaultApiError", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/query`,
        body: {
          responseStatus: "FAILURE",
          errors: [{ type: "INVALID_FILTER", message: "bad" }],
        },
      },
    ]);
    await t.client.authenticate();
    const it = t.client.vql(q)[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toMatchObject({
      type: "INVALID_FILTER",
      errorClass: "structural",
    });
  });
});
