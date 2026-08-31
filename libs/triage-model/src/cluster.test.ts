import { describe, expect, it } from "vitest";

import {
  clusterDeterministically,
  mergeRegions,
  normalizeErrorSignature,
  type TriageCandidate,
} from "./cluster";

function candidate(
  over: Partial<TriageCandidate> & { id: string },
): TriageCandidate {
  return {
    testId: `test-${over.id}`,
    status: "failed",
    ...over,
  };
}

describe("normalizeErrorSignature", () => {
  it("collapses volatile numbers, literals and urls", () => {
    expect(
      normalizeErrorSignature('Expected "4 items" at https://a.test/x?y=1'),
    ).toBe("expected <str> at <url>");
  });

  it("makes two differently-numbered assertions identical", () => {
    expect(normalizeErrorSignature("expected 4 got 5")).toBe(
      normalizeErrorSignature("expected 71 got 92"),
    );
  });

  it("keeps genuinely different messages apart", () => {
    expect(normalizeErrorSignature("timeout waiting for selector")).not.toBe(
      normalizeErrorSignature("navigation failed"),
    );
  });
});

describe("mergeRegions", () => {
  it("merges overlapping boxes transitively into one bounding box", () => {
    expect(
      mergeRegions([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 5, width: 10, height: 10 },
        { x: 12, y: 12, width: 4, height: 4 },
      ]),
    ).toEqual([{ x: 0, y: 0, width: 16, height: 16 }]);
  });

  it("leaves disjoint boxes alone, sorted top-left first", () => {
    expect(
      mergeRegions([
        { x: 0, y: 90, width: 5, height: 5 },
        { x: 0, y: 0, width: 5, height: 5 },
      ]),
    ).toEqual([
      { x: 0, y: 0, width: 5, height: 5 },
      { x: 0, y: 90, width: 5, height: 5 },
    ]);
  });
});

describe("clusterDeterministically", () => {
  it("returns nothing for an empty input", () => {
    expect(clusterDeterministically([])).toEqual({ groups: [], ungrouped: [] });
  });

  it("groups by identical error signature first", () => {
    const result = clusterDeterministically([
      candidate({
        id: "a",
        errorMessage: "expected 4 got 5",
        browser: "chromium",
      }),
      candidate({
        id: "b",
        errorMessage: "expected 9 got 11",
        browser: "webkit",
      }),
      candidate({ id: "c", errorMessage: "navigation timed out" }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].reason).toBe("error_signature");
    expect(result.groups[0].candidateIds).toEqual(["a", "b"]);
    expect(result.groups[0].browsers).toEqual(["chromium", "webkit"]);
    expect(result.ungrouped).toEqual(["c"]);
  });

  it("groups by transitively overlapping changed regions", () => {
    const result = clusterDeterministically([
      candidate({
        id: "a",
        changedRegions: [{ x: 0, y: 0, width: 10, height: 10 }],
      }),
      candidate({
        id: "b",
        changedRegions: [{ x: 8, y: 8, width: 10, height: 10 }],
      }),
      candidate({
        id: "c",
        changedRegions: [{ x: 16, y: 16, width: 10, height: 10 }],
      }),
      candidate({
        id: "d",
        changedRegions: [{ x: 900, y: 900, width: 5, height: 5 }],
      }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].reason).toBe("shared_regions");
    expect(result.groups[0].candidateIds).toEqual(["a", "b", "c"]);
    expect(result.groups[0].sharedRegions).toEqual([
      { x: 0, y: 0, width: 26, height: 26 },
    ]);
    expect(result.ungrouped).toEqual(["d"]);
  });

  it("falls back to spec file + browser-set", () => {
    const result = clusterDeterministically([
      candidate({
        id: "a",
        testId: "t1",
        specFile: "checkout.spec.ts",
        browser: "chromium",
      }),
      candidate({
        id: "b",
        testId: "t2",
        specFile: "checkout.spec.ts",
        browser: "chromium",
      }),
      candidate({
        id: "c",
        testId: "t3",
        specFile: "login.spec.ts",
        browser: "chromium",
      }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].reason).toBe("spec_and_browsers");
    expect(result.groups[0].candidateIds).toEqual(["a", "b"]);
    expect(result.groups[0].specFiles).toEqual(["checkout.spec.ts"]);
    expect(result.ungrouped).toEqual(["c"]);
  });

  it("keeps a spec file apart when the browser-sets differ", () => {
    const result = clusterDeterministically([
      candidate({
        id: "a",
        testId: "t1",
        specFile: "s.spec.ts",
        browser: "chromium",
      }),
      candidate({
        id: "b",
        testId: "t2",
        specFile: "s.spec.ts",
        browser: "firefox",
      }),
    ]);
    expect(result.groups).toEqual([]);
    expect(result.ungrouped).toEqual(["a", "b"]);
  });

  it("claims each candidate at most once, earlier passes winning", () => {
    const shared = [{ x: 0, y: 0, width: 10, height: 10 }];
    const result = clusterDeterministically([
      candidate({
        id: "a",
        errorMessage: "boom",
        changedRegions: shared,
        specFile: "s.ts",
      }),
      candidate({
        id: "b",
        errorMessage: "boom",
        changedRegions: shared,
        specFile: "s.ts",
      }),
      candidate({ id: "c", changedRegions: shared, specFile: "s.ts" }),
    ]);
    expect(result.groups.map((g) => g.reason)).toEqual(["error_signature"]);
    expect(result.groups[0].candidateIds).toEqual(["a", "b"]);
    expect(result.ungrouped).toEqual(["c"]);
  });

  it("orders groups largest-first and is stable across a repeated call", () => {
    const input = [
      candidate({ id: "a", errorMessage: "one" }),
      candidate({ id: "b", errorMessage: "two" }),
      candidate({ id: "c", errorMessage: "two" }),
      candidate({ id: "d", errorMessage: "one" }),
      candidate({ id: "e", errorMessage: "two" }),
    ];
    const first = clusterDeterministically(input);
    expect(first.groups.map((g) => g.candidateIds)).toEqual([
      ["b", "c", "e"],
      ["a", "d"],
    ]);
    expect(clusterDeterministically(input)).toEqual(first);
  });

  it("gives every group a unique key", () => {
    const result = clusterDeterministically([
      candidate({ id: "a", errorMessage: "!!!" }),
      candidate({ id: "b", errorMessage: "???" }),
      candidate({ id: "c", errorMessage: "!!!" }),
      candidate({ id: "d", errorMessage: "???" }),
    ]);
    const keys = result.groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
