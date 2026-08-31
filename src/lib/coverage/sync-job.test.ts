import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const countActiveBackgroundJobsByType = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  countActiveBackgroundJobsByType: (...a: unknown[]) =>
    countActiveBackgroundJobsByType(...a),
  getActiveBackgroundJobsForRepo: vi.fn(),
  updateBackgroundJob: vi.fn(),
  getBackgroundJob: vi.fn(),
}));

// The sync itself is exercised in sync.test.ts; this file is about the
// scheduler's fan-out ceiling, so keep the sync module (and its DB/CSV import
// graph) out of the way.
vi.mock("@/lib/coverage/sync", () => ({
  syncCoverage: vi.fn(),
}));

import {
  coverageSyncMaxConcurrent,
  coverageSyncStartBudget,
  planCoverageSyncTick,
  type CoverageSyncCandidate,
} from "@/lib/coverage/sync-job";

function candidate(repositoryId: string, ageMs: number): CoverageSyncCandidate {
  return { repositoryId, environmentKey: "default", ageMs };
}

beforeEach(() => {
  countActiveBackgroundJobsByType.mockReset().mockResolvedValue(0);
});
afterEach(() => {
  delete process.env.COVERAGE_SYNC_MAX_CONCURRENT;
});

describe("coverageSyncMaxConcurrent", () => {
  it("defaults to 2 and is env-tunable", () => {
    expect(coverageSyncMaxConcurrent()).toBe(2);
    process.env.COVERAGE_SYNC_MAX_CONCURRENT = "5";
    expect(coverageSyncMaxConcurrent()).toBe(5);
  });

  it("ignores junk and non-positive overrides", () => {
    process.env.COVERAGE_SYNC_MAX_CONCURRENT = "nonsense";
    expect(coverageSyncMaxConcurrent()).toBe(2);
    process.env.COVERAGE_SYNC_MAX_CONCURRENT = "0";
    expect(coverageSyncMaxConcurrent()).toBe(2);
  });
});

describe("coverageSyncStartBudget", () => {
  it("counts syncs in flight across ALL teams, not just one", async () => {
    countActiveBackgroundJobsByType.mockResolvedValue(1);
    const { budget, active, ceiling } = await coverageSyncStartBudget();
    expect(countActiveBackgroundJobsByType).toHaveBeenCalledWith(
      "coverage_sync",
    );
    expect({ budget, active, ceiling }).toEqual({
      budget: 1,
      active: 1,
      ceiling: 2,
    });
  });

  it("never goes negative when the ceiling is already exceeded", async () => {
    // A user-started sync is deliberately not throttled, so in-flight can be
    // above the ceiling; that must mean "start nothing", not a negative budget.
    countActiveBackgroundJobsByType.mockResolvedValue(7);
    expect((await coverageSyncStartBudget()).budget).toBe(0);
  });
});

describe("planCoverageSyncTick", () => {
  const CANDIDATES = [
    candidate("repo-fresh-ish", 1_000),
    candidate("repo-never-synced", Infinity),
    candidate("repo-old", 900_000),
  ];

  it("starts the stalest first and defers the rest", () => {
    const { start, deferred } = planCoverageSyncTick(CANDIDATES, 2);
    expect(start.map((c) => c.repositoryId)).toEqual([
      "repo-never-synced",
      "repo-old",
    ]);
    expect(deferred.map((c) => c.repositoryId)).toEqual(["repo-fresh-ish"]);
  });

  it("does not starve the tail: order comes from age, not list position", () => {
    // Reversing the input must not change who runs — that is the whole point
    // of ordering by staleness instead of taking the head of the repo list.
    const { start } = planCoverageSyncTick([...CANDIDATES].reverse(), 1);
    expect(start.map((c) => c.repositoryId)).toEqual(["repo-never-synced"]);
  });

  it("defers everything when there is no budget left", () => {
    const { start, deferred } = planCoverageSyncTick(CANDIDATES, 0);
    expect(start).toEqual([]);
    expect(deferred).toHaveLength(3);
  });

  it("leaves the caller's array untouched", () => {
    const input = [...CANDIDATES];
    planCoverageSyncTick(input, 2);
    expect(input.map((c) => c.repositoryId)).toEqual(
      CANDIDATES.map((c) => c.repositoryId),
    );
  });
});
