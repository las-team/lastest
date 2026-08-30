import { describe, expect, it } from "vitest";
import {
  capCandidates,
  countHealAttempts,
  decideHeal,
  sameFailure,
} from "./decide";

describe("decideHeal", () => {
  const base = { hasHumanVerdict: false, attempts: 0, maxAttempts: 2 };

  it("heals only what triage called a test problem", () => {
    expect(decideHeal({ ...base, classification: "test_maintenance" })).toEqual(
      { heal: true },
    );
    expect(decideHeal({ ...base, classification: "flaky_test" })).toEqual({
      heal: true,
    });
  });

  it("never heals a real bug or an environment issue", () => {
    expect(
      decideHeal({ ...base, classification: "real_regression" }),
    ).toMatchObject({ heal: false, outcome: "skipped_real_bug" });
    expect(
      decideHeal({ ...base, classification: "environment_issue" }),
    ).toMatchObject({ heal: false, outcome: "skipped_environment" });
  });

  it("treats unknown and unclassified as not-evidence", () => {
    expect(decideHeal({ ...base, classification: "unknown" })).toMatchObject({
      heal: false,
      outcome: "skipped_unclassified",
    });
    expect(decideHeal({ ...base, classification: null })).toMatchObject({
      heal: false,
      outcome: "skipped_unclassified",
    });
  });

  it("stops at the attempt budget", () => {
    expect(
      decideHeal({ ...base, classification: "flaky_test", attempts: 2 }),
    ).toMatchObject({ heal: false, outcome: "skipped_budget" });
    expect(
      decideHeal({ ...base, classification: "flaky_test", attempts: 1 }),
    ).toEqual({ heal: true });
  });

  it("defers to a human verdict before anything else", () => {
    expect(
      decideHeal({
        ...base,
        classification: "test_maintenance",
        hasHumanVerdict: true,
      }),
    ).toMatchObject({ heal: false, outcome: "skipped_human_verdict" });
  });
});

describe("countHealAttempts", () => {
  const t = (iso: string) => new Date(iso);

  it("counts ai_fix versions since the last pass", () => {
    const versions = [
      { changeReason: "ai_fix", createdAt: t("2026-08-30T10:00:00Z") },
      { changeReason: "ai_fix", createdAt: t("2026-08-30T09:00:00Z") },
      { changeReason: "ai_fix", createdAt: t("2026-08-29T09:00:00Z") },
    ];
    expect(countHealAttempts(versions, t("2026-08-29T12:00:00Z"))).toBe(2);
    expect(countHealAttempts(versions, null)).toBe(3);
  });

  it("resets when a human edited the test after the last heal", () => {
    const versions = [
      { changeReason: "manual_edit", createdAt: t("2026-08-30T11:00:00Z") },
      { changeReason: "ai_fix", createdAt: t("2026-08-30T10:00:00Z") },
      { changeReason: "ai_fix", createdAt: t("2026-08-30T09:00:00Z") },
    ];
    expect(countHealAttempts(versions, null)).toBe(0);
  });

  it("counts an unstamped ai_fix rather than widening the budget", () => {
    expect(
      countHealAttempts(
        [{ changeReason: "ai_fix", createdAt: null }],
        t("2026-08-30T00:00:00Z"),
      ),
    ).toBe(1);
  });
});

describe("sameFailure", () => {
  it("ignores durations, ids and whitespace", () => {
    expect(
      sameFailure(
        "Timeout 30000ms waiting for getByRole('button')  id=9b2c1f4e-1111-2222-3333-444455556666",
        "Timeout 31000ms waiting for getByRole('button') id=0a1b2c3d-aaaa-bbbb-cccc-ddddeeeeffff",
      ),
    ).toBe(true);
  });

  it("is false for a different error or an empty one", () => {
    expect(sameFailure("a", "b")).toBe(false);
    expect(sameFailure("", "")).toBe(false);
    expect(sameFailure(null, "x")).toBe(false);
  });
});

describe("capCandidates", () => {
  it("splits at the cap", () => {
    expect(capCandidates([1, 2, 3], 2)).toEqual({
      selected: [1, 2],
      overflow: [3],
    });
    expect(capCandidates([1], 0)).toEqual({ selected: [], overflow: [1] });
  });
});
