import { describe, it, expect } from "vitest";
import { coordsKey, parseCoordsKey, projectCoords } from "./coords";
import { deriveCells, tableToRecords, cartesianSize } from "./cells";
import { profileTable, profileObservedRuns, tallyValues } from "./dimensions";
import {
  computeWeights,
  tupleKeys,
  coveredTupleKeys,
  normalizeVolume,
  redundancy,
} from "./weight";
import { computeMetrics, evaluateStop } from "./stop";
import { buildCoverageReport } from "./rollup";
import type {
  CellLike as CoverageCell,
  DimensionLike as CoverageDimension,
} from "./types";

describe("coordsKey", () => {
  it("is stable regardless of key order", () => {
    expect(coordsKey({ country: "DE", callType: "Detail" })).toBe(
      coordsKey({ callType: "Detail", country: "DE" }),
    );
  });

  it("round-trips through parseCoordsKey", () => {
    const coords = { country: "DE", callType: "Detail", channel: "F2F" };
    expect(parseCoordsKey(coordsKey(coords))).toEqual(coords);
  });

  it("does not collide when values contain separators", () => {
    const a = { a: "x|b", b: "y" };
    const b = { a: "x", "b|b": "y" };
    expect(coordsKey(a)).not.toBe(coordsKey(b));
    expect(parseCoordsKey(coordsKey(a))).toEqual(a);
  });

  it("handles values containing '='", () => {
    const coords = { filter: "a=b" };
    expect(parseCoordsKey(coordsKey(coords))).toEqual(coords);
  });

  it("projects onto a field subset, dropping absent fields", () => {
    expect(projectCoords({ a: "1", b: "2" }, ["a", "c"])).toEqual({ a: "1" });
  });
});

describe("deriveCells", () => {
  const records = [
    { country: "DE", callType: "Detail" },
    { country: "DE", callType: "Detail" },
    { country: "DE", callType: "Sample" },
    { country: "FR", callType: "Detail" },
  ];

  it("only emits combinations that occur in the data", () => {
    const cells = deriveCells({
      objectType: "calls",
      fields: ["country", "callType"],
      records,
    });
    // 2 countries x 2 call types = 4 cartesian, but only 3 occur.
    expect(cells).toHaveLength(3);
    expect(cartesianSize([2, 2])).toBe(4);
  });

  it("counts occurrences per cell and sorts by volume", () => {
    const cells = deriveCells({
      objectType: "calls",
      fields: ["country", "callType"],
      records,
    });
    expect(cells[0].coords).toEqual({ country: "DE", callType: "Detail" });
    expect(cells[0].observedCount).toBe(2);
  });

  it("skips records missing a dimension value", () => {
    const cells = deriveCells({
      objectType: "calls",
      fields: ["country", "callType"],
      records: [...records, { country: "IT", callType: "" }],
    });
    expect(cells.some((c) => c.coords.country === "IT")).toBe(false);
  });

  it("returns nothing when no fields are selected", () => {
    expect(deriveCells({ objectType: "calls", fields: [], records })).toEqual(
      [],
    );
  });

  it("emits a single consistent field set — mixed sets corrupt denominators", () => {
    const cells = deriveCells({
      objectType: "calls",
      fields: ["country", "callType"],
      records: [
        ...records,
        // A record carrying an extra field must not widen its cell.
        { country: "IT", callType: "Detail", channel: "F2F" },
      ],
    });
    const fieldSets = new Set(
      cells.map((c) => Object.keys(c.coords).sort().join("+")),
    );
    expect([...fieldSets]).toEqual(["callType+country"]);
  });

  it("is order-independent in the field list", () => {
    const a = deriveCells({
      objectType: "calls",
      fields: ["country", "callType"],
      records,
    });
    const b = deriveCells({
      objectType: "calls",
      fields: ["callType", "country"],
      records,
    });
    expect(a.map((c) => c.coordsKey)).toEqual(b.map((c) => c.coordsKey));
  });
});

describe("tableToRecords", () => {
  it("maps headers onto rows and ignores blank headers", () => {
    expect(
      tableToRecords(["country", "", "callType"], [["DE", "junk", "Detail"]]),
    ).toEqual([{ country: "DE", callType: "Detail" }]);
  });
});

describe("dimension profiling", () => {
  it("tallies values with shares", () => {
    const values = tallyValues(["DE", "DE", "FR"]);
    expect(values[0]).toEqual({ value: "DE", recordCount: 2, share: 2 / 3 });
  });

  it("accepts bounded-cardinality columns and rejects identifiers", () => {
    const rows = Array.from({ length: 20 }, (_, i) => [
      `user${i}@example.com`,
      i % 2 === 0 ? "DE" : "FR",
    ]);
    const { accepted, rejected } = profileTable({
      alias: "users",
      headers: ["email", "country"],
      rows,
      valueSource: "csv",
    });
    expect(accepted.map((d) => d.field)).toEqual(["country"]);
    expect(rejected[0].field).toBe("email");
    expect(rejected[0].rejectedReason).toMatch(/identifier/);
  });

  it("rejects columns above the cardinality cap as free text", () => {
    const rows = Array.from({ length: 200 }, (_, i) => [`note-${i % 80}`]);
    const { rejected } = profileTable({
      alias: "notes",
      headers: ["note"],
      rows,
      valueSource: "csv",
      options: { maxCardinality: 50, maxDistinctRatio: 1 },
    });
    expect(rejected[0].rejectedReason).toMatch(/cardinality cap/);
  });

  it("does not apply the distinct-ratio test to a small sample", () => {
    // 2 distinct values over 3 rows is a ratio of 0.67, but on this sample
    // size that is indistinguishable from an identifier column by ratio alone.
    const { accepted, rejected } = profileTable({
      alias: "calls",
      headers: ["country"],
      rows: [["DE"], ["FR"], ["DE"]],
      valueSource: "csv",
    });
    expect(accepted.map((d) => d.field)).toEqual(["country"]);
    expect(rejected).toEqual([]);
  });

  it("rejects single-valued columns as carrying no variation", () => {
    const { rejected } = profileTable({
      alias: "calls",
      headers: ["region"],
      rows: [["EU"], ["EU"], ["EU"]],
      valueSource: "csv",
    });
    expect(rejected[0].rejectedReason).toMatch(/no variation/);
  });

  it("derives dimensions from historical assignedVariables maps", () => {
    const { accepted } = profileObservedRuns(
      [
        { country: "DE", callType: "Detail" },
        { country: "FR", callType: "Detail" },
        { country: "DE", callType: "Sample" },
        null,
      ],
      { objectType: "run-variables" },
    );
    expect(accepted.map((d) => d.field).sort()).toEqual([
      "callType",
      "country",
    ]);
    expect(accepted.every((d) => d.valueSource === "observed")).toBe(true);
  });

  it("defaults objectType to the source alias", () => {
    const { accepted } = profileTable({
      alias: "calls",
      headers: ["country"],
      rows: [["DE"], ["FR"]],
      valueSource: "csv",
    });
    expect(accepted[0].objectType).toBe("calls");
  });
});

describe("t-way tuples", () => {
  it("enumerates all pairs of a 3-field cell", () => {
    const keys = tupleKeys({ a: "1", b: "2", c: "3" }, 2);
    expect(keys).toHaveLength(3);
  });

  it("clamps strength to the available field count", () => {
    expect(tupleKeys({ a: "1" }, 3)).toHaveLength(1);
  });

  it("collects covered tuples across cells", () => {
    const covered = coveredTupleKeys(
      [{ coords: { a: "1", b: "2" } }, { coords: { a: "1", b: "3" } }],
      2,
    );
    expect(covered.size).toBe(2);
  });
});

describe("weighting", () => {
  it("normalizes volume logarithmically", () => {
    expect(normalizeVolume(0, 100)).toBe(0);
    expect(normalizeVolume(100, 100)).toBe(1);
    // 10 of 100 is well above 10% once log-scaled — big volumes are not
    // linearly more important.
    expect(normalizeVolume(10, 100)).toBeGreaterThan(0.4);
  });

  it("ranks a high-volume uncovered cell above a low-volume one", () => {
    const [big, small] = computeWeights([
      {
        coordsKey: "a",
        coords: { country: "DE" },
        observedCount: 10000,
        runCount: 0,
        failCount: 0,
      },
      {
        coordsKey: "b",
        coords: { country: "PT" },
        observedCount: 3,
        runCount: 0,
        failCount: 0,
      },
    ]);
    expect(big.weight).toBeGreaterThan(small.weight);
  });

  it("raises weight for cells with a failure history", () => {
    const [clean, flaky] = computeWeights([
      {
        coordsKey: "a",
        coords: { c: "1" },
        observedCount: 10,
        runCount: 10,
        failCount: 0,
      },
      {
        coordsKey: "b",
        coords: { c: "2" },
        observedCount: 10,
        runCount: 10,
        failCount: 8,
      },
    ]);
    expect(flaky.weight).toBeGreaterThan(clean.weight);
  });

  it("penalizes a cell whose pairs are already covered by neighbours", () => {
    const cells = computeWeights(
      [
        {
          coordsKey: "de",
          coords: { country: "DE", callType: "Detail" },
          observedCount: 10,
          runCount: 1,
          failCount: 0,
          covered: true,
        },
        {
          coordsKey: "es",
          coords: { country: "DE", callType: "Detail" },
          observedCount: 10,
          runCount: 0,
          failCount: 0,
        },
      ],
      undefined,
      2,
    );
    const redundant = cells.find((c) => c.coordsKey === "es")!;
    expect(redundant.breakdown.redundancy).toBeGreaterThan(0);
  });

  it("retains per-term contributions so a ranking can be explained", () => {
    const [cell] = computeWeights([
      {
        coordsKey: "a",
        coords: { c: "1" },
        observedCount: 5,
        runCount: 2,
        failCount: 1,
        criticality: 1,
        churn: 1,
      },
    ]);
    expect(Object.keys(cell.breakdown).sort()).toEqual([
      "churn",
      "criticality",
      "failureHistory",
      "redundancy",
      "total",
      "volume",
    ]);
  });

  it("computes redundancy as the covered fraction of a cell's pairs", () => {
    const covered = coveredTupleKeys([{ coords: { a: "1", b: "2" } }], 2);
    expect(redundancy({ a: "1", b: "2" }, covered, 2)).toBe(1);
    expect(redundancy({ a: "9", b: "9" }, covered, 2)).toBe(0);
  });
});

describe("stop rule", () => {
  const cell = (
    coords: Record<string, string>,
    covered: boolean,
    observedCount = 10,
    weight = 0.5,
  ) => ({
    objectType: "calls",
    coordsKey: coordsKey(coords),
    coords,
    observedCount,
    weight,
    covered,
  });

  it("reaches full pairwise coverage well short of the full cartesian set", () => {
    // 3 countries x 3 call types = 9 combinations; pairwise needs far fewer.
    const all = ["DE", "FR", "IT"].flatMap((country) =>
      ["Detail", "Sample", "Remote"].map((callType) =>
        cell({ country, callType }, false),
      ),
    );
    const covered = [
      cell({ country: "DE", callType: "Detail" }, true),
      cell({ country: "FR", callType: "Sample" }, true),
      cell({ country: "IT", callType: "Remote" }, true),
    ];
    const merged = all.map(
      (c) => covered.find((x) => x.coordsKey === c.coordsKey) ?? c,
    );
    const metrics = computeMetrics(merged, 2);
    // Each covered cell contributes its own pair; 3 of 9 pairs covered.
    expect(metrics.coveredCells).toBe(3);
    expect(metrics.tupleCoverage).toBeCloseTo(3 / 9);
  });

  it("stops when both targets are met", () => {
    const cells = [cell({ a: "1" }, true), cell({ a: "2" }, true)];
    const decision = evaluateStop(cells);
    expect(decision.shouldStop).toBe(true);
    expect(decision.reasons).toContain("no_work_left");
  });

  it("keeps going while a heavy cell is uncovered", () => {
    const cells = [
      cell({ a: "1" }, true, 10, 0.9),
      cell({ a: "2" }, false, 10, 0.9),
    ];
    const decision = evaluateStop(cells);
    expect(decision.shouldStop).toBe(false);
    expect(decision.queue[0].coords).toEqual({ a: "2" });
  });

  it("stops when the next best cell is below the marginal threshold", () => {
    const cells = [
      cell({ a: "1" }, true, 1000, 0.9),
      cell({ a: "2" }, false, 1, 0.001),
    ];
    const decision = evaluateStop(cells, {
      policy: { marginalWeightEpsilon: 0.01 } as never,
    });
    expect(decision.reasons).toContain("marginal_below_epsilon");
    expect(decision.explanation).toMatch(/below the .* marginal threshold/);
  });

  it("stops when the run budget is exhausted", () => {
    const cells = [cell({ a: "1" }, false, 10, 0.9)];
    const decision = evaluateStop(cells, {
      runsSoFar: 500,
      policy: { maxRuns: 500 } as never,
    });
    expect(decision.reasons).toContain("budget_exhausted");
  });

  it("stops when the minute budget is gone", () => {
    const decision = evaluateStop([cell({ a: "1" }, false, 10, 0.9)], {
      budgetMinutesRemaining: 0,
    });
    expect(decision.reasons).toContain("budget_exhausted");
  });

  it("excludes cells from the eligible set and reports why", () => {
    const cells = [
      cell({ a: "1" }, true),
      {
        ...cell({ a: "2" }, false),
        excluded: true,
        excludedReason: "not present in data",
      },
    ];
    const decision = evaluateStop(cells);
    expect(decision.metrics.eligibleCells).toBe(1);
    expect(decision.metrics.excludedCells).toBe(1);
    expect(decision.explanation).toMatch(/1 combination\(s\) excluded/);
  });

  it("weights volume coverage by record count, not cell count", () => {
    const metrics = computeMetrics(
      [cell({ a: "1" }, true, 900), cell({ a: "2" }, false, 100)],
      2,
    );
    expect(metrics.weightedVolumeCoverage).toBeCloseTo(0.9);
  });

  it("always produces an explanation naming what it skipped", () => {
    const decision = evaluateStop([
      cell({ country: "DE" }, true, 1000, 0.9),
      cell({ country: "PT" }, false, 3, 0.002),
    ]);
    expect(decision.explanation).toMatch(/Pairwise coverage/);
    expect(decision.explanation).toMatch(/PT/);
  });
});

describe("rollup", () => {
  const mkCell = (
    over: Partial<CoverageCell> & { coords: Record<string, string> },
  ): CoverageCell =>
    ({
      id: over.coordsKey ?? coordsKey(over.coords),
      repositoryId: "r1",
      environmentKey: "default",
      objectType: "calls",
      coordsKey: coordsKey(over.coords),
      observedCount: 10,
      weight: 0.5,
      weightBreakdown: null,
      status: "uncovered",
      excludedReason: null,
      runCount: 0,
      passCount: 0,
      failCount: 0,
      lastRunAt: null,
      lastVerdict: null,
      createdAt: null,
      updatedAt: null,
      ...over,
    }) as CoverageCell;

  const dim = (field: string, values: string[]): CoverageDimension =>
    ({
      id: field,
      repositoryId: "r1",
      environmentKey: "default",
      objectType: "calls",
      field,
      label: field,
      valueSource: "csv",
      sourceAlias: "calls",
      values: values.map((value) => ({ value, recordCount: 1, share: 0.5 })),
      cardinality: values.length,
      enabled: true,
      profiledAt: null,
      createdAt: null,
      updatedAt: null,
    }) as CoverageDimension;

  it("reports the combinations correctly not being tested", () => {
    const report = buildCoverageReport({
      repositoryId: "r1",
      environmentKey: "default",
      cells: [
        mkCell({ coords: { country: "DE", callType: "Detail" } }),
        mkCell({ coords: { country: "FR", callType: "Detail" } }),
      ],
      dimensions: [
        dim("country", ["DE", "FR", "IT"]),
        dim("callType", ["Detail", "Sample"]),
      ],
    });
    const calls = report.byObjectType[0];
    expect(calls.cartesianCombinations).toBe(6);
    expect(calls.totalCells).toBe(2);
    expect(calls.skippedAsNonOccurring).toBe(4);
  });

  it("counts a failing cell as covered — it is tested, just broken", () => {
    const report = buildCoverageReport({
      repositoryId: "r1",
      environmentKey: "default",
      cells: [
        mkCell({
          coords: { country: "DE" },
          status: "failing",
          runCount: 3,
          failCount: 3,
        }),
      ],
      dimensions: [dim("country", ["DE", "FR"])],
    });
    expect(report.totals.coveredCells).toBe(1);
    expect(report.byObjectType[0].failingCells).toBe(1);
  });

  it("lists untouched dimension values by name", () => {
    const report = buildCoverageReport({
      repositoryId: "r1",
      environmentKey: "default",
      cells: [
        mkCell({ coords: { country: "DE" }, status: "covered", runCount: 1 }),
      ],
      dimensions: [dim("country", ["DE", "FR", "IT"])],
    });
    const countryDim = report.byDimension.find((d) => d.field === "country")!;
    expect(countryDim.untouchedValues).toEqual(["FR", "IT"]);
    expect(countryDim.valueCoverage).toBeCloseTo(1 / 3);
  });

  it("keeps excluded cells out of the coverage denominator", () => {
    const report = buildCoverageReport({
      repositoryId: "r1",
      environmentKey: "default",
      cells: [
        mkCell({ coords: { country: "DE" }, status: "covered", runCount: 1 }),
        mkCell({
          coords: { country: "PT" },
          status: "excluded",
          excludedReason: "market not launched",
        }),
      ],
      dimensions: [dim("country", ["DE", "PT"])],
    });
    expect(report.totals.cellCoverage).toBe(1);
    expect(report.totals.excludedCells).toBe(1);
  });

  it("ignores disabled dimensions", () => {
    const disabled = { ...dim("country", ["DE"]), enabled: false };
    const report = buildCoverageReport({
      repositoryId: "r1",
      environmentKey: "default",
      cells: [],
      dimensions: [disabled as CoverageDimension],
    });
    expect(report.totals.dimensions).toBe(0);
    expect(report.byDimension).toEqual([]);
  });
});
