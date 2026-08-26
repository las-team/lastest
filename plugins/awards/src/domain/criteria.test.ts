import { describe, it, expect } from "vitest";
import {
  computeTier,
  computeCategories,
  detectConfirmedRegression,
  applyDowngradeRule,
  maxTier,
  type BuildSnapshot,
  type RecomputeInput,
} from "./criteria";

function snap(over: Partial<BuildSnapshot> = {}): BuildSnapshot {
  return {
    buildId: "b",
    totalTests: 20,
    passedCount: 20,
    failedCount: 0,
    changesDetected: 0,
    flakyCount: 0,
    a11yScore: 95,
    a11yCriticalCount: 0,
    cleanPass: true,
    ...over,
  };
}

function input(over: Partial<RecomputeInput> = {}): RecomputeInput {
  return {
    testCount: 20,
    latestBuild: snap(),
    recentBuilds: [snap(), snap(), snap(), snap(), snap()],
    rejectedDiffCount: 0,
    rejectedDiffsLast30Days: 0,
    consecutiveNonFlakyFailures: 0,
    ...over,
  };
}

describe("maxTier", () => {
  it("picks the higher tier", () => {
    expect(maxTier("bronze", "silver")).toBe("silver");
    expect(maxTier("gold", "bronze")).toBe("gold");
    expect(maxTier("none", "bronze")).toBe("bronze");
  });
});

describe("computeTier", () => {
  it("returns none when no build", () => {
    expect(computeTier(input({ latestBuild: null }))).toBe("none");
  });

  it("returns starter when 1 passing test exists (the encourage-sharing tier)", () => {
    const latest = snap({
      totalTests: 1,
      passedCount: 1,
      failedCount: 0,
      a11yScore: 0,
    });
    expect(
      computeTier(
        input({
          testCount: 1,
          latestBuild: latest,
          recentBuilds: [latest],
        }),
      ),
    ).toBe("starter");
  });

  it("falls through to starter when below Bronze thresholds but has a passing test", () => {
    // 4 tests = below Bronze (needs 5), but at least one passes → starter.
    const latest = snap({
      totalTests: 4,
      passedCount: 3,
      failedCount: 1,
      a11yScore: 40,
    });
    expect(
      computeTier(
        input({
          testCount: 4,
          latestBuild: latest,
          recentBuilds: [latest],
        }),
      ),
    ).toBe("starter");
  });

  it("returns none when no test passes (zero passedCount)", () => {
    const latest = snap({
      totalTests: 3,
      passedCount: 0,
      failedCount: 3,
      a11yScore: 0,
    });
    expect(
      computeTier(
        input({
          testCount: 3,
          latestBuild: latest,
          recentBuilds: [latest],
        }),
      ),
    ).toBe("none");
  });

  it("awards gold for ≥20 tests + 5 clean builds + a11y ≥90 + 0 critical", () => {
    expect(computeTier(input())).toBe("gold");
  });

  it("does not award gold if a single recent build is dirty", () => {
    const dirty = snap({ cleanPass: false, failedCount: 1, passedCount: 19 });
    expect(
      computeTier(
        input({
          recentBuilds: [snap(), snap(), dirty, snap(), snap()],
        }),
      ),
    ).toBe("silver");
  });

  it("does not award gold if a11yScore < 90", () => {
    const latest = snap({ a11yScore: 85 });
    expect(
      computeTier(
        input({
          latestBuild: latest,
          recentBuilds: [latest, snap(), snap(), snap(), snap()],
        }),
      ),
    ).toBe("silver");
  });

  it("does not award gold if a11y critical > 0", () => {
    const latest = snap({ a11yCriticalCount: 1, a11yScore: 92 });
    expect(
      computeTier(
        input({
          latestBuild: latest,
          recentBuilds: [latest, snap(), snap(), snap(), snap()],
        }),
      ),
    ).toBe("bronze");
  });

  it("awards silver at the boundary: 10 tests + 95% pass + a11y 80 + 0 critical", () => {
    const latest = snap({
      totalTests: 10,
      passedCount: 10,
      a11yScore: 80,
      a11yCriticalCount: 0,
    });
    expect(
      computeTier(
        input({
          testCount: 10,
          latestBuild: latest,
          recentBuilds: [latest],
        }),
      ),
    ).toBe("silver");
  });

  it("drops to bronze when pass rate falls below 95%", () => {
    const latest = snap({
      totalTests: 20,
      passedCount: 18,
      failedCount: 2,
      a11yScore: 85,
    });
    expect(
      computeTier(
        input({
          latestBuild: latest,
          recentBuilds: [latest],
        }),
      ),
    ).toBe("bronze");
  });

  it("awards bronze at the minimum: 5 tests + 80% pass + a11y 60", () => {
    const latest = snap({
      totalTests: 5,
      passedCount: 4,
      failedCount: 1,
      a11yScore: 60,
    });
    expect(
      computeTier(
        input({
          testCount: 5,
          latestBuild: latest,
          recentBuilds: [latest],
        }),
      ),
    ).toBe("bronze");
  });

  it("falls to starter (not bronze) if pass rate below 80% but at least one passes", () => {
    const latest = snap({
      totalTests: 10,
      passedCount: 7,
      failedCount: 3,
      a11yScore: 70,
    });
    expect(
      computeTier(
        input({
          testCount: 10,
          latestBuild: latest,
          recentBuilds: [latest],
        }),
      ),
    ).toBe("starter");
  });
});

describe("computeCategories", () => {
  it("all false when no build", () => {
    expect(computeCategories(input({ latestBuild: null }))).toEqual({
      a11y: false,
      allPassing: false,
      zeroDrift: false,
    });
  });

  it("a11y true at score 90 + 0 critical", () => {
    expect(
      computeCategories(
        input({
          latestBuild: snap({ a11yScore: 90, a11yCriticalCount: 0 }),
        }),
      ).a11y,
    ).toBe(true);
  });

  it("a11y false when one critical violation present", () => {
    expect(
      computeCategories(
        input({
          latestBuild: snap({ a11yScore: 95, a11yCriticalCount: 1 }),
        }),
      ).a11y,
    ).toBe(false);
  });

  it("allPassing requires failedCount=0 AND changesDetected=0 AND totalTests>0", () => {
    expect(
      computeCategories(
        input({
          latestBuild: snap({
            totalTests: 20,
            failedCount: 0,
            changesDetected: 0,
          }),
        }),
      ).allPassing,
    ).toBe(true);
    expect(
      computeCategories(
        input({
          latestBuild: snap({ totalTests: 0 }),
        }),
      ).allPassing,
    ).toBe(false);
    expect(
      computeCategories(
        input({
          latestBuild: snap({ changesDetected: 3 }),
        }),
      ).allPassing,
    ).toBe(false);
  });

  it("zeroDrift true only when no rejected diffs in 30d", () => {
    expect(
      computeCategories(input({ rejectedDiffsLast30Days: 0 })).zeroDrift,
    ).toBe(true);
    expect(
      computeCategories(input({ rejectedDiffsLast30Days: 1 })).zeroDrift,
    ).toBe(false);
  });
});

describe("detectConfirmedRegression", () => {
  it("false when no rejected diffs and no consecutive failures", () => {
    expect(detectConfirmedRegression(input())).toBe(false);
  });

  it("true on any rejected visual diff (user explicitly rejected baseline)", () => {
    expect(detectConfirmedRegression(input({ rejectedDiffCount: 1 }))).toBe(
      true,
    );
  });

  it("false on single failed build (could be flake or transient)", () => {
    expect(
      detectConfirmedRegression(input({ consecutiveNonFlakyFailures: 1 })),
    ).toBe(false);
  });

  it("true on 2 consecutive non-flaky failures", () => {
    expect(
      detectConfirmedRegression(input({ consecutiveNonFlakyFailures: 2 })),
    ).toBe(true);
  });

  it("flakes alone never trigger, even many of them", () => {
    expect(
      detectConfirmedRegression(
        input({
          latestBuild: snap({ failedCount: 5, flakyCount: 5, passedCount: 15 }),
          consecutiveNonFlakyFailures: 0,
        }),
      ),
    ).toBe(false);
  });
});

describe("applyDowngradeRule (the ratchet)", () => {
  it("ratchets upward when no confirmed regression", () => {
    expect(
      applyDowngradeRule({
        priorCurrent: "silver",
        latestComputed: "gold",
        hasConfirmedRegression: false,
      }),
    ).toBe("gold");
  });

  it("keeps prior when no confirmed regression and new is lower", () => {
    expect(
      applyDowngradeRule({
        priorCurrent: "gold",
        latestComputed: "bronze",
        hasConfirmedRegression: false,
      }),
    ).toBe("gold");
  });

  it("downgrades to latestComputed on confirmed regression", () => {
    expect(
      applyDowngradeRule({
        priorCurrent: "gold",
        latestComputed: "bronze",
        hasConfirmedRegression: true,
      }),
    ).toBe("bronze");
    expect(
      applyDowngradeRule({
        priorCurrent: "gold",
        latestComputed: "none",
        hasConfirmedRegression: true,
      }),
    ).toBe("none");
  });
});
