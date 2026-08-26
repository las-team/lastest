/**
 * P4 — profiling the system under test for REAL record distributions.
 *
 * P1 profiles from data Lastest already holds (CSV/Sheet caches, historical
 * assignedVariables). That gives value domains, but the counts are row counts
 * or run frequencies, not production volume. Only a SUT profiler can tell you
 * that 48,210 of your calls are DE/Detail and 3 are PT/Sample Drop — which is
 * the difference between a weighting that reflects business risk and one that
 * merely reflects what happens to be in a spreadsheet.
 */

import type { CoverageDimensionValue } from "../policy";

export interface ProfileQuery {
  /** Object type / table to profile ('call__v', 'orders'). */
  objectType: string;
  /** Fields to group by. One query per field for domains; all fields together
   *  for co-occurring cell counts. */
  fields: string[];
  /** Optional provider-specific filter (a VQL/SQL WHERE fragment). */
  where?: string;
  /** Cap on returned groups — a runaway GROUP BY on a free-text column must
   *  not stream millions of rows into memory. */
  limit?: number;
}

export interface ProfiledGroup {
  /** field → value for this group. */
  coords: Record<string, string>;
  count: number;
}

export interface ProfileResult {
  objectType: string;
  fields: string[];
  groups: ProfiledGroup[];
  /** True when `limit` clipped the result — the caller must not treat the
   *  returned counts as the complete distribution. */
  truncated: boolean;
}

export interface SutProfiler {
  readonly kind: "vault" | "sql" | "rest";
  /** Human-readable identity for logs and error messages. */
  readonly label: string;
  /** Cheap reachability + credential check. */
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  /** Grouped counts for the requested fields. */
  profile(query: ProfileQuery): Promise<ProfileResult>;
}

export const DEFAULT_PROFILE_LIMIT = 1000;

/** Collapse a multi-field profile down to one field's value domain. */
export function groupsToDimensionValues(
  groups: ProfiledGroup[],
  field: string,
): CoverageDimensionValue[] {
  const totals = new Map<string, number>();
  let total = 0;
  for (const g of groups) {
    const value = (g.coords[field] ?? "").trim();
    if (!value) continue;
    totals.set(value, (totals.get(value) ?? 0) + g.count);
    total += g.count;
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, recordCount]) => ({
      value,
      recordCount,
      share: total > 0 ? recordCount / total : 0,
    }));
}
