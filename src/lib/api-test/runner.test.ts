import { describe, it, expect } from "vitest";
import { evaluateApiAssertions, resolveApiUrl, valueMatches } from "./runner";
import type { ApiResponseSnapshot } from "./types";
import type { ApiTestDefinition } from "@/lib/db/schema";

const baseRes: ApiResponseSnapshot = {
  statusCode: 200,
  headers: { "content-type": "application/json" },
  json: { data: { id: 42, name: "ok" }, items: [{ id: 1 }] },
  rawText: '{"data":{"id":42,"name":"ok"},"items":[{"id":1}]}',
  latencyMs: 120,
};

describe("evaluateApiAssertions", () => {
  it("passes a status assertion with `in`", () => {
    const [r] = evaluateApiAssertions(
      [{ kind: "status", in: [200, 201] }],
      baseRes,
    );
    expect(r.passed).toBe(true);
  });

  it("fails a status assertion with `equals`", () => {
    const [r] = evaluateApiAssertions(
      [{ kind: "status", equals: 404 }],
      baseRes,
    );
    expect(r.passed).toBe(false);
    expect(r.actual).toBe(200);
  });

  it('treats a bare status assertion (no equals/in) as "any 2xx"', () => {
    expect(evaluateApiAssertions([{ kind: "status" }], baseRes)[0].passed).toBe(
      true,
    );
    const non2xx = { ...baseRes, statusCode: 500 };
    expect(evaluateApiAssertions([{ kind: "status" }], non2xx)[0].passed).toBe(
      false,
    );
  });

  it("evaluates jsonPath including array indices (loose-equal)", () => {
    const ok = evaluateApiAssertions(
      [{ kind: "jsonPath", path: "data.id", value: 42 }],
      baseRes,
    )[0];
    const arr = evaluateApiAssertions(
      [{ kind: "jsonPath", path: "items.0.id", value: "1" }],
      baseRes,
    )[0];
    const miss = evaluateApiAssertions(
      [{ kind: "jsonPath", path: "data.missing", value: "x" }],
      baseRes,
    )[0];
    expect(ok.passed).toBe(true);
    expect(arr.passed).toBe(true);
    expect(miss.passed).toBe(false);
  });

  it("validates a jsonSchema", () => {
    const schema = {
      type: "object",
      required: ["data"],
      properties: { data: { type: "object" } },
    };
    const ok = evaluateApiAssertions(
      [{ kind: "jsonSchema", schema }],
      baseRes,
    )[0];
    const bad = evaluateApiAssertions(
      [{ kind: "jsonSchema", schema: { type: "array" } }],
      baseRes,
    )[0];
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });

  it("checks header presence/value, bodyContains and latency", () => {
    expect(
      evaluateApiAssertions(
        [{ kind: "header", header: "Content-Type", value: "application/json" }],
        baseRes,
      )[0].passed,
    ).toBe(true);
    expect(
      evaluateApiAssertions(
        [{ kind: "bodyContains", value: '"id":42' }],
        baseRes,
      )[0].passed,
    ).toBe(true);
    expect(
      evaluateApiAssertions([{ kind: "latencyMs", maxMs: 100 }], baseRes)[0]
        .passed,
    ).toBe(false);
    expect(
      evaluateApiAssertions([{ kind: "latencyMs", maxMs: 500 }], baseRes)[0]
        .passed,
    ).toBe(true);
  });

  it("type-aware compare: numeric expected matches numeric string, not garbage", () => {
    const res: ApiResponseSnapshot = {
      ...baseRes,
      json: { code: "200", flag: "true", n: 7 },
    };
    // expected number 200 vs actual string "200" → match (declared numeric)
    expect(
      evaluateApiAssertions(
        [{ kind: "jsonPath", path: "code", value: 200 }],
        res,
      )[0].passed,
    ).toBe(true);
    // expected number vs non-numeric string → no match
    expect(
      evaluateApiAssertions(
        [{ kind: "jsonPath", path: "flag", value: 1 }],
        res,
      )[0].passed,
    ).toBe(false);
  });

  it("type-aware compare: boolean expected never matches a string", () => {
    const res: ApiResponseSnapshot = { ...baseRes, json: { flag: "true" } };
    // The old looseEquals bug: true == "true". Now it must NOT match.
    expect(
      evaluateApiAssertions(
        [{ kind: "jsonPath", path: "flag", value: true }],
        res,
      )[0].passed,
    ).toBe(false);
    const res2: ApiResponseSnapshot = { ...baseRes, json: { flag: true } };
    expect(
      evaluateApiAssertions(
        [{ kind: "jsonPath", path: "flag", value: true }],
        res2,
      )[0].passed,
    ).toBe(true);
  });

  it("strict mode requires an exact same-type match", () => {
    const res: ApiResponseSnapshot = { ...baseRes, json: { code: "200" } };
    expect(
      evaluateApiAssertions(
        [{ kind: "jsonPath", path: "code", value: 200, strict: true }],
        res,
      )[0].passed,
    ).toBe(false);
    expect(
      evaluateApiAssertions(
        [{ kind: "jsonPath", path: "code", value: "200", strict: true }],
        res,
      )[0].passed,
    ).toBe(true);
  });
});

describe("valueMatches", () => {
  it("string expected coerces primitive actuals", () => {
    expect(valueMatches("123", 123)).toBe(true);
    expect(valueMatches("true", true)).toBe(true);
    expect(valueMatches("x", { a: 1 })).toBe(false);
  });
  it("strict disables all coercion", () => {
    expect(valueMatches(200, "200", true)).toBe(false);
    expect(valueMatches(200, 200, true)).toBe(true);
  });
});

describe("resolveApiUrl", () => {
  const def = (
    url: string,
    query?: Record<string, string>,
  ): ApiTestDefinition => ({ method: "GET", url, assertions: [], query });

  it("keeps absolute URLs and joins relative paths to baseUrl", () => {
    expect(resolveApiUrl(def("https://api.example.com/v1/x"))).toBe(
      "https://api.example.com/v1/x",
    );
    expect(resolveApiUrl(def("/api/users"), "https://app.test")).toBe(
      "https://app.test/api/users",
    );
    expect(resolveApiUrl(def("api/users"), "https://app.test/")).toBe(
      "https://app.test/api/users",
    );
  });

  it("appends query params", () => {
    expect(
      resolveApiUrl(def("/s", { q: "hi", n: "2" }), "https://app.test"),
    ).toBe("https://app.test/s?q=hi&n=2");
  });
});
