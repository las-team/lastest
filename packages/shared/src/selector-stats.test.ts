import { describe, it, expect } from "vitest";
import {
  hashSelectors,
  sortSelectorsByStats,
  selectorTimeoutFor,
  relevantStats,
  buildStatMap,
  selectorStatKey,
  isUsableSelectorValue,
  type SelectorStatRow,
} from "./selector-stats";

const row = (over: Partial<SelectorStatRow>): SelectorStatRow => ({
  hash: "h1",
  type: "css",
  value: "#a",
  successCount: 0,
  failureCount: 0,
  totalAttempts: 0,
  avgResponseTimeMs: null,
  ...over,
});

describe("isUsableSelectorValue", () => {
  it("rejects empty / whitespace values", () => {
    expect(isUsableSelectorValue("")).toBe(false);
    expect(isUsableSelectorValue("   ")).toBe(false);
    expect(isUsableSelectorValue(null)).toBe(false);
    expect(isUsableSelectorValue(undefined)).toBe(false);
  });

  it("rejects interpolation leaks of a standalone `undefined` token", () => {
    expect(isUsableSelectorValue("undefined")).toBe(false);
    expect(isUsableSelectorValue("#undefined")).toBe(false);
    expect(isUsableSelectorValue(".undefined > div")).toBe(false);
    expect(isUsableSelectorValue('[data-id="undefined"]')).toBe(false);
    expect(isUsableSelectorValue("undefined .child")).toBe(false);
  });

  it("keeps identifiers that merely contain the substring", () => {
    expect(isUsableSelectorValue("#undefined-state-banner")).toBe(true);
    expect(isUsableSelectorValue(".is-undefinedish")).toBe(true);
    expect(isUsableSelectorValue('[data-test="not_undefined_here"]')).toBe(
      true,
    );
    expect(isUsableSelectorValue("#login-button")).toBe(true);
  });
});

describe("sortSelectorsByStats", () => {
  const sels = [
    { type: "css", value: "#a" },
    { type: "css", value: "#b" },
    { type: "css", value: "#c" },
  ];

  it("returns original order with no stats", () => {
    expect(sortSelectorsByStats(sels, [])).toEqual(sels);
  });

  it("puts the historical winner first, unknowns ahead of known losers", () => {
    const stats = [
      row({ value: "#a", failureCount: 3, totalAttempts: 3 }), // known loser
      row({
        value: "#c",
        successCount: 3,
        totalAttempts: 3,
        avgResponseTimeMs: 100,
      }), // winner
    ];
    const out = sortSelectorsByStats(sels, stats);
    expect(out.map((s) => s.value)).toEqual(["#c", "#b", "#a"]);
  });

  it("is stable among untracked selectors", () => {
    const stats = [row({ value: "#c", successCount: 1, totalAttempts: 1 })];
    const out = sortSelectorsByStats(sels, stats);
    expect(out.map((s) => s.value)).toEqual(["#c", "#a", "#b"]);
  });
});

describe("selectorTimeoutFor", () => {
  it("returns the default for cold start", () => {
    expect(selectorTimeoutFor(undefined, 3000)).toBe(3000);
    expect(
      selectorTimeoutFor(row({ totalAttempts: 2, failureCount: 2 }), 3000),
    ).toBe(3000);
  });

  it("never shortens the top-ranked candidate", () => {
    const loser = row({ failureCount: 10, totalAttempts: 10 });
    expect(selectorTimeoutFor(loser, 3000, 0)).toBe(3000);
    expect(selectorTimeoutFor(loser, 3000, 1)).toBe(500);
  });

  it("caps known losers (no successes, no avg) at 500ms", () => {
    const loser = row({ failureCount: 3, totalAttempts: 3 });
    expect(selectorTimeoutFor(loser, 3000)).toBe(500);
    // ...but never raises a smaller default
    expect(selectorTimeoutFor(loser, 300)).toBe(300);
  });

  it("caps known-slow candidates at max(avg * 2, 500), clamped by default", () => {
    const slow = row({
      successCount: 3,
      totalAttempts: 3,
      avgResponseTimeMs: 1000,
    });
    expect(selectorTimeoutFor(slow, 3000)).toBe(2000);
    const fast = row({
      successCount: 3,
      totalAttempts: 3,
      avgResponseTimeMs: 50,
    });
    expect(selectorTimeoutFor(fast, 3000)).toBe(500);
    expect(selectorTimeoutFor(slow, 1500)).toBe(1500);
  });
});

describe("relevantStats", () => {
  it("prefers exact-hash rows", () => {
    const stats = [
      row({ hash: "h1", value: "#a", successCount: 1, totalAttempts: 1 }),
      row({ hash: "h2", value: "#a", failureCount: 5, totalAttempts: 5 }),
    ];
    const out = relevantStats(stats, "h1");
    expect(out).toHaveLength(1);
    expect(out[0].successCount).toBe(1);
  });

  it("falls back to cross-hash aggregation when the hash is unseen", () => {
    const stats = [
      row({
        hash: "h1",
        value: "#a",
        successCount: 2,
        totalAttempts: 2,
        avgResponseTimeMs: 100,
      }),
      row({
        hash: "h2",
        value: "#a",
        successCount: 2,
        totalAttempts: 3,
        failureCount: 1,
        avgResponseTimeMs: 300,
      }),
      row({ hash: "h2", value: "#b", failureCount: 4, totalAttempts: 4 }),
    ];
    const out = relevantStats(stats, "h3");
    expect(out).toHaveLength(2);
    const a = out.find((r) => r.value === "#a")!;
    expect(a.hash).toBe("h3");
    expect(a.successCount).toBe(4);
    expect(a.failureCount).toBe(1);
    expect(a.totalAttempts).toBe(5);
    // success-weighted: (100*2 + 300*2) / 4
    expect(a.avgResponseTimeMs).toBe(200);
    const b = out.find((r) => r.value === "#b")!;
    expect(b.failureCount).toBe(4);
    expect(b.avgResponseTimeMs).toBeNull();
  });

  it("returns empty for no stats", () => {
    expect(relevantStats([], "h1")).toEqual([]);
  });

  it("keeps a learned winner first across a re-recorded candidate array", () => {
    const oldHash = hashSelectors([
      { type: "css", value: "#a" },
      { type: "css", value: "#b" },
    ]);
    const stats = [
      row({ hash: oldHash, value: "#a", failureCount: 3, totalAttempts: 3 }),
      row({
        hash: oldHash,
        value: "#b",
        successCount: 3,
        totalAttempts: 3,
        avgResponseTimeMs: 80,
      }),
    ];
    // New recording added a candidate — different hash, no exact rows.
    const newSels = [
      { type: "css", value: "#a" },
      { type: "css", value: "#b" },
      { type: "css", value: "#c" },
    ];
    const newHash = hashSelectors(newSels);
    expect(newHash).not.toBe(oldHash);
    const out = sortSelectorsByStats(newSels, relevantStats(stats, newHash));
    expect(out.map((s) => s.value)).toEqual(["#b", "#c", "#a"]);
  });
});

describe("buildStatMap", () => {
  it("keys rows by type::value", () => {
    const map = buildStatMap([
      row({ type: "css", value: "#a", successCount: 1 }),
    ]);
    expect(map.get(selectorStatKey("css", "#a"))?.successCount).toBe(1);
    expect(map.get(selectorStatKey("css", "#b"))).toBeUndefined();
  });
});
