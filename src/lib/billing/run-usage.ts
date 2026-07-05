/**
 * Run-minute usage projection + banner-state derivation.
 *
 * Pure, dependency-free helpers shared by the billing "Run usage analytics"
 * card and the app-wide usage banner so both derive the same numbers from the
 * same rules (single source of truth). No DB / React imports on purpose —
 * unit-tested in run-usage.test.ts.
 *
 * Quota is denominated in run-minutes (plans.ts / Stripe product metadata),
 * matching `teams.monthlyRunQuota` and `getTeamRunUsage`.
 */

export type RunUsageBannerState = "ok" | "approaching" | "at_limit" | "paused";

/** Threshold at which the "approaching" banner starts showing. */
export const APPROACHING_THRESHOLD = 0.8;

/**
 * Sentinel repo id for the aggregated "Other" bucket in the run usage
 * analytics breakdown. Lives here (not in the server-only queries module) so
 * the client analytics card can import it without pulling in `db`.
 */
export const RUN_ANALYTICS_OTHER_ID = "__other__";

export interface RunUsageProjection {
  /** Run-minutes used so far this month (clamped ≥ 0). */
  used: number;
  /** Monthly run-minute quota. */
  quota: number;
  /** UTC day-of-month elapsed (1-based), clamped to the month length. */
  daysElapsed: number;
  /** Number of days in the current UTC month. */
  daysInMonth: number;
  /** Linear month-end projection: round(used / daysElapsed * daysInMonth). */
  projected: number;
  /** used / quota (0 when quota ≤ 0). */
  usedPct: number;
  /** projected / quota (0 when quota ≤ 0). */
  projectedPct: number;
}

/**
 * Straight-line projection of month-end run-minutes from the run rate so far.
 * `now` is injectable for deterministic tests; defaults to wall-clock.
 */
export function computeRunUsageProjection(
  used: number,
  quota: number,
  now: Date = new Date(),
): RunUsageProjection {
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const daysElapsed = Math.min(now.getUTCDate(), daysInMonth);
  const safeUsed = Math.max(0, used);
  const rate = daysElapsed > 0 ? safeUsed / daysElapsed : 0;
  const projected = Math.round(rate * daysInMonth);
  return {
    used: safeUsed,
    quota,
    daysElapsed,
    daysInMonth,
    projected,
    usedPct: quota > 0 ? safeUsed / quota : 0,
    projectedPct: quota > 0 ? projected / quota : 0,
  };
}

/**
 * Which usage banner (if any) to show, given current usage and whether
 * run-minute enforcement is on. Mirrors the design's specimen thresholds:
 *  - paused:      used ≥ quota AND enforcement on  (runs blocked, persistent)
 *  - at_limit:    used ≥ quota AND enforcement off (display-only, dismissible)
 *  - approaching: used ≥ 80% OR projected ≥ 100%, but under quota (dismissible)
 *  - ok:          otherwise (no banner)
 */
export function deriveRunUsageBannerState(params: {
  used: number;
  quota: number;
  projected: number;
  enforcementEnabled: boolean;
}): RunUsageBannerState {
  const { used, quota, projected, enforcementEnabled } = params;
  // No meaningful quota (self-hosted / unlimited) → never nag.
  if (quota <= 0) return "ok";
  if (used >= quota) return enforcementEnabled ? "paused" : "at_limit";
  if (used >= quota * APPROACHING_THRESHOLD || projected >= quota) {
    return "approaching";
  }
  return "ok";
}

const MONTHS_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Short label for when counters reset — the 1st of next UTC month, e.g.
 * "Aug 1". Used in the at-limit / paused banner copy.
 */
export function nextRunUsageResetLabel(now: Date = new Date()): string {
  const nextMonth = (now.getUTCMonth() + 1) % 12;
  return `${MONTHS_ABBR[nextMonth]} 1`;
}
