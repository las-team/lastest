import { describe, it, expect } from "vitest";
import {
  parseRowFilter,
  matchesRowFilter,
  selectRowIndices,
} from "./row-filter";
import { expandMatrix, matrixVariables, pairwiseReduce } from "./matrix";
import { expandTestsForMatrix } from "@/lib/execution/matrix-expand";
import {
  computePlanBudget,
  buildCoverageDirective,
  DEFAULT_HARD_CAP,
} from "@lastest/coverage-model";
import { buildVqlGroupQuery, parseVaultGroups } from "./profilers/vault";
import { groupRecords, extractRecords } from "./profilers/rest";
import { extractChurnedObjectTypes } from "./index";
import { groupsToDimensionValues } from "./profilers/types";
import type { Test, TestVariable } from "@/lib/db/schema";
import type { TabularSourceLike } from "@lastest/coverage-model";
import type { StopDecision } from "./stop";
import type { CoverageReport } from "./rollup";

// ── Row filter ──────────────────────────────────────────────────────────────

describe("row filter", () => {
  it("parses IN, NOT IN, = and != joined by AND", () => {
    const p = parseRowFilter(
      "country IN (DE, FR) AND callType = Detail AND channel != Remote",
    );
    expect(p.errors).toEqual([]);
    expect(p.clauses).toEqual([
      { field: "country", op: "in", values: ["DE", "FR"] },
      { field: "callType", op: "eq", values: ["Detail"] },
      { field: "channel", op: "neq", values: ["Remote"] },
    ]);
  });

  it("parses NOT IN without swallowing the negation", () => {
    const p = parseRowFilter("country NOT IN (PT)");
    expect(p.clauses[0].op).toBe("not-in");
  });

  it("matches case-insensitively on field and value", () => {
    const p = parseRowFilter("Country IN (de)");
    expect(matchesRowFilter({ country: "DE" }, p)).toBe(true);
  });

  it("treats an empty filter as matching everything", () => {
    const p = parseRowFilter("");
    expect(matchesRowFilter({ anything: "x" }, p)).toBe(true);
  });

  it("selects no rows for a malformed filter rather than silently all", () => {
    const { indices, errors } = selectRowIndices(
      [{ country: "DE" }, { country: "FR" }],
      "country ~~ DE",
    );
    expect(indices).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("handles quoted values containing spaces", () => {
    const p = parseRowFilter(`callType IN ("Sample Drop", Detail)`);
    expect(p.clauses[0].values).toEqual(["Sample Drop", "Detail"]);
    expect(matchesRowFilter({ callType: "Sample Drop" }, p)).toBe(true);
  });

  it("treats a missing field as an empty value, not a match", () => {
    const p = parseRowFilter("country = DE");
    expect(matchesRowFilter({ other: "x" }, p)).toBe(false);
  });

  it("selects matching row indices in source order", () => {
    const { indices } = selectRowIndices(
      [{ c: "DE" }, { c: "PT" }, { c: "FR" }, { c: "DE" }],
      "c IN (DE, FR)",
    );
    expect(indices).toEqual([0, 2, 3]);
  });
});

// ── Pairwise reduction ──────────────────────────────────────────────────────

describe("pairwiseReduce", () => {
  const cell = (coords: Record<string, string>) => ({ coords });

  it("covers every pair with far fewer runs than the full set", () => {
    const all = ["DE", "FR", "IT", "ES"].flatMap((country) =>
      ["Detail", "Sample", "Remote"].flatMap((callType) =>
        ["F2F", "Video"].map((channel) => cell({ country, callType, channel })),
      ),
    );
    expect(all).toHaveLength(24);
    const reduced = pairwiseReduce(all, 2);
    expect(reduced.length).toBeLessThan(all.length);

    // Every pair present in the full set must survive the reduction.
    const pairsOf = (cs: typeof all) => {
      const s = new Set<string>();
      for (const c of cs) {
        const f = Object.keys(c.coords).sort();
        for (let i = 0; i < f.length; i++)
          for (let j = i + 1; j < f.length; j++)
            s.add(`${f[i]}=${c.coords[f[i]]}|${f[j]}=${c.coords[f[j]]}`);
      }
      return s;
    };
    const before = pairsOf(all);
    const after = pairsOf(reduced);
    for (const p of before) expect(after.has(p)).toBe(true);
  });

  it("is deterministic — a nondeterministic suite size is unusable", () => {
    const all = ["a", "b", "c"].flatMap((x) =>
      ["1", "2", "3"].map((y) => cell({ x, y })),
    );
    expect(pairwiseReduce(all, 2).map((c) => c.coords)).toEqual(
      pairwiseReduce(all, 2).map((c) => c.coords),
    );
  });

  it("preserves source order in the chosen set", () => {
    const all = ["a", "b", "c", "d"].flatMap((x) =>
      ["1", "2"].map((y) => cell({ x, y })),
    );
    const reduced = pairwiseReduce(all, 2);
    const positions = reduced.map((c) => all.indexOf(c));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("keeps every distinct combination when fields are fewer than the strength", () => {
    const all = [cell({ x: "a" }), cell({ x: "b" })];
    expect(pairwiseReduce(all, 2)).toHaveLength(2);
  });

  it("collapses duplicate rows that carry the same combination", () => {
    // 6 rows, 3 distinct combinations — the 3 duplicates add no coverage.
    const all = [
      cell({ x: "a", y: "1" }),
      cell({ x: "a", y: "1" }),
      cell({ x: "b", y: "2" }),
      cell({ x: "b", y: "2" }),
      cell({ x: "c", y: "3" }),
      cell({ x: "c", y: "3" }),
    ];
    const reduced = pairwiseReduce(all, 2);
    expect(reduced).toHaveLength(3);
    expect(reduced.map((c) => c.coords.x)).toEqual(["a", "b", "c"]);
  });
});

// ── Matrix expansion ────────────────────────────────────────────────────────

const csvSource = (
  alias: string,
  headers: string[],
  rows: string[][],
): TabularSourceLike =>
  ({
    id: alias,
    alias,
    cachedHeaders: headers,
    cachedData: rows,
    rowCount: rows.length,
  }) as TabularSourceLike;

const matrixVar = (over: Partial<TestVariable>): TestVariable => ({
  id: over.id ?? "v1",
  name: over.name ?? "country",
  mode: "assign",
  sourceType: "csv",
  sourceAlias: "calls",
  sourceColumn: "country",
  sourceRowMode: "matrix",
  ...over,
});

describe("expandMatrix", () => {
  const calls = csvSource(
    "calls",
    ["country", "callType"],
    [
      ["DE", "Detail"],
      ["FR", "Detail"],
      ["DE", "Sample"],
      ["PT", "Sample"],
    ],
  );

  it("produces one run per selected row", () => {
    const r = expandMatrix({
      variables: [matrixVar({})],
      gsheetSources: [],
      csvSources: [calls],
      policy: { selection: "all", strength: 2, visual: "all", maxRuns: 50 },
    });
    expect(r.runs).toHaveLength(4);
    expect(r.runs.map((x) => x.coords.country)).toEqual([
      "DE",
      "FR",
      "DE",
      "PT",
    ]);
  });

  it("walks columns of the SAME source together, not as separate axes", () => {
    const r = expandMatrix({
      variables: [
        matrixVar({ id: "a", name: "country", sourceColumn: "country" }),
        matrixVar({ id: "b", name: "callType", sourceColumn: "callType" }),
      ],
      gsheetSources: [],
      csvSources: [calls],
      policy: { selection: "all", strength: 2, visual: "all", maxRuns: 50 },
    });
    // 4 rows, NOT 4x4 — the columns are fields of one record.
    expect(r.runs).toHaveLength(4);
    expect(r.runs[0].coords).toEqual({ country: "DE", callType: "Detail" });
  });

  it("cross-products across DIFFERENT sources", () => {
    const products = csvSource("products", ["product"], [["X"], ["Y"]]);
    const r = expandMatrix({
      variables: [
        matrixVar({ id: "a" }),
        matrixVar({
          id: "b",
          name: "product",
          sourceAlias: "products",
          sourceColumn: "product",
        }),
      ],
      gsheetSources: [],
      csvSources: [calls, products],
      policy: { selection: "all", strength: 2, visual: "all", maxRuns: 50 },
    });
    expect(r.runs).toHaveLength(8);
  });

  it("applies the row filter to the slice", () => {
    const r = expandMatrix({
      variables: [matrixVar({ rowFilter: "country IN (DE)" })],
      gsheetSources: [],
      csvSources: [calls],
      policy: { selection: "all", strength: 2, visual: "all", maxRuns: 50 },
    });
    expect(r.runs).toHaveLength(2);
    expect(r.runs.every((x) => x.coords.country === "DE")).toBe(true);
  });

  it("captures the visual layer on exactly one run under the default policy", () => {
    const r = expandMatrix({
      variables: [matrixVar({})],
      gsheetSources: [],
      csvSources: [calls],
    });
    expect(r.runs.filter((x) => x.capturesVisual)).toHaveLength(1);
    expect(r.runs[0].capturesVisual).toBe(true);
  });

  it("disables the visual layer entirely when asked", () => {
    const r = expandMatrix({
      variables: [matrixVar({})],
      gsheetSources: [],
      csvSources: [calls],
      policy: { selection: "all", strength: 2, visual: "none", maxRuns: 50 },
    });
    expect(r.runs.every((x) => !x.capturesVisual)).toBe(true);
  });

  it("never materializes an unbounded cartesian product", () => {
    // Two 5,000-row sources are 25M combinations. Before the materialization
    // ceiling this allocated all of them inside the web process before maxRuns
    // was applied — a multi-second freeze at best, an OOM at worst.
    const big = (alias: string, col: string) =>
      csvSource(
        alias,
        [col],
        Array.from({ length: 5000 }, (_, i) => [`${col}${i}`]),
      );
    const started = Date.now();
    const r = expandMatrix({
      variables: [
        matrixVar({
          id: "a",
          name: "left",
          sourceAlias: "l",
          sourceColumn: "l",
        }),
        matrixVar({
          id: "b",
          name: "right",
          sourceAlias: "r",
          sourceColumn: "r",
        }),
      ],
      gsheetSources: [],
      csvSources: [big("l", "l"), big("r", "r")],
      policy: { selection: "all", strength: 2, visual: "none", maxRuns: 50 },
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.runs).toHaveLength(50);
    expect(r.candidateCount).toBe(25_000_000);
    expect(r.truncated).toBe(true);
    expect(r.explanation).toMatch(/never enumerated/);
  });

  it("still pairwise-reduces a large candidate set in bounded time", () => {
    const big = (alias: string, col: string, n: number) =>
      csvSource(
        alias,
        [col],
        Array.from({ length: n }, (_, i) => [`${col}${i % 20}-${i}`]),
      );
    const started = Date.now();
    const r = expandMatrix({
      variables: [
        matrixVar({
          id: "a",
          name: "left",
          sourceAlias: "l",
          sourceColumn: "l",
        }),
        matrixVar({
          id: "b",
          name: "right",
          sourceAlias: "r",
          sourceColumn: "r",
        }),
      ],
      gsheetSources: [],
      csvSources: [big("l", "l", 400), big("r", "r", 400)],
      policy: {
        selection: "pairwise",
        strength: 2,
        visual: "none",
        maxRuns: 50,
      },
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(r.runs.length).toBeLessThanOrEqual(50);
  });

  it("samples the truncated product by stride so every axis varies", () => {
    // Positional truncation ("first cap" combinations) pins the first source
    // to its row 0 — pairwise covering then has nothing to vary on that axis.
    const big = (alias: string, col: string) =>
      csvSource(
        alias,
        [col],
        Array.from({ length: 5000 }, (_, i) => [`${col}${i}`]),
      );
    const r = expandMatrix({
      variables: [
        matrixVar({
          id: "a",
          name: "left",
          sourceAlias: "l",
          sourceColumn: "l",
        }),
        matrixVar({
          id: "b",
          name: "right",
          sourceAlias: "r",
          sourceColumn: "r",
        }),
      ],
      gsheetSources: [],
      csvSources: [big("l", "l"), big("r", "r")],
      policy: {
        selection: "all",
        strength: 2,
        visual: "none",
        maxRuns: 5000,
      },
    });
    const leftValues = new Set(r.runs.map((run) => run.coords["left"]));
    const rightValues = new Set(r.runs.map((run) => run.coords["right"]));
    expect(leftValues.size).toBeGreaterThan(100);
    expect(rightValues.size).toBeGreaterThan(100);
  });

  it("reports truncation rather than silently clipping", () => {
    const r = expandMatrix({
      variables: [matrixVar({})],
      gsheetSources: [],
      csvSources: [calls],
      policy: { selection: "all", strength: 2, visual: "all", maxRuns: 2 },
    });
    expect(r.runs).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(r.explanation).toMatch(/truncated/);
  });

  it("returns no runs and an error when the filter selects nothing", () => {
    const r = expandMatrix({
      variables: [matrixVar({ rowFilter: "country IN (ZZ)" })],
      gsheetSources: [],
      csvSources: [calls],
    });
    expect(r.runs).toHaveLength(0);
    expect(r.errors.join(" ")).toMatch(/selected no rows/);
  });

  it("ignores non-matrix variables", () => {
    expect(
      matrixVariables([
        matrixVar({ id: "a" }),
        matrixVar({ id: "b", sourceRowMode: "fixed" }),
        matrixVar({ id: "c", mode: "extract" }),
      ]).map((v) => v.id),
    ).toEqual(["a"]);
  });

  it("gives every run a distinct cell key", () => {
    const r = expandMatrix({
      variables: [
        matrixVar({ id: "a", name: "country", sourceColumn: "country" }),
        matrixVar({ id: "b", name: "callType", sourceColumn: "callType" }),
      ],
      gsheetSources: [],
      csvSources: [calls],
      policy: { selection: "all", strength: 2, visual: "all", maxRuns: 50 },
    });
    expect(new Set(r.runs.map((x) => x.coordsKey)).size).toBe(r.runs.length);
  });
});

// ── Test-level expansion ────────────────────────────────────────────────────

describe("expandTestsForMatrix", () => {
  const calls = csvSource("calls", ["country"], [["DE"], ["FR"], ["IT"]]);
  const mkTest = (over: Partial<Test>): Test =>
    ({ id: "t1", name: "Call report", variables: [], ...over }) as Test;

  it("leaves non-matrix tests untouched", () => {
    const t = mkTest({ variables: [matrixVar({ sourceRowMode: "fixed" })] });
    const out = expandTestsForMatrix([t], [], [calls]);
    expect(out.tests).toEqual([t]);
    expect(out.notes).toEqual([]);
  });

  it("pins each expanded instance to a fixed row", () => {
    const t = mkTest({
      variables: [matrixVar({})],
      matrixPolicy: {
        selection: "all",
        strength: 2,
        visual: "representative",
        maxRuns: 50,
      },
    });
    const out = expandTestsForMatrix([t], [], [calls]);
    expect(out.tests).toHaveLength(3);
    for (const expanded of out.tests) {
      const v = expanded.variables![0];
      // Downstream resolution must see an ordinary fixed variable.
      expect(v.sourceRowMode).toBe("fixed");
      expect(typeof v.sourceRow).toBe("number");
    }
    expect(out.tests.map((t) => t.variables![0].sourceRow)).toEqual([0, 1, 2]);
  });

  it("tags instances with cell identity and expansion position", () => {
    const t = mkTest({
      variables: [matrixVar({})],
      matrixPolicy: {
        selection: "all",
        strength: 2,
        visual: "representative",
        maxRuns: 50,
      },
    });
    const out = expandTestsForMatrix([t], [], [calls]);
    expect(out.tests[0].matrixRun).toMatchObject({
      index: 0,
      total: 3,
      capturesVisual: true,
    });
    expect(out.tests[1].matrixRun?.capturesVisual).toBe(false);
    expect(out.tests[0].matrixRun?.dataCell).toContain("country");
  });

  it("fails a broken matrix test instead of running it once unpinned", () => {
    const t = mkTest({
      variables: [matrixVar({ rowFilter: "country IN (ZZ)" })],
    });
    const out = expandTestsForMatrix([t], [], [calls]);
    expect(out.tests).toHaveLength(0);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].testId).toBe("t1");
  });

  it("rewrites a single-run expansion too", () => {
    // The count is unchanged here (1 test in, 1 test out) — which is exactly
    // the case the executor used to treat as "nothing expanded" and discard,
    // running the ORIGINAL test with an unpinned matrix variable and no cell.
    const t = mkTest({
      variables: [matrixVar({ rowFilter: "country IN (FR)" })],
      matrixPolicy: {
        selection: "all",
        strength: 2,
        visual: "representative",
        maxRuns: 50,
      },
    });
    const out = expandTestsForMatrix([t], [], [calls]);
    expect(out.tests).toHaveLength(1);
    expect(out.tests[0]).not.toBe(t);
    expect(out.tests[0].variables![0].sourceRowMode).toBe("fixed");
    expect(out.tests[0].variables![0].sourceRow).toBe(1);
    expect(out.tests[0].matrixRun?.dataCell).toContain("FR");
  });

  it("does not mutate the original test", () => {
    const variables = [matrixVar({})];
    const t = mkTest({ variables });
    expandTestsForMatrix([t], [], [calls]);
    expect(variables[0].sourceRowMode).toBe("matrix");
    expect(t.variables).toBe(variables);
  });
});

// ── P3: plan budget ─────────────────────────────────────────────────────────

const mkStop = (over: Partial<StopDecision>): StopDecision =>
  ({
    shouldStop: false,
    reasons: [],
    queue: [],
    explanation: "explanation",
    metrics: {
      eligibleCells: 10,
      coveredCells: 2,
      excludedCells: 0,
      totalTuples: 20,
      coveredTuples: 4,
      tupleCoverage: 0.2,
      weightedVolumeCoverage: 0.2,
      nextBest: null,
      marginalWeight: 0.5,
    },
    ...over,
  }) as StopDecision;

describe("computePlanBudget", () => {
  it("falls back to the fixed cap when no coverage model exists", () => {
    const b = computePlanBudget({ stop: null });
    expect(b.maxItems).toBe(DEFAULT_HARD_CAP);
    expect(b.coverageDriven).toBe(false);
    expect(b.rationale).toMatch(/No coverage model/);
  });

  it("returns a zero budget when the stop rule says targets are met", () => {
    const b = computePlanBudget({
      stop: mkStop({ shouldStop: true, reasons: ["targets_met"] }),
    });
    expect(b.maxItems).toBe(0);
    expect(b.shouldStop).toBe(true);
  });

  it("derives a budget from the uncovered tuple deficit", () => {
    const b = computePlanBudget({
      stop: mkStop({
        queue: [
          {
            objectType: "calls",
            coordsKey: "a",
            coords: { c: "1" },
            observedCount: 5,
            weight: 0.9,
            covered: false,
          },
        ],
      }),
    });
    expect(b.coverageDriven).toBe(true);
    expect(b.maxItems).toBeGreaterThan(0);
    expect(b.maxItems).toBeLessThanOrEqual(DEFAULT_HARD_CAP);
    expect(b.rationale).toMatch(/combination\(s\) still uncovered/);
  });

  it("never exceeds the hard cap — browser tests generate sequentially", () => {
    const b = computePlanBudget({
      stop: mkStop({
        metrics: {
          ...mkStop({}).metrics,
          totalTuples: 100000,
          tupleCoverage: 0,
        },
        queue: Array.from({ length: 500 }, (_, i) => ({
          objectType: "calls",
          coordsKey: `k${i}`,
          coords: { c: String(i) },
          observedCount: 1,
          weight: 0.9,
          covered: false,
        })),
      }),
    });
    expect(b.maxItems).toBeLessThanOrEqual(DEFAULT_HARD_CAP);
  });
});

describe("buildCoverageDirective", () => {
  const report: CoverageReport = {
    repositoryId: "r1",
    environmentKey: "default",
    strength: 2,
    byObjectType: [
      {
        objectType: "calls",
        totalCells: 10,
        coveredCells: 2,
        excludedCells: 1,
        failingCells: 0,
        cellCoverage: 0.2,
        tupleCoverage: 0.3,
        weightedVolumeCoverage: 0.4,
        cartesianCombinations: 96,
        skippedAsNonOccurring: 86,
      },
    ],
    byDimension: [
      {
        objectType: "calls",
        field: "country",
        label: "country",
        totalValues: 3,
        touchedValues: 1,
        untouchedValues: ["FR", "IT"],
        valueCoverage: 1 / 3,
      },
    ],
    totals: {
      objectTypes: 1,
      dimensions: 1,
      cells: 10,
      coveredCells: 2,
      excludedCells: 1,
      cellCoverage: 0.2,
    },
  };

  it("returns null when no coverage model drove the budget", () => {
    expect(
      buildCoverageDirective({
        report,
        queue: [],
        budget: computePlanBudget({ stop: null }),
      }),
    ).toBeNull();
  });

  it("names the ranked cells, the untouched values, and the skipped cartesian", () => {
    const budget = computePlanBudget({ stop: mkStop({}) });
    const d = buildCoverageDirective({
      report,
      queue: [
        {
          objectType: "calls",
          coordsKey: "k",
          coords: { country: "FR", callType: "Detail" },
          observedCount: 42,
          weight: 0.77,
          covered: false,
        },
      ],
      budget,
    })!;
    // Coordinates are rendered field-sorted, so the order is stable.
    expect(d).toContain("callType=Detail, country=FR");
    expect(d).toContain("0.770");
    expect(d).toContain("86 cartesian combination(s) do not occur");
    expect(d).toContain("FR, IT");
    expect(d).toMatch(/at most \d+ plan item/);
  });

  it("lists deliberately excluded cells as do-not-plan", () => {
    const budget = computePlanBudget({ stop: mkStop({}) });
    const d = buildCoverageDirective({
      report,
      queue: [],
      budget,
      excluded: [
        {
          objectType: "calls",
          coordsKey: "x",
          coords: { country: "PT" },
          observedCount: 0,
          weight: 0,
          covered: false,
          excluded: true,
          excludedReason: "market not launched",
        },
      ],
    })!;
    expect(d).toMatch(/do NOT plan tests for these/);
    expect(d).toContain("market not launched");
  });
});

// ── P4: profilers ───────────────────────────────────────────────────────────

describe("Vault VQL", () => {
  it("builds a grouped count query", () => {
    expect(
      buildVqlGroupQuery({
        objectType: "call__v",
        fields: ["country__v", "call_type__v"],
        limit: 500,
      }),
    ).toBe(
      "SELECT country__v, call_type__v, COUNT() AS record_count FROM call__v GROUP BY country__v, call_type__v LIMIT 500",
    );
  });

  it("rejects identifiers that are not plain names rather than escaping them", () => {
    expect(() =>
      buildVqlGroupQuery({
        objectType: "call__v; DELETE FROM x",
        fields: ["country__v"],
      }),
    ).toThrow(/Invalid object type/);
    expect(() =>
      buildVqlGroupQuery({
        objectType: "call__v",
        fields: ["country__v, (SELECT 1)"],
      }),
    ).toThrow(/Invalid field/);
  });

  it("requires at least one field", () => {
    expect(() =>
      buildVqlGroupQuery({ objectType: "call__v", fields: [] }),
    ).toThrow(/At least one field/);
  });

  it("parses grouped rows and skips incomplete tuples", () => {
    const groups = parseVaultGroups(
      [
        { country__v: "DE", call_type__v: "Detail", record_count: 100 },
        { country__v: "FR", call_type__v: "Detail", record_count: 20 },
        { country__v: "IT", record_count: 5 },
      ],
      ["country__v", "call_type__v"],
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      coords: { country__v: "DE", call_type__v: "Detail" },
      count: 100,
    });
  });
});

describe("REST profiler helpers", () => {
  it("extracts records from a nested path", () => {
    expect(
      extractRecords({ data: { items: [{ a: 1 }, { a: 2 }] } }, "data.items"),
    ).toHaveLength(2);
  });

  it("returns nothing when the path does not resolve to an array", () => {
    expect(extractRecords({ data: {} }, "data.items")).toEqual([]);
  });

  it("groups records and skips those missing a field", () => {
    const groups = groupRecords(
      [
        { country: "DE", type: "Detail" },
        { country: "DE", type: "Detail" },
        { country: "FR", type: "Detail" },
        { country: "IT" },
      ],
      ["country", "type"],
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(2);
  });
});

describe("groupsToDimensionValues", () => {
  it("sums counts across groups and computes shares", () => {
    const values = groupsToDimensionValues(
      [
        { coords: { country: "DE", t: "a" }, count: 60 },
        { coords: { country: "DE", t: "b" }, count: 20 },
        { coords: { country: "FR", t: "a" }, count: 20 },
      ],
      "country",
    );
    expect(values[0]).toEqual({ value: "DE", recordCount: 80, share: 0.8 });
    expect(values[1]).toEqual({ value: "FR", recordCount: 20, share: 0.2 });
  });
});

describe("extractChurnedObjectTypes", () => {
  it("matches object types named literally in release notes", () => {
    expect(
      extractChurnedObjectTypes(
        "26R2 updates the Call Report layout on call__v and account__v.",
        ["call__v", "account__v", "order__v"],
      ),
    ).toEqual(["call__v", "account__v"]);
  });

  it("does not match inside a longer identifier", () => {
    expect(
      extractChurnedObjectTypes("changes to recall__vx only", ["call__v"]),
    ).toEqual([]);
  });

  it("finds a standalone mention that follows an embedded one", () => {
    // Only the FIRST occurrence used to be checked: the embedded one failed the
    // boundary test and the real mention behind it was never looked at.
    expect(
      extractChurnedObjectTypes("recall__vx deprecated; call__v updated", [
        "call__v",
      ]),
    ).toEqual(["call__v"]);
  });

  it("returns nothing for notes naming no known type", () => {
    expect(extractChurnedObjectTypes("General fixes.", ["call__v"])).toEqual(
      [],
    );
  });
});
