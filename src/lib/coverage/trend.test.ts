import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoverageCell } from "@/lib/db/schema";

const hasUnsnapshottedCoverageBuilds = vi.fn();
const getCoverageCells = vi.fn();
const getCoverageDimensions = vi.fn();
const getCoverageAttributionTimeline = vi.fn();
const getSnapshottedBuildIds = vi.fn();
const recordCoverageSnapshot = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  DEFAULT_BACKFILL_MAX_BUILDS: 200,
  hasUnsnapshottedCoverageBuilds: (...a: unknown[]) =>
    hasUnsnapshottedCoverageBuilds(...a),
  getCoverageCells: (...a: unknown[]) => getCoverageCells(...a),
  getCoverageDimensions: (...a: unknown[]) => getCoverageDimensions(...a),
  getCoverageAttributionTimeline: (...a: unknown[]) =>
    getCoverageAttributionTimeline(...a),
  getSnapshottedBuildIds: (...a: unknown[]) => getSnapshottedBuildIds(...a),
  recordCoverageSnapshot: (...a: unknown[]) => recordCoverageSnapshot(...a),
}));

import {
  summarizeCoverage,
  backfillCoverageSnapshots,
} from "@/lib/coverage/trend";

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

describe("backfillCoverageSnapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoverageCells.mockResolvedValue(CELLS);
    getCoverageDimensions.mockResolvedValue([]);
    getSnapshottedBuildIds.mockResolvedValue([]);
    getCoverageAttributionTimeline.mockResolvedValue([
      {
        cellId: "country=DE|type=A",
        buildId: "build-1",
        ranAt: new Date("2026-01-01T00:00:00Z"),
        verdict: "passed",
      },
    ]);
    recordCoverageSnapshot.mockResolvedValue(undefined);
  });

  it("short-circuits before reading the timeline when the probe finds no gap", async () => {
    hasUnsnapshottedCoverageBuilds.mockResolvedValue(false);

    const result = await backfillCoverageSnapshots("repo");

    expect(result).toEqual({ buildsSeen: 0, written: 0, skippedExisting: 0 });
    // The whole point of the gate: none of the expensive reads happen.
    expect(getCoverageAttributionTimeline).not.toHaveBeenCalled();
    expect(getCoverageCells).not.toHaveBeenCalled();
    expect(getSnapshottedBuildIds).not.toHaveBeenCalled();
    expect(recordCoverageSnapshot).not.toHaveBeenCalled();
  });

  it("asks the probe about the same window it writes", async () => {
    hasUnsnapshottedCoverageBuilds.mockResolvedValue(false);

    await backfillCoverageSnapshots("repo");
    expect(hasUnsnapshottedCoverageBuilds).toHaveBeenLastCalledWith(
      "repo",
      "default",
      { maxBuilds: 200 },
    );

    // A caller narrowing the write window narrows the probe with it —
    // otherwise the probe reports gaps this call would never fill and the
    // fast path never engages.
    await backfillCoverageSnapshots("repo", {
      environmentKey: "staging",
      maxBuilds: 5,
    });
    expect(hasUnsnapshottedCoverageBuilds).toHaveBeenLastCalledWith(
      "repo",
      "staging",
      { maxBuilds: 5 },
    );
  });

  it("fails open and does the work when the probe errors", async () => {
    hasUnsnapshottedCoverageBuilds.mockRejectedValue(new Error("probe down"));

    const result = await backfillCoverageSnapshots("repo");

    expect(getCoverageAttributionTimeline).toHaveBeenCalled();
    expect(result).toMatchObject({ buildsSeen: 1, written: 1 });
    expect(recordCoverageSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: "build-1", source: "backfill" }),
    );
  });
});
