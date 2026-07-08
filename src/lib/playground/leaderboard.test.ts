import { describe, it, expect, vi } from "vitest";
import type { PlaygroundLeaderboardRow } from "@/lib/db/queries/playground";

// Mock the DB layer — rankBoard is pure, but the module imports the queries
// barrel (for getBoard) and we don't want a real pg client in unit tests.
vi.mock("@/lib/db/queries", () => ({
  getPlaygroundLeaderboardRows: vi.fn(),
}));

import { rankBoard } from "./leaderboard";

function row(
  over: Partial<PlaygroundLeaderboardRow>,
): PlaygroundLeaderboardRow {
  return {
    userId: "u",
    name: "User",
    achievementIds: [],
    lastEarnedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  };
}

describe("playground/leaderboard rankBoard", () => {
  it("ranks by points desc with completion bonuses applied", () => {
    const board = rankBoard([
      // 25 pts (one hard achievement)
      row({ userId: "low", achievementIds: ["tricky.dynamic-id"] }),
      // 100 pts (25 + 25 + 50 completion bonus)
      row({
        userId: "high",
        achievementIds: ["shadow-dom.first-count", "shadow-dom.count-five"],
      }),
    ]);
    expect(board.map((e) => [e.userId, e.rank, e.points])).toEqual([
      ["high", 1, 100],
      ["low", 2, 25],
    ]);
    expect(board[0].completedExercises).toBe(1);
  });

  it("breaks point ties by earliest last-achievement (first to get there wins)", () => {
    const ids = ["shadow-dom.first-count", "shadow-dom.count-five"];
    const board = rankBoard([
      row({
        userId: "later",
        achievementIds: ids,
        lastEarnedAt: new Date("2026-07-02T00:00:00Z"),
      }),
      row({
        userId: "earlier",
        achievementIds: ids,
        lastEarnedAt: new Date("2026-07-01T00:00:00Z"),
      }),
      // Missing timestamp can't claim "first" — sorts last among equals.
      row({ userId: "unknown-time", achievementIds: ids, lastEarnedAt: null }),
    ]);
    expect(board.map((e) => e.userId)).toEqual([
      "earlier",
      "later",
      "unknown-time",
    ]);
    expect(board.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("drops users whose held ids no longer score (retired registry entries)", () => {
    const board = rankBoard([
      row({ userId: "retired", achievementIds: ["old.retired-id"] }),
      row({ userId: "scorer", achievementIds: ["buttons.single-click"] }),
    ]);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ userId: "scorer", rank: 1, points: 10 });
  });

  it("accepts string timestamps from the raw aggregate", () => {
    const ids = ["buttons.single-click"];
    const board = rankBoard([
      row({
        userId: "b",
        achievementIds: ids,
        lastEarnedAt: "2026-07-02T00:00:00Z",
      }),
      row({
        userId: "a",
        achievementIds: ids,
        lastEarnedAt: "2026-07-01T00:00:00Z",
      }),
    ]);
    expect(board.map((e) => e.userId)).toEqual(["a", "b"]);
  });
});
