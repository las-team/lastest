/**
 * Sample-size bookkeeping for resolved data-source tables.
 *
 * The rows themselves arrive already resolved — `csvDataSourceTablesForRepo`
 * in `src/lib/core/data-sources-reads.ts` reads them out of the `data-sources`
 * plugin, which owns both the row and the uploaded file. That split matters:
 * `cachedData` is capped at 1,000 rows because it backs a UI preview, and
 * profiling a 6,000-row extract off its first 1,000 reports a *sample* while
 * presenting it as the distribution. Resolving the full file is the plugin's
 * job (it owns the blob namespace); saying so honestly is this module's.
 *
 * Everything here is pure — no storage, no filesystem, no database.
 */

import type { SourceTable } from "@lastest/coverage-model";

export type { SourceTable };

export interface SourceSampleInfo {
  objectType: string;
  profiledRows: number;
  totalRows: number;
  truncated: boolean;
}

/** Build a table from a cached header/row pair that reports its own total. */
export function tableFromCache(
  alias: string,
  headers: string[] | null,
  rows: string[][] | null,
  rowCount: number | null,
): SourceTable {
  const data = rows ?? [];
  const total = rowCount ?? data.length;
  return {
    alias,
    headers: headers ?? [],
    rows: data,
    profiledRows: data.length,
    totalRows: total,
    truncated: data.length < total,
  };
}

export function summarize(t: SourceTable): SourceSampleInfo {
  return {
    objectType: t.alias,
    profiledRows: t.profiledRows,
    totalRows: t.totalRows,
    truncated: t.truncated,
  };
}

/**
 * The sample sizes behind a repo's coverage numbers, taken from the same
 * tables profiling read — so the spec's disclosure can never drift from what
 * was actually measured.
 */
export function describeSources(tables: SourceTable[]): SourceSampleInfo[] {
  return tables.map(summarize);
}
