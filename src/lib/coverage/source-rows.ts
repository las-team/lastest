/**
 * Full-fidelity row access for tabular data sources.
 *
 * `csvDataSources.cachedData` is capped (MAX_CACHED_ROWS in the upload action)
 * because it backs a UI preview and matrix row-walking — it is not, and should
 * not become, the whole file. Coverage is different: profiling a 6,000-row
 * production extract off its first 1,000 rows reports record counts that are a
 * sample while presenting them as the distribution, and silently loses every
 * combination that only occurs past the cap.
 *
 * So coverage resolves rows from the stored file when the cache is short of
 * `rowCount`, and falls back to the cache (flagged truncated) when the original
 * is gone. Either way the caller learns how many rows the numbers rest on.
 */

import fs from "fs/promises";
import path from "path";
import { STORAGE_DIRS } from "@/lib/storage/paths";
import { parseCsvBuffer } from "@/lib/csv/api";
import type { CsvDataSource, GoogleSheetsDataSource } from "@/lib/db/schema";

export interface SourceTable {
  alias: string;
  headers: string[];
  rows: string[][];
  /** Rows the profile is actually based on. */
  profiledRows: number;
  /** Rows the source reports having in total. */
  totalRows: number;
  /** True when profiledRows < totalRows — the numbers are a sample. */
  truncated: boolean;
}

function fromCache(
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

/** Resolve a CSV source's rows, preferring the stored file over the cache. */
export async function loadCsvTable(
  source: CsvDataSource,
): Promise<SourceTable> {
  const cached = fromCache(
    source.alias,
    source.cachedHeaders,
    source.cachedData,
    source.rowCount,
  );
  if (!cached.truncated || !source.storagePath) return cached;

  const abs = path.join(
    STORAGE_DIRS["csv-sources"],
    source.storagePath.replace(/^\/csv-sources\//, ""),
  );
  try {
    const parsed = parseCsvBuffer(await fs.readFile(abs));
    return {
      alias: source.alias,
      headers: parsed.headers,
      rows: parsed.rows,
      profiledRows: parsed.rows.length,
      totalRows: parsed.rowCount,
      truncated: parsed.rows.length < parsed.rowCount,
    };
  } catch {
    // Original no longer on disk — the cache is all we have, and it is
    // already flagged truncated so the caveat still reaches the user.
    return cached;
  }
}

export interface SourceSampleInfo {
  objectType: string;
  profiledRows: number;
  totalRows: number;
  truncated: boolean;
}

/**
 * The sample sizes behind a repo's coverage numbers, resolved the same way
 * profiling resolves them — so the spec's disclosure can never drift from what
 * was actually read.
 */
export async function describeSources(
  csvSources: CsvDataSource[],
  sheetSources: GoogleSheetsDataSource[],
): Promise<SourceSampleInfo[]> {
  const out: SourceSampleInfo[] = [];
  for (const s of csvSources) out.push(summarize(await loadCsvTable(s)));
  for (const s of sheetSources) out.push(summarize(loadSheetTable(s)));
  return out;
}

function summarize(t: SourceTable): SourceSampleInfo {
  return {
    objectType: t.alias,
    profiledRows: t.profiledRows,
    totalRows: t.totalRows,
    truncated: t.truncated,
  };
}

/** Sheets cache their whole range and track no separate total, so the cache
 *  IS the full table — never a sample. */
export function loadSheetTable(source: GoogleSheetsDataSource): SourceTable {
  return fromCache(
    source.alias,
    source.cachedHeaders,
    source.cachedData,
    source.cachedData?.length ?? 0,
  );
}
