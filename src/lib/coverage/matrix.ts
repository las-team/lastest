/**
 * Matrix expansion (P2) — one test definition x N data rows = N runs in a
 * single build.
 *
 * This is what makes "the same journey across 12 countries and 8 call types"
 * expressible. Before this, `sourceRowMode` could only pick ONE row per run
 * ('fixed'/'random') or walk one row forward per build ('increment'), so data
 * diversity inside a single environment was impossible to state.
 *
 * Expansion is pure: it takes a test's variables plus the cached data sources
 * and returns the per-run variable bindings. The executor applies them.
 */

import {
  DEFAULT_MATRIX_POLICY,
  type CsvDataSource,
  type GoogleSheetsDataSource,
  type MatrixPolicy,
  type TestVariable,
} from "@/lib/db/schema";
import { coordsKey } from "./coords";
import { tableToRecords } from "./cells";
import { selectRowIndices } from "./row-filter";
import { tupleKeys } from "./weight";

export interface MatrixRun {
  /** Row index to pin each matrix variable to, keyed by TestVariable.id. */
  rowPicks: Record<string, number>;
  /** variable name → resolved value, i.e. this run's cell coordinate. */
  coords: Record<string, string>;
  coordsKey: string;
  /** Whether this run captures the visual layer. See MatrixPolicy.visual. */
  capturesVisual: boolean;
  index: number;
}

export interface MatrixExpansion {
  runs: MatrixRun[];
  /** Rows selected before pairwise reduction — the honest denominator. */
  candidateCount: number;
  /** Set when maxRuns clipped the expansion; surfaced, never silent. */
  truncated: boolean;
  errors: string[];
  /** Human-readable account of what was expanded and what was dropped. */
  explanation: string;
}

function sourceRecordsFor(
  variable: TestVariable,
  gsheetSources: GoogleSheetsDataSource[],
  csvSources: CsvDataSource[],
): Array<Record<string, string>> {
  if (!variable.sourceAlias) return [];
  if (variable.sourceType === "gsheet") {
    const s = gsheetSources.find((x) => x.alias === variable.sourceAlias);
    return s ? tableToRecords(s.cachedHeaders ?? [], s.cachedData ?? []) : [];
  }
  if (variable.sourceType === "csv") {
    const s = csvSources.find((x) => x.alias === variable.sourceAlias);
    return s ? tableToRecords(s.cachedHeaders ?? [], s.cachedData ?? []) : [];
  }
  return [];
}

function valueAt(
  record: Record<string, string> | undefined,
  column: string | undefined,
): string {
  if (!record || !column) return "";
  const key = Object.keys(record).find(
    (k) => k.trim().toLowerCase() === column.trim().toLowerCase(),
  );
  return key ? (record[key] ?? "").trim() : "";
}

/** Variables that drive a fan-out. Non-matrix variables resolve as before. */
export function matrixVariables(
  variables: TestVariable[] | null | undefined,
): TestVariable[] {
  return (variables ?? []).filter(
    (v) =>
      v.mode === "assign" &&
      v.sourceRowMode === "matrix" &&
      (v.sourceType === "csv" || v.sourceType === "gsheet"),
  );
}

/**
 * Greedy t-way covering set.
 *
 * Picks, repeatedly, the candidate that covers the most not-yet-covered
 * t-tuples. Not provably minimal — computing the minimum covering array is
 * NP-hard — but it lands close, runs in milliseconds, and is deterministic,
 * which matters more here: a nondeterministic suite size would make build-over-
 * build comparison meaningless.
 */
export function pairwiseReduce<T extends { coords: Record<string, string> }>(
  candidates: T[],
  strength: number,
): T[] {
  if (candidates.length <= 1) return [...candidates];

  // No early return when the field count is at or below t. It is tempting to
  // bail there — "every tuple IS the whole coordinate, so nothing can drop" —
  // but that confuses distinct COMBINATIONS with candidate ROWS. A 11-row
  // source with 2 dimension columns commonly holds only 6 distinct
  // combinations; the greedy pass below collapses the 5 duplicate rows, which
  // is exactly the reduction the user asked for. Bailing early ran all 11.
  const needed = new Set<string>();
  const tuplesByCandidate = candidates.map((c) => {
    const keys = tupleKeys(c.coords, strength);
    keys.forEach((k) => needed.add(k));
    return keys;
  });

  const chosen: T[] = [];
  const covered = new Set<string>();
  const used = new Set<number>();

  while (covered.size < needed.size) {
    let bestIdx = -1;
    let bestGain = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      let gain = 0;
      for (const k of tuplesByCandidate[i]) if (!covered.has(k)) gain += 1;
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = i;
      }
    }
    // No remaining candidate adds anything — the rest are pure duplicates.
    if (bestIdx === -1) break;
    used.add(bestIdx);
    chosen.push(candidates[bestIdx]);
    for (const k of tuplesByCandidate[bestIdx]) covered.add(k);
  }

  // Preserve source order so the expansion is stable across builds.
  const chosenSet = new Set(chosen);
  return candidates.filter((c) => chosenSet.has(c));
}

export function expandMatrix(opts: {
  variables: TestVariable[] | null | undefined;
  gsheetSources: GoogleSheetsDataSource[];
  csvSources: CsvDataSource[];
  policy?: MatrixPolicy | null;
}): MatrixExpansion {
  const policy = { ...DEFAULT_MATRIX_POLICY, ...(opts.policy ?? {}) };
  const vars = matrixVariables(opts.variables);
  const errors: string[] = [];

  if (vars.length === 0) {
    return {
      runs: [],
      candidateCount: 0,
      truncated: false,
      errors,
      explanation: "No matrix variables — test runs once.",
    };
  }

  // Every matrix variable bound to the same source alias walks that source's
  // rows TOGETHER (they are columns of one record, not independent axes).
  // Variables on different sources form a cross product.
  const byAlias = new Map<string, TestVariable[]>();
  for (const v of vars) {
    const alias = `${v.sourceType}:${v.sourceAlias}`;
    byAlias.set(alias, [...(byAlias.get(alias) ?? []), v]);
  }

  type Axis = Array<{
    rowPicks: Record<string, number>;
    coords: Record<string, string>;
  }>;
  const axes: Axis[] = [];

  for (const [alias, group] of byAlias) {
    const records = sourceRecordsFor(
      group[0],
      opts.gsheetSources,
      opts.csvSources,
    );
    if (records.length === 0) {
      errors.push(`Data source "${alias}" has no cached rows`);
      continue;
    }
    // All variables on one source share a filter; take the first non-empty one
    // and warn if they disagree, rather than silently applying one of them.
    const filters = [
      ...new Set(group.map((v) => (v.rowFilter ?? "").trim()).filter(Boolean)),
    ];
    if (filters.length > 1) {
      errors.push(
        `Variables on "${alias}" declare conflicting row filters; using the first`,
      );
    }
    const { indices, errors: filterErrors } = selectRowIndices(
      records,
      filters[0],
    );
    errors.push(...filterErrors);
    if (indices.length === 0) {
      if (filterErrors.length === 0) {
        errors.push(`Row filter on "${alias}" selected no rows`);
      }
      continue;
    }

    axes.push(
      indices.map((rowIndex) => {
        const rowPicks: Record<string, number> = {};
        const coords: Record<string, string> = {};
        for (const v of group) {
          rowPicks[v.id] = rowIndex;
          coords[v.name] = valueAt(records[rowIndex], v.sourceColumn);
        }
        return { rowPicks, coords };
      }),
    );
  }

  if (axes.length === 0) {
    return {
      runs: [],
      candidateCount: 0,
      truncated: false,
      errors,
      explanation: `Matrix expansion produced no runs. ${errors.join("; ")}`,
    };
  }

  // Cross product across sources.
  let combined = axes[0];
  for (let i = 1; i < axes.length; i++) {
    const next: typeof combined = [];
    for (const a of combined) {
      for (const b of axes[i]) {
        next.push({
          rowPicks: { ...a.rowPicks, ...b.rowPicks },
          coords: { ...a.coords, ...b.coords },
        });
      }
    }
    combined = next;
  }

  const candidateCount = combined.length;
  const selected =
    policy.selection === "pairwise"
      ? pairwiseReduce(combined, policy.strength)
      : combined;

  const truncated = selected.length > policy.maxRuns;
  const capped = truncated ? selected.slice(0, policy.maxRuns) : selected;

  const runs: MatrixRun[] = capped.map((c, index) => ({
    rowPicks: c.rowPicks,
    coords: c.coords,
    coordsKey: coordsKey(c.coords),
    capturesVisual:
      policy.visual === "all"
        ? true
        : policy.visual === "none"
          ? false
          : index === 0,
    index,
  }));

  const parts = [
    `${candidateCount} row combination(s) selected`,
    policy.selection === "pairwise" && selected.length < candidateCount
      ? `reduced to ${selected.length} by ${policy.strength}-way covering`
      : null,
    truncated ? `truncated to ${policy.maxRuns} by maxRuns` : null,
    policy.visual === "representative"
      ? `visual layer captured on 1 representative run`
      : policy.visual === "none"
        ? "visual layer disabled for expanded runs"
        : "visual layer captured on every run",
    errors.length > 0 ? `issues: ${errors.join("; ")}` : null,
  ].filter(Boolean);

  return {
    runs,
    candidateCount,
    truncated,
    errors,
    explanation: `${parts.join("; ")}.`,
  };
}
