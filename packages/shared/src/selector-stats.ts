/**
 * Shared types + helpers for the selector-fallback self-healing loop.
 *
 * `locateWithFallback` (in runner, EB test-executor, and host script-runner)
 * iterates a list of `{type, value}` candidates until one matches. Without
 * stats, every run pays the full per-selector waitFor timeout for any
 * candidate that comes before the working one. The `selector_stats` table
 * (`src/lib/db/schema.ts`) records per-`(testId, hash, type, value)`
 * success/failure counts; the host sorts candidates by historical success
 * before sending the test, and each executor reports per-attempt outcomes
 * back in the test result so the host can update the table.
 *
 * Hash + sort live here (not in `@/lib/db/queries/misc.ts`) because both the
 * runner package (no DB access) and the EB image (no DB access) need to
 * compute the hash from the same selectors array the host saw, and sort the
 * stats payload they receive in the run command. Keeping this in the shared
 * package guarantees host and clients agree on the hash bytes.
 */

export interface SelectorRef {
  type: string;
  value: string;
}

export interface SelectorStatRow {
  hash: string;
  type: string;
  value: string;
  successCount: number;
  failureCount: number;
  totalAttempts: number;
  avgResponseTimeMs: number | null;
}

export interface SelectorOutcome {
  hash: string;
  type: string;
  value: string;
  success: boolean;
  responseTimeMs?: number;
}

/**
 * FNV-1a 32-bit hash over the canonical JSON of the selectors array.
 *
 * Pure JS so it works identically in Node (host + runner + EB) and the
 * browser (DOM contexts that import `@lastest/shared`). Collision-resistant
 * enough for the per-test bucketing we need; if two distinct arrays ever
 * collide, the worst case is that their stats merge — they'd still record
 * correctly per (type, value).
 */
export function hashSelectors(selectors: ReadonlyArray<SelectorRef>): string {
  const canonical = JSON.stringify(selectors.map((s) => ({ t: s.type, v: s.value })));
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Sort `selectors` by historical success rate (desc), tie-broken by avg
 * response time (asc). Selectors with no stats keep their original
 * relative order and are slotted ahead of any selector with a known
 * non-zero failure rate but behind known winners.
 *
 * Pure function — called both on the host (when building the run command)
 * and inside each executor's `locateWithFallback` (per-test-run cache).
 */
export function sortSelectorsByStats<T extends SelectorRef>(
  selectors: ReadonlyArray<T>,
  stats: ReadonlyArray<SelectorStatRow>,
): T[] {
  if (stats.length === 0) return [...selectors];

  const byKey = new Map<string, SelectorStatRow>();
  for (const row of stats) {
    byKey.set(`${row.type}::${row.value}`, row);
  }

  const score = (sel: SelectorRef): { rate: number; latency: number; known: boolean } => {
    const row = byKey.get(`${sel.type}::${sel.value}`);
    if (!row || row.totalAttempts === 0) {
      return { rate: 0, latency: Number.POSITIVE_INFINITY, known: false };
    }
    return {
      rate: row.successCount / row.totalAttempts,
      latency: row.avgResponseTimeMs ?? Number.POSITIVE_INFINITY,
      known: true,
    };
  };

  // Stable sort: pair each item with original index, sort, then strip.
  const indexed = selectors.map((sel, idx) => ({ sel, idx, s: score(sel) }));
  indexed.sort((a, b) => {
    // Known winners (rate > 0) first, by rate desc.
    if (a.s.rate !== b.s.rate) return b.s.rate - a.s.rate;
    // Then unknown selectors (no stats) ahead of known losers (rate === 0 known).
    if (a.s.known !== b.s.known) return a.s.known ? 1 : -1;
    // Among ties, faster avg latency first.
    if (a.s.latency !== b.s.latency) return a.s.latency - b.s.latency;
    // Stable on original order.
    return a.idx - b.idx;
  });
  return indexed.map((x) => x.sel);
}

/**
 * Adaptive per-candidate `waitFor` timeout for `locateWithFallback`.
 *
 * Cold start (no stats, or fewer than 3 attempts) returns the configured
 * default. Once a selector has 3+ attempts on record, we cap its budget at
 * `max(avg * 2, 500)` (clamped above by the default), so historically slow
 * or always-failing candidates are skipped sooner instead of burning the
 * full default each run. The 500ms floor avoids racing UI paint when a
 * selector's avg is artificially tiny.
 */
export function selectorTimeoutFor(
  stat: SelectorStatRow | undefined,
  defaultMs: number,
): number {
  if (!stat || stat.totalAttempts < 3 || !stat.avgResponseTimeMs) return defaultMs;
  return Math.min(defaultMs, Math.max(stat.avgResponseTimeMs * 2, 500));
}
