import { describe, it, expect } from "vitest";
import {
  currentWeekStartPT,
  weekEndPT,
  nextWeekStartPT,
  monthKeyPT,
} from "./time";

// Read the PT wall-clock fields back so we can assert boundary correctness
// independent of the host timezone.
function ptParts(date: Date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) m[p.type] = p.value;
  if (m.hour === "24") m.hour = "00"; // some runtimes emit '24' for midnight
  return m;
}

describe("launch/time", () => {
  // A summer (PDT, UTC-7) and a winter (PST, UTC-8) instant.
  const summer = new Date("2026-07-15T18:00:00Z"); // Wed
  const winter = new Date("2026-01-14T18:00:00Z"); // Wed

  it("currentWeekStartPT lands on Monday 00:00:00 PT", () => {
    for (const now of [summer, winter]) {
      const start = currentWeekStartPT(now);
      const p = ptParts(start);
      expect(p.weekday).toBe("Mon");
      expect(p.hour).toBe("00");
      expect(p.minute).toBe("00");
      expect(p.second).toBe("00");
    }
  });

  it("the week start is at or before now", () => {
    for (const now of [summer, winter]) {
      expect(currentWeekStartPT(now).getTime()).toBeLessThanOrEqual(
        now.getTime(),
      );
    }
  });

  it("weekEndPT lands on Sunday 23:59:59 PT after the start", () => {
    for (const now of [summer, winter]) {
      const start = currentWeekStartPT(now);
      const end = weekEndPT(start);
      const p = ptParts(end);
      expect(p.weekday).toBe("Sun");
      expect(p.hour).toBe("23");
      expect(p.minute).toBe("59");
      expect(p.second).toBe("59");
      expect(end.getTime()).toBeGreaterThan(start.getTime());
      expect(now.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(now.getTime()).toBeLessThanOrEqual(end.getTime());
    }
  });

  it("nextWeekStartPT is the following Monday 00:00 PT", () => {
    const start = currentWeekStartPT(summer);
    const next = nextWeekStartPT(start);
    const p = ptParts(next);
    expect(p.weekday).toBe("Mon");
    expect(p.hour).toBe("00");
    // ~7 days later (allow ±1h for any DST shift in the span).
    const days = (next.getTime() - start.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("monthKeyPT formats YYYY-MM in PT", () => {
    expect(monthKeyPT(summer)).toBe("2026-07");
    // 2026-01-01T03:00:00Z is still Dec 31 in PT.
    expect(monthKeyPT(new Date("2026-01-01T03:00:00Z"))).toBe("2025-12");
  });
});
