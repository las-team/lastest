import { describe, it, expect } from "vitest";

import { rankBoard, type NamedLeaderboardRow } from "./leaderboard";

/**
 * `rankBoard` was always pure, but the test used to `vi.mock("@/lib/db/queries")`
 * because importing this module pulled the app's shared `db` handle in through
 * `getBoard`. Inside the package there is nothing to mock: the handle arrives
 * from the wiring slot, so a test that only exercises the ranking never touches
 * it. Same assertions, one less lie.
 */

function row(over: Partial<NamedLeaderboardRow>): NamedLeaderboardRow {
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

  it("keeps a null display name rather than dropping the entry", () => {
    // `resolveUsers` returns a *present* user with `name: null` for someone who
    // never set one — distinct from an absent user, which `hydrate` drops. The
    // old `innerJoin` produced exactly this pair too, via `users.name`.
    const board = rankBoard([
      row({
        userId: "nameless",
        name: null,
        achievementIds: ["login.signed-in"],
      }),
    ]);
    expect(board).toHaveLength(1);
    expect(board[0].name).toBeNull();
  });
});
