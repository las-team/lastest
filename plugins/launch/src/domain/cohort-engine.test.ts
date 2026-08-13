import { describe, it, expect, vi, beforeEach } from "vitest";

import type { LaunchCohort, LaunchProfile } from "../schema";

/**
 * Mock the plugin's own query module so we exercise the pure transition logic
 * of the engine.
 *
 * The mock target changed with the migration: it used to be `@/lib/db/queries`,
 * the app-wide barrel over all 98 tables. It is now `../data/queries`, which is
 * the plugin's seven. Each function also takes the injected handle as its first
 * argument, so the assertions below carry a leading `db` — stubbed as `null`,
 * since nothing under test dereferences it.
 */
vi.mock("../data/queries", () => ({
  getCohortByWeekStart: vi.fn(),
  createCohort: vi.fn(),
  listCohortsByStateAsc: vi.fn(),
  setCohortState: vi.fn(),
  clearSuspiciousVotes: vi.fn(),
  listFeaturedProfilesByCohort: vi.fn(),
  getCohortById: vi.fn(),
  lockCohortWinner: vi.fn(),
}));

// `processLaunchCohorts` resolves its handle from the wiring slot, so the slot
// has to hold *something*. `orm()` is a cast over whatever `data.db` is, and
// the query layer is mocked out, so a bare object suffices.
vi.mock("../data/db", async () => {
  const actual =
    await vi.importActual<typeof import("../data/db")>("../data/db");
  return { ...actual, db: () => null };
});

import * as queries from "../data/queries";
import { processLaunchCohorts } from "./cohort-engine";

const q = queries as unknown as Record<string, ReturnType<typeof vi.fn>>;

function cohort(over: Partial<LaunchCohort>): LaunchCohort {
  return {
    id: "c1",
    weekStartAt: new Date("2026-07-13T07:00:00Z"),
    weekEndAt: new Date("2026-07-20T06:59:59Z"),
    state: "open",
    winnerSlug: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as LaunchCohort;
}

describe("launch/cohort-engine processLaunchCohorts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ensureUpcomingCohort: pretend both weeks already exist (no-op create).
    q.getCohortByWeekStart.mockResolvedValue(cohort({ id: "existing" }));
    q.listCohortsByStateAsc.mockResolvedValue([]);
    q.listFeaturedProfilesByCohort.mockResolvedValue([]);
    q.getCohortById.mockResolvedValue(cohort({}));
  });

  it("flips an open cohort whose week has started → voting", async () => {
    const now = new Date("2026-07-15T12:00:00Z"); // mid-week
    q.listCohortsByStateAsc.mockImplementation(
      async (_db: unknown, states: string[]) =>
        states.includes("open")
          ? [
              cohort({
                id: "op",
                state: "open",
                weekStartAt: new Date("2026-07-13T07:00:00Z"),
              }),
            ]
          : [],
    );
    await processLaunchCohorts(now);
    expect(q.setCohortState).toHaveBeenCalledWith(null, "op", "voting");
  });

  it("does NOT flip an open cohort whose week has not started yet", async () => {
    const now = new Date("2026-07-15T12:00:00Z");
    q.listCohortsByStateAsc.mockImplementation(
      async (_db: unknown, states: string[]) =>
        states.includes("open")
          ? [
              cohort({
                id: "future",
                state: "open",
                weekStartAt: new Date("2026-07-20T07:00:00Z"),
              }),
            ]
          : [],
    );
    await processLaunchCohorts(now);
    expect(q.setCohortState).not.toHaveBeenCalledWith(null, "future", "voting");
  });

  it("locks a voting cohort whose week has ended (clears + picks winner)", async () => {
    const now = new Date("2026-07-21T12:00:00Z"); // after weekEnd
    const ended = cohort({
      id: "vt",
      state: "voting",
      weekEndAt: new Date("2026-07-20T06:59:59Z"),
    });
    q.listCohortsByStateAsc.mockImplementation(
      async (_db: unknown, states: string[]) =>
        states.includes("voting") ? [ended] : [],
    );
    q.getCohortById.mockResolvedValue(ended);
    q.listFeaturedProfilesByCohort.mockResolvedValue([
      {
        slug: "a",
        upvoteCount: 2,
        createdAt: new Date("2026-07-13T08:00:00Z"),
      } as LaunchProfile,
      {
        slug: "b",
        upvoteCount: 9,
        createdAt: new Date("2026-07-13T08:00:00Z"),
      } as LaunchProfile,
    ]);
    await processLaunchCohorts(now);
    expect(q.clearSuspiciousVotes).toHaveBeenCalledWith(null, "vt");
    expect(q.lockCohortWinner).toHaveBeenCalledWith(null, "vt", "b"); // highest velocity
  });

  it("closes a locked cohort once a newer week has begun", async () => {
    const now = new Date("2026-07-27T12:00:00Z"); // week of Jul 27
    q.listCohortsByStateAsc.mockImplementation(
      async (_db: unknown, states: string[]) =>
        states.includes("locked")
          ? [
              cohort({
                id: "lk",
                state: "locked",
                weekStartAt: new Date("2026-07-13T07:00:00Z"),
              }),
            ]
          : [],
    );
    await processLaunchCohorts(now);
    expect(q.setCohortState).toHaveBeenCalledWith(null, "lk", "closed");
  });
});
