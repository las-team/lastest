import { describe, it, expect } from "vitest";
import {
  computeRunUsageProjection,
  deriveRunUsageBannerState,
  nextRunUsageResetLabel,
} from "./run-usage";

// Fixed "now" = July 18 2026 (UTC), matching the source design's example:
// 342 used over 18 elapsed days of a 31-day month → projected 589.
const JULY_18 = new Date(Date.UTC(2026, 6, 18, 12, 0, 0));

describe("computeRunUsageProjection", () => {
  it("projects month-end from the run rate so far", () => {
    const p = computeRunUsageProjection(342, 500, JULY_18);
    expect(p.daysElapsed).toBe(18);
    expect(p.daysInMonth).toBe(31);
    expect(p.projected).toBe(589); // round(342/18 * 31)
    expect(p.used).toBe(342);
    expect(p.quota).toBe(500);
    expect(p.usedPct).toBeCloseTo(0.684, 3);
    expect(p.projectedPct).toBeCloseTo(1.178, 3);
  });

  it("clamps negative usage to zero", () => {
    const p = computeRunUsageProjection(-50, 500, JULY_18);
    expect(p.used).toBe(0);
    expect(p.projected).toBe(0);
  });

  it("reports zero percentages when quota is non-positive", () => {
    const p = computeRunUsageProjection(100, 0, JULY_18);
    expect(p.usedPct).toBe(0);
    expect(p.projectedPct).toBe(0);
  });

  it("handles the first day of the month without dividing by zero", () => {
    const firstDay = new Date(Date.UTC(2026, 6, 1, 0, 0, 0));
    const p = computeRunUsageProjection(10, 500, firstDay);
    expect(p.daysElapsed).toBe(1);
    expect(p.projected).toBe(310); // 10/1 * 31
  });
});

describe("deriveRunUsageBannerState", () => {
  const base = { projected: 0, enforcementEnabled: false };

  it("is ok comfortably under quota", () => {
    expect(
      deriveRunUsageBannerState({
        ...base,
        used: 200,
        quota: 500,
        projected: 350,
      }),
    ).toBe("ok");
  });

  it("is approaching at ≥ 80% used", () => {
    expect(
      deriveRunUsageBannerState({
        ...base,
        used: 400,
        quota: 500,
        projected: 420,
      }),
    ).toBe("approaching");
  });

  it("is approaching when projected to exceed even if used is low", () => {
    expect(
      deriveRunUsageBannerState({
        ...base,
        used: 200,
        quota: 500,
        projected: 589,
      }),
    ).toBe("approaching");
  });

  it("is at_limit at quota with enforcement off", () => {
    expect(
      deriveRunUsageBannerState({
        used: 500,
        quota: 500,
        projected: 600,
        enforcementEnabled: false,
      }),
    ).toBe("at_limit");
  });

  it("is paused at quota with enforcement on", () => {
    expect(
      deriveRunUsageBannerState({
        used: 520,
        quota: 500,
        projected: 600,
        enforcementEnabled: true,
      }),
    ).toBe("paused");
  });

  it("never nags when quota is non-positive (self-hosted / unlimited)", () => {
    expect(
      deriveRunUsageBannerState({
        used: 9999,
        quota: 0,
        projected: 9999,
        enforcementEnabled: true,
      }),
    ).toBe("ok");
  });
});

describe("nextRunUsageResetLabel", () => {
  it("labels the first of next month", () => {
    expect(nextRunUsageResetLabel(JULY_18)).toBe("Aug 1");
  });

  it("wraps December to January", () => {
    expect(nextRunUsageResetLabel(new Date(Date.UTC(2026, 11, 15)))).toBe(
      "Jan 1",
    );
  });
});
