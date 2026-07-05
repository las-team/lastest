import { describe, it, expect } from "vitest";
import {
  getWcagLevel,
  calculateWcagScore,
  aggregateA11yForBuild,
} from "./wcag-score";
import type { A11yViolation } from "@/lib/db/schema";

function makeViolation(overrides: Partial<A11yViolation> = {}): A11yViolation {
  return {
    id: "test-rule",
    impact: "moderate",
    description: "Test violation",
    help: "Fix it",
    helpUrl: "https://example.com",
    nodes: 1,
    ...overrides,
  };
}

describe("WCAG Score Utilities", () => {
  describe("getWcagLevel", () => {
    it("returns undefined for undefined tags", () => {
      expect(getWcagLevel(undefined)).toBeUndefined();
    });

    it("returns undefined for empty tags", () => {
      expect(getWcagLevel([])).toBeUndefined();
    });

    it("returns undefined for non-WCAG tags", () => {
      expect(getWcagLevel(["best-practice", "cat.color"])).toBeUndefined();
    });

    it("detects WCAG 2.0 level A", () => {
      expect(getWcagLevel(["wcag2a", "wcag111"])).toBe("A");
    });

    it("detects WCAG 2.0 level AA", () => {
      expect(getWcagLevel(["wcag2aa", "wcag143"])).toBe("AA");
    });

    it("detects WCAG 2.0 level AAA", () => {
      expect(getWcagLevel(["wcag2aaa", "wcag146"])).toBe("AAA");
    });

    it("detects WCAG 2.1 variants", () => {
      expect(getWcagLevel(["wcag21a"])).toBe("A");
      expect(getWcagLevel(["wcag21aa"])).toBe("AA");
    });

    it("detects WCAG 2.2 variants", () => {
      expect(getWcagLevel(["wcag22aa"])).toBe("AA");
      expect(getWcagLevel(["wcag22aaa"])).toBe("AAA");
    });

    it("returns highest level when multiple present (AAA > AA > A)", () => {
      expect(getWcagLevel(["wcag2a", "wcag2aaa"])).toBe("AAA");
      expect(getWcagLevel(["wcag2a", "wcag2aa"])).toBe("AA");
    });
  });

  // Calibrated model (spec §3.5): a weighted PASS-RATIO with a bounded
  // per-rule penalty, replacing the old unbounded 100−Σdeduction that snapped
  // realistic pages to 0. Assertions are properties + ranges (the exact old
  // per-rule deduction values encoded the bug and are gone).
  describe("calculateWcagScore", () => {
    it("returns score 100 for no violations", () => {
      const result = calculateWcagScore([]);
      expect(result.score).toBe(100);
      expect(result.violatedRules).toBe(0);
      expect(result.bySeverity).toEqual({
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0,
      });
    });

    it("counts passedRules from passesCount param", () => {
      const result = calculateWcagScore([], 42);
      expect(result.passedRules).toBe(42);
      expect(result.totalRules).toBe(42);
    });

    it("defaults passedRules to 0 when not provided", () => {
      const result = calculateWcagScore([]);
      expect(result.passedRules).toBe(0);
    });

    it("keeps every score in [0, 100]", () => {
      const many = Array.from({ length: 40 }, () =>
        makeViolation({ impact: "critical", nodes: 5, wcagLevel: "A" }),
      );
      expect(calculateWcagScore(many).score).toBeGreaterThanOrEqual(0);
      expect(calculateWcagScore(many).score).toBeLessThanOrEqual(100);
      expect(calculateWcagScore([], 50).score).toBeLessThanOrEqual(100);
    });

    it("ranks severity: critical hurts more than serious > moderate > minor", () => {
      // Fewer passes so the penalty differences separate after rounding (at very
      // high pass counts every single-violation score rounds toward 100).
      const s = (impact: A11yViolation["impact"]) =>
        calculateWcagScore(
          [makeViolation({ impact, nodes: 2, wcagLevel: "AA" })],
          10,
        ).score;
      expect(s("critical")).toBeLessThan(s("serious"));
      expect(s("serious")).toBeLessThan(s("moderate"));
      expect(s("moderate")).toBeLessThan(s("minor"));
    });

    it("caps node impact at 3 (nodes=3 and nodes=100 score the same)", () => {
      const at3 = calculateWcagScore(
        [makeViolation({ impact: "critical", nodes: 3, wcagLevel: "AA" })],
        40,
      ).score;
      const at100 = calculateWcagScore(
        [makeViolation({ impact: "critical", nodes: 100, wcagLevel: "AA" })],
        40,
      ).score;
      expect(at3).toBe(at100);
    });

    it("softens level A relative to AA (small gap, not 1.5×)", () => {
      const a = calculateWcagScore(
        [makeViolation({ impact: "serious", nodes: 3, wcagLevel: "A" })],
        40,
      ).score;
      const aa = calculateWcagScore(
        [makeViolation({ impact: "serious", nodes: 3, wcagLevel: "AA" })],
        40,
      ).score;
      expect(a).toBeLessThanOrEqual(aa);
      expect(aa - a).toBeLessThan(8);
    });

    it("rewards passing more checks (pass-ratio buoyancy)", () => {
      const violations = [
        makeViolation({ impact: "serious", nodes: 3, wcagLevel: "AA" }),
        makeViolation({
          id: "2",
          impact: "moderate",
          nodes: 2,
          wcagLevel: "AA",
        }),
      ];
      const few = calculateWcagScore(violations, 10).score;
      const many = calculateWcagScore(violations, 80).score;
      expect(many).toBeGreaterThan(few);
    });

    it("scores a polished site (many passes, few minor/moderate) in the A/B band", () => {
      const score = calculateWcagScore(
        [
          makeViolation({ impact: "moderate", nodes: 2, wcagLevel: "AA" }),
          makeViolation({
            id: "2",
            impact: "moderate",
            nodes: 1,
            wcagLevel: "AA",
          }),
          makeViolation({
            id: "3",
            impact: "minor",
            nodes: 4,
            wcagLevel: "AA",
          }),
        ],
        50,
      ).score;
      expect(score).toBeGreaterThanOrEqual(80);
    });

    it("does NOT collapse to 0 on a realistic page tripping several rules", () => {
      const violations = [
        makeViolation({
          id: "1",
          impact: "critical",
          nodes: 8,
          wcagLevel: "A",
        }),
        makeViolation({
          id: "2",
          impact: "serious",
          nodes: 5,
          wcagLevel: "AA",
        }),
        makeViolation({
          id: "3",
          impact: "serious",
          nodes: 3,
          wcagLevel: "AA",
        }),
        makeViolation({
          id: "4",
          impact: "moderate",
          nodes: 4,
          wcagLevel: "AA",
        }),
        makeViolation({ id: "5", impact: "minor", nodes: 6, wcagLevel: "AA" }),
      ];
      const score = calculateWcagScore(violations, 45).score;
      expect(score).toBeGreaterThan(30);
      expect(score).toBeLessThan(95);
    });

    it("degrades gracefully with no passes captured (no snap to 0 on one violation)", () => {
      const score = calculateWcagScore([
        makeViolation({ impact: "serious", nodes: 3, wcagLevel: "AA" }),
      ]).score;
      expect(score).toBeGreaterThan(50);
      expect(score).toBeLessThan(100);
    });

    it("is monotonic: adding a violation never raises the score", () => {
      const base = [
        makeViolation({ impact: "moderate", nodes: 2, wcagLevel: "AA" }),
      ];
      const worse = [
        ...base,
        makeViolation({
          id: "x",
          impact: "critical",
          nodes: 3,
          wcagLevel: "A",
        }),
      ];
      expect(calculateWcagScore(worse, 40).score).toBeLessThanOrEqual(
        calculateWcagScore(base, 40).score,
      );
    });

    it("counts bySeverity correctly for mixed violations", () => {
      const violations = [
        makeViolation({ id: "1", impact: "critical" }),
        makeViolation({ id: "2", impact: "critical" }),
        makeViolation({ id: "3", impact: "serious" }),
        makeViolation({ id: "4", impact: "moderate" }),
        makeViolation({ id: "5", impact: "minor" }),
      ];
      const result = calculateWcagScore(violations);
      expect(result.bySeverity).toEqual({
        critical: 2,
        serious: 1,
        moderate: 1,
        minor: 1,
      });
      expect(result.violatedRules).toBe(5);
    });
  });

  describe("aggregateA11yForBuild", () => {
    it("returns perfect score for empty results", () => {
      const result = aggregateA11yForBuild([]);
      expect(result.score).toBe(100);
      expect(result.violationCount).toBe(0);
      expect(result.criticalCount).toBe(0);
    });

    it("handles results with null/undefined violations", () => {
      const result = aggregateA11yForBuild([
        { a11yViolations: null, a11yPassesCount: 10 },
        { a11yViolations: undefined, a11yPassesCount: null },
      ]);
      expect(result.score).toBe(100);
      expect(result.totalRulesChecked).toBe(10);
    });

    it("aggregates violations across multiple results", () => {
      const result = aggregateA11yForBuild([
        {
          a11yViolations: [
            makeViolation({ impact: "critical", wcagLevel: "AA", nodes: 1 }),
          ],
          a11yPassesCount: 10,
        },
        {
          a11yViolations: [
            makeViolation({ impact: "serious", wcagLevel: "AA", nodes: 1 }),
          ],
          a11yPassesCount: 5,
        },
      ]);
      expect(result.violationCount).toBe(2);
      expect(result.totalRulesChecked).toBe(17); // 15 passes + 2 violations
    });

    it("counts criticalCount as critical + serious", () => {
      const result = aggregateA11yForBuild([
        {
          a11yViolations: [
            makeViolation({ id: "1", impact: "critical", wcagLevel: "AA" }),
            makeViolation({ id: "2", impact: "serious", wcagLevel: "AA" }),
            makeViolation({ id: "3", impact: "moderate", wcagLevel: "AA" }),
          ],
          a11yPassesCount: 0,
        },
      ]);
      expect(result.criticalCount).toBe(2); // 1 critical + 1 serious
    });
  });
});
