import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoverageCell, CoverageDimension } from "@/lib/db/schema";

const getAssignedVariableRuns = vi.fn();
const upsertCoverageDimension = vi.fn();
const getCoverageDimensions = vi.fn();
const getCoverageCellObjectTypes = vi.fn();
const pruneCoverageCells = vi.fn();
const upsertCoverageCells = vi.fn();
const getCoverageCells = vi.fn();
const recordCoverageCellRuns = vi.fn();
const refreshCoverageCellStats = vi.fn();
const updateCoverageCellWeights = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  getAssignedVariableRuns: (...a: unknown[]) => getAssignedVariableRuns(...a),
  upsertCoverageDimension: (...a: unknown[]) => upsertCoverageDimension(...a),
  getCoverageDimensions: (...a: unknown[]) => getCoverageDimensions(...a),
  getCoverageCellObjectTypes: (...a: unknown[]) =>
    getCoverageCellObjectTypes(...a),
  pruneCoverageCells: (...a: unknown[]) => pruneCoverageCells(...a),
  upsertCoverageCells: (...a: unknown[]) => upsertCoverageCells(...a),
  getCoverageCells: (...a: unknown[]) => getCoverageCells(...a),
  recordCoverageCellRuns: (...a: unknown[]) => recordCoverageCellRuns(...a),
  refreshCoverageCellStats: (...a: unknown[]) => refreshCoverageCellStats(...a),
  updateCoverageCellWeights: (...a: unknown[]) =>
    updateCoverageCellWeights(...a),
}));

const csvDataSourceTablesForRepo = vi.fn();
const sheetDataSourceTablesForRepo = vi.fn();

vi.mock("@/lib/core/data-sources-reads", () => ({
  csvDataSourceTablesForRepo: (...a: unknown[]) =>
    csvDataSourceTablesForRepo(...a),
  sheetDataSourceTablesForRepo: (...a: unknown[]) =>
    sheetDataSourceTablesForRepo(...a),
}));

vi.mock("./trend", () => ({
  captureCoverageSnapshot: async () => undefined,
  backfillCoverageSnapshots: async () => undefined,
}));

vi.mock("./page-attribution", () => ({
  invalidatePageCoverageAttribution: () => undefined,
}));

import {
  syncCoverage,
  OBSERVED_OBJECT_TYPE,
  type CoverageSyncProgress,
} from "@/lib/coverage/sync";

function dimension(field: string, values: string[]): CoverageDimension {
  return {
    id: `dim-${field}`,
    repositoryId: "repo",
    environmentKey: "default",
    objectType: OBSERVED_OBJECT_TYPE,
    field,
    label: field,
    valueSource: "observed",
    sourceAlias: null,
    values,
    cardinality: values.length,
    enabled: true,
    profiledAt: null,
    createdAt: null,
    updatedAt: null,
  } as unknown as CoverageDimension;
}

function cell(i: number): CoverageCell {
  return {
    id: `cell-${i}`,
    repositoryId: "repo",
    environmentKey: "default",
    objectType: OBSERVED_OBJECT_TYPE,
    coordsKey: `country=C${i}|type=A`,
    coords: { country: `C${i}`, type: "A" },
    observedCount: 1,
    weight: 0,
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
  } as unknown as CoverageCell;
}

/**
 * Sized so both chunked stages cross their own boundary more than once:
 * attribution beats every `HEARTBEAT_CHUNK` (200) runs, and weighting persists
 * — and beats — every `WEIGHT_PERSIST_CHUNK` (500) cells, one statement per
 * chunk rather than one UPDATE per cell.
 */
const CELLS = Array.from({ length: 750 }, (_, i) => cell(i));
const RUNS = Array.from({ length: 250 }, (_, i) => ({
  testResultId: `res-${i}`,
  testId: `test-${i}`,
  buildId: `build-${i}`,
  status: "passed",
  ranAt: new Date(0),
  assignedVariables: { country: `C${i % 4}`, type: "A" },
}));

beforeEach(() => {
  getAssignedVariableRuns.mockReset().mockResolvedValue(RUNS);
  upsertCoverageDimension.mockReset().mockResolvedValue(undefined);
  getCoverageDimensions
    .mockReset()
    .mockResolvedValue([
      dimension("country", ["C0", "C1", "C2", "C3"]),
      dimension("type", ["A"]),
    ]);
  getCoverageCellObjectTypes.mockReset().mockResolvedValue([]);
  pruneCoverageCells.mockReset().mockResolvedValue(0);
  upsertCoverageCells.mockReset().mockResolvedValue(undefined);
  getCoverageCells.mockReset().mockResolvedValue(CELLS);
  recordCoverageCellRuns.mockReset().mockResolvedValue(undefined);
  refreshCoverageCellStats.mockReset().mockResolvedValue(undefined);
  updateCoverageCellWeights.mockReset().mockResolvedValue(undefined);
  csvDataSourceTablesForRepo.mockReset().mockResolvedValue([]);
  sheetDataSourceTablesForRepo.mockReset().mockResolvedValue([]);
});

describe("syncCoverage heartbeats", () => {
  it("reports every stage, in order", async () => {
    const beats: CoverageSyncProgress[] = [];
    await syncCoverage("repo", { onStage: (p) => void beats.push(p) });

    // Boundary beats, deduped to first-occurrence order.
    const order: string[] = [];
    for (const b of beats) {
      if (order[order.length - 1] !== b.stage) order.push(b.stage);
    }
    expect(order).toEqual([
      "profile",
      "derive",
      "attribute",
      "weight",
      "snapshot",
    ]);
    expect(beats.every((b) => b.label.startsWith("Coverage sync:"))).toBe(true);
  });

  it("beats inside the long stages, not just at their boundaries", async () => {
    // The watchdog fails a `running` job silent for five minutes; attribution
    // and weighting both scale with the model, so one beat per stage is not
    // enough to keep a large sync alive.
    const beats: CoverageSyncProgress[] = [];
    await syncCoverage("repo", { onStage: (p) => void beats.push(p) });

    const attribute = beats.filter((b) => b.stage === "attribute");
    const weight = beats.filter((b) => b.stage === "weight");
    expect(attribute.length).toBeGreaterThan(1);
    expect(weight.length).toBeGreaterThan(1);
    // Within-stage beats carry a position; boundary beats do not.
    expect(attribute.at(-1)).toMatchObject({ done: 200, total: 250 });
    expect(weight.at(-1)).toMatchObject({ done: 750, total: 750 });
    // Weights are persisted in the same chunks the beats report: 750 cells is
    // two statements of at most 500 rows, not 750 single-row UPDATEs.
    expect(updateCoverageCellWeights).toHaveBeenCalledTimes(2);
    expect(updateCoverageCellWeights.mock.calls[0][0]).toHaveLength(500);
    expect(updateCoverageCellWeights.mock.calls[1][0]).toHaveLength(250);
  });

  it("survives a heartbeat that throws", async () => {
    // A heartbeat is bookkeeping for the caller — a failed job-row write must
    // not throw away a completed sync.
    const result = await syncCoverage("repo", {
      onStage: () => {
        throw new Error("job row vanished");
      },
    });
    expect(result.environmentKey).toBe("default");
    expect(updateCoverageCellWeights).toHaveBeenCalled();
  });

  it("fetches each input once, and re-reads only what a stage rewrote", async () => {
    // The whole point of threading preloaded inputs through the stages. Data
    // sources resolve to their FULL file (a blob read plus a parse each time)
    // and the run scan walks up to 20,000 jsonb rows, so a stage fetching its
    // own copy is not a cheap repeat — these three were fetched two, two and
    // three times per sync respectively.
    await syncCoverage("repo");
    expect(csvDataSourceTablesForRepo).toHaveBeenCalledTimes(1);
    expect(sheetDataSourceTablesForRepo).toHaveBeenCalledTimes(1);
    expect(getAssignedVariableRuns).toHaveBeenCalledTimes(1);

    // Dimensions are written by `profile` and read once after it.
    expect(getCoverageDimensions).toHaveBeenCalledTimes(1);

    // Cells are the one thing that legitimately reads twice: `derive` writes
    // the cell set and `attribute` rewrites every counter on it in SQL, so
    // weighting must see the post-attribution rows. Sharing one read across
    // both would score the previous generation of the model.
    expect(getCoverageCells).toHaveBeenCalledTimes(2);
  });

  it("stays optional — no hook, no beats, same result", async () => {
    const result = await syncCoverage("repo");
    expect(result.attributionsRecorded).toBeGreaterThanOrEqual(0);
  });
});
