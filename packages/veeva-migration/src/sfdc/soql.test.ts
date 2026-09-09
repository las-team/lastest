import { describe, expect, it } from "vitest";
import { to18 } from "../transform/ids";
import {
  andPredicates,
  buildCount,
  buildSelect,
  chunkValues,
  escapeSoqlString,
  fieldList,
  inClause,
  inClauses,
  objectOfSoql,
  soqlDate,
  soqlDateTime,
  soqlLiteral,
  soqlString,
} from "./soql";

describe("soql literals", () => {
  it("escapes quotes, backslashes and control characters", () => {
    expect(escapeSoqlString("O'Brien")).toBe("O\\'Brien");
    expect(escapeSoqlString("a\\b")).toBe("a\\\\b");
    expect(escapeSoqlString('say "hi"\nnow\tthen\r')).toBe(
      'say \\"hi\\"\\nnow\\tthen\\r',
    );
    expect(soqlString("it's")).toBe("'it\\'s'");
    // an injection attempt stays inside the literal
    expect(soqlString("x' OR Name != '")).toBe("'x\\' OR Name != \\''");
  });

  it("renders datetime literals without fractional seconds and dates as YYYY-MM-DD", () => {
    const d = new Date("2025-03-04T10:11:12.345Z");
    expect(soqlDateTime(d)).toBe("2025-03-04T10:11:12Z");
    expect(soqlDateTime("2025-03-04T10:11:12.000Z")).toBe(
      "2025-03-04T10:11:12Z",
    );
    expect(soqlDate(d)).toBe("2025-03-04");
    expect(() => soqlDateTime("not a date")).toThrow(TypeError);
  });

  it("renders scalar literals", () => {
    expect(soqlLiteral(null)).toBe("null");
    expect(soqlLiteral(true)).toBe("true");
    expect(soqlLiteral(12.5)).toBe("12.5");
    expect(soqlLiteral("s")).toBe("'s'");
    expect(soqlLiteral(new Date("2025-01-01T00:00:00Z"))).toBe(
      "2025-01-01T00:00:00Z",
    );
    expect(() => soqlLiteral(Number.NaN)).toThrow(TypeError);
  });
});

describe("IN-list chunking", () => {
  it("chunks to at most 400 by default and dedupes", () => {
    const ids = Array.from({ length: 1001 }, (_, i) =>
      to18(`a0K${String(i).padStart(12, "0")}`),
    );
    const clauses = inClauses("Id", [...ids, ids[0], ids[1]]);
    expect(clauses).toHaveLength(3);
    expect(clauses[0].startsWith("Id IN ('")).toBe(true);
    expect(clauses[0].split(",").length).toBe(400);
    expect(clauses[2].split(",").length).toBe(201);
    expect(chunkValues([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => chunkValues([1], 0)).toThrow(RangeError);
  });

  it("inClause dedupes and refuses empty lists", () => {
    expect(inClause("Id", ["a", "a", "b"])).toBe("Id IN ('a','b')");
    expect(() => inClause("Id", [])).toThrow(RangeError);
  });
});

describe("select / count builders", () => {
  it("builds a SELECT with a deduped field list, WHERE, ORDER BY and LIMIT", () => {
    const soql = buildSelect({
      object: "Call2_vod__c",
      columns: ["Id", "Name", "id", " Account_vod__r.Name ", ""],
      where: ["IsDeleted = false", "Call_Date_vod__c >= 2024-01-01"],
      orderBy: "SystemModstamp ASC",
      limit: 10,
    });
    expect(soql).toBe(
      "SELECT Id, Name, Account_vod__r.Name FROM Call2_vod__c WHERE (IsDeleted = false) AND (Call_Date_vod__c >= 2024-01-01) ORDER BY SystemModstamp ASC LIMIT 10",
    );
  });

  it("rejects bad object names, field paths and empty field lists", () => {
    expect(() => buildSelect({ object: "Bad Name", columns: ["Id"] })).toThrow(
      TypeError,
    );
    expect(() =>
      buildSelect({ object: "Account", columns: ["Id; DROP"] }),
    ).toThrow(TypeError);
    expect(() => fieldList(["", " "])).toThrow(RangeError);
    expect(() =>
      buildSelect({ object: "Account", columns: ["Id"], limit: -1 }),
    ).toThrow(RangeError);
  });

  it("builds COUNT() and AND-combines predicates", () => {
    expect(buildCount("Account")).toBe("SELECT COUNT() FROM Account");
    expect(buildCount("Account", "Country_vod__c = 'US'")).toBe(
      "SELECT COUNT() FROM Account WHERE Country_vod__c = 'US'",
    );
    expect(andPredicates(undefined, "a = 1", null, " ", "b = 2")).toBe(
      "(a = 1) AND (b = 2)",
    );
    expect(andPredicates("a = 1")).toBe("a = 1");
    expect(andPredicates()).toBeUndefined();
  });

  it("extracts the object of a SOQL statement", () => {
    expect(objectOfSoql("SELECT Id FROM Call2_vod__c WHERE x = 1")).toBe(
      "Call2_vod__c",
    );
    expect(objectOfSoql("select id from Account")).toBe("Account");
    expect(objectOfSoql("nonsense")).toBeUndefined();
  });
});
