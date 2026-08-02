import { describe, it, expect } from "vitest";
import { summarizeCoverage } from "./trend";
import type { CoverageCell } from "@/lib/db/schema";

function cell(
  partial: Partial<CoverageCell> & { coordsKey: string },
): CoverageCell {
  return {
    id: partial.coordsKey,
    repositoryId: "repo",
    environmentKey: "default",
    objectType: partial.objectType ?? "orders",
    coordsKey: partial.coordsKey,
    coords: partial.coords ?? {},
    observedCount: partial.observedCount ?? 0,
    weight: partial.weight ?? 0,
    weightBreakdown: null,
    status: partial.status ?? "uncovered",
    excludedReason: partial.excludedReason ?? null,
    runCount: partial.runCount ?? 0,
    passCount: 0,
    failCount: 0,
    lastRunAt: null,
    lastVerdict: null,
    createdAt: null,
    updatedAt: null,
  } as CoverageCell;
}

const CELLS: CoverageCell[] = [
  cell({
    coordsKey: "country=DE|type=A",
    coords: { country: "DE", type: "A" },
    observedCount: 60,
    status: "covered",
    runCount: 1,
  }),
  cell({
    coordsKey: "country=FR|type=B",
    coords: { country: "FR", type: "B" },
    observedCount: 30,
    status: "uncovered",
  }),
  cell({
    coordsKey: "country=DE|type=B",
    coords: { country: "DE", type: "B" },
    observedCount: 10,
    status: "excluded",
    excludedReason: "not sold in DE",
  }),
];

describe("summarizeCoverage", () => {
  it("scores against the persisted status by default", () => {
    const totals = summarizeCoverage(CELLS);
    expect(totals.totalCells).toBe(3);
    expect(totals.excludedCells).toBe(1);
    // 1 of the 2 non-excluded cells.
    expect(totals.coveredCells).toBe(1);
    expect(totals.cellCoverage).toBeCloseTo(0.5);
    // Volume, not cell count: the covered cell holds 60 of the 90 eligible.
    expect(totals.weightedVolumeCoverage).toBeCloseTo(60 / 90);
  });

  it("excludes excluded cells from the denominator, never counts them covered", () => {
    const totals = summarizeCoverage(CELLS);
    expect(totals.byObjectType).toHaveLength(1);
    expect(totals.byObjectType[0]).toMatchObject({
      objectType: "orders",
      totalCells: 3,
      excludedCells: 1,
      coveredCells: 1,
    });
    expect(totals.byObjectType[0].cellCoverage).toBeCloseTo(0.5);
  });

  it("honours a covered-set override — the point a reconstructed snapshot needs", () => {
    // "As of build N, only the FR cell had been exercised" — the opposite of
    // what the ledger says today.
    const totals = summarizeCoverage(CELLS, {
      coveredCellIds: new Set(["country=FR|type=B"]),
    });
    expect(totals.coveredCells).toBe(1);
    expect(totals.weightedVolumeCoverage).toBeCloseTo(30 / 90);
  });

  it("reports zero coverage when nothing had run yet", () => {
    const totals = summarizeCoverage(CELLS, { coveredCellIds: new Set() });
    expect(totals.coveredCells).toBe(0);
    expect(totals.cellCoverage).toBe(0);
    expect(totals.tupleCoverage).toBe(0);
  });

  it("counts failing cells from the override rather than the live status", () => {
    const totals = summarizeCoverage(CELLS, {
      coveredCellIds: new Set(["country=DE|type=A"]),
      failingCellIds: new Set(["country=DE|type=A"]),
    });
    expect(totals.failingCells).toBe(1);
    // A failing cell is still covered — it is tested, it is just broken.
    expect(totals.coveredCells).toBe(1);
  });

  it("returns an empty, non-NaN summary for a repo with no cells", () => {
    const totals = summarizeCoverage([]);
    expect(totals).toMatchObject({
      totalCells: 0,
      coveredCells: 0,
      cellCoverage: 0,
      byObjectType: [],
    });
    expect(Number.isNaN(totals.weightedVolumeCoverage)).toBe(false);
  });
});
