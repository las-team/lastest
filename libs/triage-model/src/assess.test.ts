import { describe, expect, it } from "vitest";

import {
  deriveRunCounts,
  describeAge,
  groupRisk,
  rankGroups,
  suggestVerdict,
  triageCaseKey,
  type AssessCase,
  type AssessGroup,
  type RankableGroup,
} from "./assess";

function testCase(over: Partial<AssessCase> & { testId: string }): AssessCase {
  return { status: "failed", ...over };
}

function group(over: Partial<AssessGroup> & { key: string }): AssessGroup {
  return {
    kind: "unknown",
    confidence: 80,
    cases: [testCase({ testId: "t1" })],
    ...over,
  };
}

describe("groupRisk", () => {
  it("is low for a lone visual noise case", () => {
    expect(
      groupRisk(
        group({
          key: "g",
          kind: "noise",
          cases: [testCase({ testId: "t1", layers: ["visual"] })],
        }),
      ),
    ).toBe("low");
  });

  it("is medium for a small single-browser visual cluster", () => {
    expect(
      groupRisk(
        group({
          key: "g",
          kind: "maintenance",
          cases: [
            testCase({ testId: "t1", browser: "chromium", layers: ["visual"] }),
            testCase({ testId: "t2", browser: "chromium", layers: ["visual"] }),
          ],
        }),
      ),
    ).toBe("medium");
  });

  it("is high for a regression across browsers with a high-signal layer", () => {
    expect(
      groupRisk(
        group({
          key: "g",
          kind: "regression",
          cases: [
            testCase({
              testId: "t1",
              browser: "chromium",
              layers: ["console"],
            }),
            testCase({ testId: "t2", browser: "webkit", layers: ["visual"] }),
          ],
        }),
      ),
    ).toBe("high");
  });

  it("prefers explicit browsers/layers over the ones on the cases", () => {
    expect(
      groupRisk(
        group({
          key: "g",
          kind: "regression",
          browsers: ["chromium", "firefox"],
          layers: ["network"],
          cases: [testCase({ testId: "t1" })],
        }),
      ),
    ).toBe("high");
  });
});

describe("suggestVerdict", () => {
  it("maps the confident classifications", () => {
    expect(suggestVerdict(group({ key: "a", kind: "regression" }))).toBe("bug");
    expect(suggestVerdict(group({ key: "b", kind: "flake" }))).toBe(
      "flaky_retry",
    );
    expect(suggestVerdict(group({ key: "c", kind: "noise" }))).toBe(
      "false_positive",
    );
  });

  it("returns null for environment and unknown", () => {
    expect(suggestVerdict(group({ key: "d", kind: "environment" }))).toBeNull();
    expect(suggestVerdict(group({ key: "e", kind: "unknown" }))).toBeNull();
  });

  it("splits maintenance by signal", () => {
    expect(
      suggestVerdict(
        group({ key: "f", kind: "maintenance", layers: ["visual", "dom"] }),
      ),
    ).toBe("new_baseline");
    expect(
      suggestVerdict(
        group({ key: "g", kind: "maintenance", layers: ["visual", "network"] }),
      ),
    ).toBe("bug");
  });

  it("declines below the confidence floor", () => {
    expect(
      suggestVerdict(group({ key: "h", kind: "regression", confidence: 39 })),
    ).toBeNull();
    expect(
      suggestVerdict(group({ key: "i", kind: "regression", confidence: 40 })),
    ).toBe("bug");
  });
});

describe("rankGroups", () => {
  const mk = (over: Partial<RankableGroup> & { key: string }): RankableGroup =>
    ({ ...group({ key: over.key }), ...over }) as RankableGroup;

  it("puts regressions first and noise last", () => {
    const ordered = rankGroups([
      mk({ key: "noise", kind: "noise" }),
      mk({ key: "flake", kind: "flake" }),
      mk({ key: "reg", kind: "regression" }),
      mk({ key: "maint", kind: "maintenance" }),
    ]);
    expect(ordered.map((g) => g.key)).toEqual([
      "reg",
      "maint",
      "flake",
      "noise",
    ]);
  });

  it("breaks kind ties by risk, then size, then confidence, then key", () => {
    const ordered = rankGroups([
      mk({ key: "b", kind: "regression", risk: "low", confidence: 90 }),
      mk({ key: "a", kind: "regression", risk: "low", confidence: 90 }),
      mk({ key: "c", kind: "regression", risk: "low", confidence: 95 }),
      mk({
        key: "d",
        kind: "regression",
        risk: "low",
        confidence: 95,
        cases: [testCase({ testId: "1" }), testCase({ testId: "2" })],
      }),
      mk({ key: "e", kind: "regression", risk: "high" }),
    ]);
    expect(ordered.map((g) => g.key)).toEqual(["e", "d", "c", "a", "b"]);
  });

  it("does not mutate the input and is stable across repeated calls", () => {
    const input = [
      mk({ key: "z", kind: "noise" }),
      mk({ key: "a", kind: "regression" }),
    ];
    const first = rankGroups(input);
    const second = rankGroups(input);
    expect(input.map((g) => g.key)).toEqual(["z", "a"]);
    expect(first.map((g) => g.key)).toEqual(second.map((g) => g.key));
  });
});

describe("deriveRunCounts", () => {
  const cases: AssessCase[] = [
    testCase({ testId: "t1", status: "failed" }),
    testCase({ testId: "t2", status: "review", stepLabel: "step-1" }),
    testCase({ testId: "t3", status: "review" }),
  ];

  it("counts statuses with no verdicts recorded", () => {
    const counts = deriveRunCounts(cases);
    expect(counts).toMatchObject({
      total: 3,
      failed: 1,
      review: 2,
      passed: 0,
      resolved: 0,
      undecided: 3,
    });
    expect(counts.byVerdict.bug).toBe(0);
  });

  it("counts resolved and cleared cases from the verdict map", () => {
    const counts = deriveRunCounts(cases, {
      [triageCaseKey("t1", null)]: { verdict: "bug" },
      [triageCaseKey("t2", "step-1")]: { verdict: "new_baseline" },
    });
    expect(counts.resolved).toBe(2);
    expect(counts.undecided).toBe(1);
    expect(counts.passed).toBe(1);
    expect(counts.byVerdict.bug).toBe(1);
    expect(counts.byVerdict.new_baseline).toBe(1);
  });

  it("ignores a verdict whose step label does not match", () => {
    const counts = deriveRunCounts(cases, {
      [triageCaseKey("t2", "other-step")]: { verdict: "bug" },
    });
    expect(counts.resolved).toBe(0);
  });
});

describe("describeAge", () => {
  const order = ["b1", "b2", "b3"];

  it("calls the current build new", () => {
    expect(describeAge("b3", order)).toBe("new this run");
    expect(describeAge(null, order)).toBe("new this run");
  });

  it("counts runs from the oldest known build", () => {
    expect(describeAge("b1", order)).toBe("present since run 1");
    expect(describeAge("b2", order)).toBe("present since run 2");
  });

  it("falls back when the build is outside the window", () => {
    expect(describeAge("b0", order)).toBe("present since an earlier run");
  });
});
