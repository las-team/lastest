/**
 * Dimension profiling — deriving enumerable value domains from data Lastest
 * already holds. No system-under-test connector required (that is D3).
 *
 * Two sources in P1:
 *   1. csvDataSources / googleSheetsDataSources cached tables — a column with
 *      bounded cardinality IS a dimension, and its row distribution gives real
 *      value shares.
 *   2. test_results.assignedVariables — the resolved assign-mode variable map,
 *      already persisted per run. Each variable name is a candidate dimension.
 */

import type {
  CoverageDimensionValue,
  CoverageValueSource,
  CsvDataSource,
  GoogleSheetsDataSource,
} from "@/lib/db/schema";
import { DEFAULT_COVERAGE_STOP_POLICY } from "@/lib/db/schema";

export interface ProfiledDimension {
  objectType: string;
  field: string;
  label?: string;
  valueSource: CoverageValueSource;
  sourceAlias?: string;
  values: CoverageDimensionValue[];
  cardinality: number;
  /** Why a candidate column was not proposed as a dimension. Present only on
   *  rejected candidates — kept so the UI can explain the omission. */
  rejectedReason?: string;
}

export interface ProfileOptions {
  /** Columns with more distinct values than this are rejected as free text. */
  maxCardinality?: number;
  /** Reject columns where distinct/total exceeds this — near-unique columns
   *  (ids, emails, timestamps) are identifiers, not dimensions. */
  maxDistinctRatio?: number;
  /** Columns with fewer than this many distinct values carry no information. */
  minCardinality?: number;
  /** The distinct-ratio test is only meaningful on a reasonable sample — over
   *  3 rows, two countries look exactly like two identifiers. Below this row
   *  count the ratio check is skipped and only the cardinality caps apply. */
  minRowsForRatio?: number;
}

const DEFAULTS: Required<ProfileOptions> = {
  maxCardinality: DEFAULT_COVERAGE_STOP_POLICY.maxDimensionCardinality,
  maxDistinctRatio: 0.5,
  minCardinality: 2,
  minRowsForRatio: 20,
};

/** Count distinct values and turn them into a share-weighted domain. */
export function tallyValues(raw: string[]): CoverageDimensionValue[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const v of raw) {
    const value = (v ?? "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
    total += 1;
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, recordCount]) => ({
      value,
      recordCount,
      share: total > 0 ? recordCount / total : 0,
    }));
}

function classify(
  values: CoverageDimensionValue[],
  rowCount: number,
  opts: Required<ProfileOptions>,
): string | undefined {
  const cardinality = values.length;
  if (cardinality < opts.minCardinality) {
    return `only ${cardinality} distinct value(s) — carries no variation`;
  }
  if (cardinality > opts.maxCardinality) {
    return `${cardinality} distinct values exceeds the ${opts.maxCardinality} cardinality cap — looks like free text`;
  }
  if (
    rowCount >= opts.minRowsForRatio &&
    cardinality / rowCount > opts.maxDistinctRatio
  ) {
    return `${cardinality} distinct values across ${rowCount} rows — looks like an identifier, not a dimension`;
  }
  return undefined;
}

/**
 * Profile every column of a cached tabular data source. Returns accepted and
 * rejected candidates both — rejections are shown to the user rather than
 * silently dropped, so an over-eager cap is visible and fixable.
 *
 * `objectType` defaults to the source alias: a "calls" sheet describes calls.
 */
export function profileTable(opts: {
  alias: string;
  headers: string[];
  rows: string[][];
  valueSource: CoverageValueSource;
  objectType?: string;
  options?: ProfileOptions;
}): { accepted: ProfiledDimension[]; rejected: ProfiledDimension[] } {
  const o = { ...DEFAULTS, ...(opts.options ?? {}) };
  const objectType = opts.objectType ?? opts.alias;
  const accepted: ProfiledDimension[] = [];
  const rejected: ProfiledDimension[] = [];

  opts.headers.forEach((header, colIndex) => {
    const field = (header ?? "").trim();
    if (!field) return;
    const values = tallyValues(opts.rows.map((r) => r[colIndex] ?? ""));
    const rejectedReason = classify(values, opts.rows.length, o);
    const dim: ProfiledDimension = {
      objectType,
      field,
      label: field,
      valueSource: opts.valueSource,
      sourceAlias: opts.alias,
      values,
      cardinality: values.length,
      ...(rejectedReason ? { rejectedReason } : {}),
    };
    (rejectedReason ? rejected : accepted).push(dim);
  });

  return { accepted, rejected };
}

export function profileCsvSource(
  source: CsvDataSource,
  options?: ProfileOptions,
) {
  return profileTable({
    alias: source.alias,
    headers: source.cachedHeaders ?? [],
    rows: source.cachedData ?? [],
    valueSource: "csv",
    options,
  });
}

export function profileSheetSource(
  source: GoogleSheetsDataSource,
  options?: ProfileOptions,
) {
  return profileTable({
    alias: source.alias,
    headers: source.cachedHeaders ?? [],
    rows: source.cachedData ?? [],
    valueSource: "sheet",
    options,
  });
}

/**
 * Derive dimensions from historical runs. Each key of `assignedVariables` is a
 * candidate field; the values observed across runs are its domain.
 *
 * Note the shares here are run-frequency, NOT record volume — a cell exercised
 * by many runs is not thereby common in production. Only a 'profiled' source
 * (D3) yields true record counts; callers must not conflate the two.
 */
export function profileObservedRuns(
  runs: Array<Record<string, string> | null | undefined>,
  opts: { objectType: string; options?: ProfileOptions },
): { accepted: ProfiledDimension[]; rejected: ProfiledDimension[] } {
  const o = { ...DEFAULTS, ...(opts.options ?? {}) };
  const byField = new Map<string, string[]>();
  let rowCount = 0;

  for (const run of runs) {
    if (!run) continue;
    rowCount += 1;
    for (const [field, value] of Object.entries(run)) {
      if (value === null || value === undefined) continue;
      const list = byField.get(field) ?? [];
      list.push(String(value));
      byField.set(field, list);
    }
  }

  const accepted: ProfiledDimension[] = [];
  const rejected: ProfiledDimension[] = [];
  for (const [field, raw] of [...byField.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const values = tallyValues(raw);
    const rejectedReason = classify(values, rowCount, o);
    const dim: ProfiledDimension = {
      objectType: opts.objectType,
      field,
      label: field,
      valueSource: "observed",
      values,
      cardinality: values.length,
      ...(rejectedReason ? { rejectedReason } : {}),
    };
    (rejectedReason ? rejected : accepted).push(dim);
  }
  return { accepted, rejected };
}
