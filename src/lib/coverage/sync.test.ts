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

vi.mock("@/lib/core/data-sources-reads", () => ({
  csvDataSourceTablesForRepo: async () => [],
  sheetDataSourceTablesForRepo: async () => [],
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

/** 250 of each, so both chunked stages cross the 200-row heartbeat boundary. */
const CELLS = Array.from({ length: 250 }, (_, i) => cell(i));
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
    expect(weight.at(-1)).toMatchObject({ done: 250, total: 250 });
    // Weights are persisted in the same chunks the beats report.
    expect(updateCoverageCellWeights).toHaveBeenCalledTimes(2);
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

  it("stays optional — no hook, no beats, same result", async () => {
    const result = await syncCoverage("repo");
    expect(result.attributionsRecorded).toBeGreaterThanOrEqual(0);
  });
});
