/**
 * Pacific-Time week boundaries for the launch board's weekly cadence.
 *
 * The board runs on America/Los_Angeles wall-clock: a cohort's voting week is
 * Monday 00:00 PT → Sunday 23:59 PT. We derive these instants from Intl
 * (no extra dependency) so the math stays correct across PST/PDT transitions.
 */

const PT_TZ = 'America/Los_Angeles';

interface PtParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** Wall-clock PT calendar/clock parts for an instant. */
export function getPtDateParts(date: Date): PtParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const hour = Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: hour === 24 ? 0 : hour, // some runtimes emit '24' for midnight
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** PT offset (PT wall-clock minus UTC) at a given instant, in ms. */
function ptOffsetMs(date: Date): number {
  const p = getPtDateParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Round to the minute to absorb the sub-second noise of the reconstruction.
  return Math.round((asUtc - date.getTime()) / 60000) * 60000;
}

/** The UTC instant for a given PT wall-clock moment. */
function fromPtWallClock(y: number, m: number, d: number, h: number, mi: number, s: number): Date {
  const guessUtc = Date.UTC(y, m - 1, d, h, mi, s);
  const off = ptOffsetMs(new Date(guessUtc));
  return new Date(guessUtc - off);
}

/** Monday 00:00:00 PT of the week containing `now`. */
export function currentWeekStartPT(now: Date = new Date()): Date {
  const p = getPtDateParts(now);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - daysSinceMonday));
  return fromPtWallClock(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, 0);
}

/** Sunday 23:59:59 PT for a cohort whose Monday-00:00-PT start is `weekStart`. */
export function weekEndPT(weekStart: Date): Date {
  const p = getPtDateParts(weekStart);
  const sunday = new Date(Date.UTC(p.year, p.month - 1, p.day + 6));
  return fromPtWallClock(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate(), 23, 59, 59);
}

/** Monday 00:00 PT of the week after the one starting at `weekStart`. */
export function nextWeekStartPT(weekStart: Date): Date {
  const p = getPtDateParts(weekStart);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 7));
  return fromPtWallClock(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0);
}

/** 'YYYY-MM' month key in PT (for "Tested Startup of the Month"). */
export function monthKeyPT(date: Date = new Date()): string {
  const p = getPtDateParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}
