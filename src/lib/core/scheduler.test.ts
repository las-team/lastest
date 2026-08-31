import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getReposWithEnabledCoverageDimensions = vi.fn();
const coverageStaleness = vi.fn();
const startCoverageSyncJob = vi.fn();
const coverageSyncStartBudget = vi.fn();

vi.mock("@/lib/db/queries/coverage", () => ({
  getReposWithEnabledCoverageDimensions: () =>
    getReposWithEnabledCoverageDimensions(),
}));

vi.mock("@/lib/coverage/sync", () => ({
  coverageStaleness: (...a: unknown[]) => coverageStaleness(...a),
  syncCoverage: vi.fn(),
}));

// Keep the real ordering/ceiling arithmetic (that is what is under test here)
// and stub only the two boundaries: the job spawn and the budget read.
vi.mock("@/lib/db/queries", () => ({}));
vi.mock("@/lib/coverage/sync-job", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/coverage/sync-job")
  >("@/lib/coverage/sync-job");
  return {
    planCoverageSyncTick: actual.planCoverageSyncTick,
    coverageSyncStartBudget: () => coverageSyncStartBudget(),
    startCoverageSyncJob: (...a: unknown[]) => startCoverageSyncJob(...a),
  };
});

import { processStaleCoverageModels } from "@/lib/core/scheduler";

const REPOS = [
  { repositoryId: "repo-a", environmentKey: "default" },
  { repositoryId: "repo-b", environmentKey: "default" },
  { repositoryId: "repo-c", environmentKey: "default" },
];
const AGES: Record<string, number> = {
  "repo-a": 1_000_000,
  "repo-b": 9_000_000,
  "repo-c": 3_000_000,
};

let logs: string[] = [];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  getReposWithEnabledCoverageDimensions.mockReset().mockResolvedValue(REPOS);
  coverageStaleness
    .mockReset()
    .mockImplementation(async (repositoryId: string) => ({
      stale: true,
      ageMs: AGES[repositoryId],
      lastSyncedAt: new Date(0),
    }));
  startCoverageSyncJob
    .mockReset()
    .mockImplementation(async (repositoryId: string) => ({
      jobId: `job-${repositoryId}`,
      deduped: false,
    }));
  coverageSyncStartBudget
    .mockReset()
    .mockResolvedValue({ budget: 2, active: 0, ceiling: 2 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processStaleCoverageModels", () => {
  it("starts at most the budget per tick, stalest repo first", async () => {
    await processStaleCoverageModels();
    // Not one detached sync per stale repo across every tenant — two.
    expect(startCoverageSyncJob).toHaveBeenCalledTimes(2);
    expect(startCoverageSyncJob.mock.calls.map((c) => c[0])).toEqual([
      "repo-b",
      "repo-c",
    ]);
  });

  it("logs what it deferred, so a silent backlog is visible", async () => {
    await processStaleCoverageModels();
    const line = logs.find((l) => l.includes("Deferred coverage re-sync"));
    expect(line).toBeDefined();
    expect(line).toContain("1 repo(s)");
    // The stalest of the deferred is named, which is what the next tick takes.
    expect(line).toContain("repo-a");
  });

  it("starts nothing when the global ceiling is already met", async () => {
    coverageSyncStartBudget.mockResolvedValue({
      budget: 0,
      active: 2,
      ceiling: 2,
    });
    await processStaleCoverageModels();
    expect(startCoverageSyncJob).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("Deferred coverage re-sync"))).toBe(
      true,
    );
  });

  it("skips fresh repos without reading the budget at all", async () => {
    coverageStaleness.mockResolvedValue({
      stale: false,
      ageMs: 1,
      lastSyncedAt: new Date(),
    });
    await processStaleCoverageModels();
    expect(coverageSyncStartBudget).not.toHaveBeenCalled();
    expect(startCoverageSyncJob).not.toHaveBeenCalled();
  });

  it("keeps going when one repo's staleness read fails", async () => {
    coverageStaleness.mockImplementation(async (repositoryId: string) => {
      if (repositoryId === "repo-b") throw new Error("snapshot read failed");
      return { stale: true, ageMs: AGES[repositoryId], lastSyncedAt: null };
    });
    await processStaleCoverageModels();
    expect(startCoverageSyncJob.mock.calls.map((c) => c[0])).toEqual([
      "repo-c",
      "repo-a",
    ]);
  });

  it("does not count a deduped join as a start", async () => {
    // The joined job is already in flight and already inside the ceiling.
    startCoverageSyncJob.mockImplementation(async (repositoryId: string) => ({
      jobId: `job-${repositoryId}`,
      deduped: true,
    }));
    await processStaleCoverageModels();
    const line = logs.find((l) => l.includes("Deferred coverage re-sync"));
    expect(line).toContain("started 0");
  });
});
