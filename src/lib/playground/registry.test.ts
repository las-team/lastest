import { describe, it, expect } from "vitest";
import { ACHIEVEMENT_POINTS, EXERCISE_COMPLETION, scoreFor } from "./registry";

describe("playground/registry (vendored from lastest-www)", () => {
  it("matches the hand-off spec totals: 75 achievements / 18 exercises / max 1755", () => {
    expect(Object.keys(ACHIEVEMENT_POINTS)).toHaveLength(75);
    expect(Object.keys(EXERCISE_COMPLETION)).toHaveLength(18);

    // Max achievable must equal the frontend's maxPoints() — if they diverge,
    // the "points (of 1755)" label misreports.
    const all = scoreFor(new Set(Object.keys(ACHIEVEMENT_POINTS)));
    expect(all.points).toBe(1755);
    expect(all.completedExercises).toBe(18);
  });

  it("splits max into 1175 achievement + 580 completion points", () => {
    const achievementSum = Object.values(ACHIEVEMENT_POINTS).reduce(
      (a, b) => a + b,
      0,
    );
    const bonusSum = Object.values(EXERCISE_COMPLETION).reduce(
      (a, ex) => a + ex.bonus,
      0,
    );
    expect(achievementSum).toBe(1175);
    expect(bonusSum).toBe(580);
  });

  it("keeps the completion table consistent with the points table", () => {
    const seen = new Set<string>();
    for (const [slug, ex] of Object.entries(EXERCISE_COMPLETION)) {
      for (const id of ex.ids) {
        // Every completion id must be a scoreable id under its exercise slug…
        expect(ACHIEVEMENT_POINTS[id]).toBeGreaterThan(0);
        expect(id.startsWith(`${slug}.`)).toBe(true);
        // …and belong to exactly one exercise.
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    // Together the exercises cover the whole registry.
    expect(seen.size).toBe(Object.keys(ACHIEVEMENT_POINTS).length);
  });

  it("scores partial progress without the completion bonus", () => {
    // shadow-dom is hard (25/id, +50 bonus when both are held).
    expect(scoreFor(new Set(["shadow-dom.first-count"]))).toEqual({
      points: 25,
      completedExercises: 0,
    });
    expect(
      scoreFor(new Set(["shadow-dom.first-count", "shadow-dom.count-five"])),
    ).toEqual({ points: 100, completedExercises: 1 });
  });

  it("ignores unknown/retired ids", () => {
    expect(scoreFor(new Set(["nope.not-a-thing"]))).toEqual({
      points: 0,
      completedExercises: 0,
    });
  });
});
