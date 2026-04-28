/**
 * Resolve {{var:name}} references in test code using TestVariable definitions
 * + cached gsheet/csv data.
 *
 * Only `assign`-mode variables resolve here — `extract`-mode variables produce
 * their values post-run by reading page fields, not at code-resolution time.
 */

import { resolveSheetReferences } from '@/lib/google-sheets/resolver';
import { resolveCsvReferences } from '@/lib/csv/resolver';
import type {
  TestVariable,
  GoogleSheetsDataSource,
  CsvDataSource,
} from '@/lib/db/schema';

export interface ResolvedVarReference {
  fullMatch: string;
  varName: string;
  resolvedValue: string;
  error?: string;
}

export interface VarResolveResult {
  resolvedCode: string;
  references: ResolvedVarReference[];
  errors: string[];
}

const VAR_REF_RE = /\{\{var:([a-zA-Z_][a-zA-Z0-9_-]*)\}\}/g;

/** Increment-mode wrap target — first two rows treated as "reserved defaults"
 *  so increments loop through 2..rowCount-1. Matches the schema comment on
 *  tests.variableRowCursors. */
const INCREMENT_WRAP_TARGET = 2;

function getRowCount(
  variable: TestVariable,
  gsheetSources: GoogleSheetsDataSource[],
  csvSources: CsvDataSource[],
): number {
  if (variable.sourceType === 'csv') {
    return csvSources.find(s => s.alias === variable.sourceAlias)?.rowCount ?? 0;
  }
  if (variable.sourceType === 'gsheet') {
    const src = gsheetSources.find(s => s.alias === variable.sourceAlias);
    return src?.cachedData?.length ?? 0;
  }
  return 0;
}

/** Pick the row index for one variable. Returns the chosen row plus, when
 *  applicable, the cursor value to persist for the *next* run. `nextCursor`
 *  is undefined for fixed/random — only increment writes back. */
export function pickRowForVariable(
  variable: TestVariable,
  rowCount: number,
  cursor: number | undefined,
  rng: () => number = Math.random,
): { row: number; nextCursor?: number } {
  if (variable.sourceRowMode === 'random') {
    if (rowCount <= 0) return { row: 0 };
    return { row: Math.floor(rng() * rowCount) };
  }
  if (variable.sourceRowMode === 'increment') {
    if (rowCount <= 0) return { row: 0 };
    const current = cursor ?? 0;
    const safeCurrent = current >= rowCount ? Math.min(INCREMENT_WRAP_TARGET, Math.max(0, rowCount - 1)) : current;
    let next = safeCurrent + 1;
    if (next >= rowCount) {
      // Wrap to row 2 (or the last row if the source has fewer than 3 rows).
      next = rowCount > INCREMENT_WRAP_TARGET ? INCREMENT_WRAP_TARGET : Math.max(0, rowCount - 1);
    }
    return { row: safeCurrent, nextCursor: next };
  }
  // 'fixed' (default)
  return { row: variable.sourceRow ?? 0 };
}

/** Pre-pick rows for every assign-mode csv/gsheet var with a non-fixed
 *  sourceRowMode. The executor calls this once per run so that all
 *  {{var:x}} occurrences in the resolved code agree on the same row, and so
 *  it can persist the new cursor state to tests.variableRowCursors. */
export function pickRowsForVariables(
  variables: TestVariable[] | null | undefined,
  gsheetSources: GoogleSheetsDataSource[],
  csvSources: CsvDataSource[],
  cursors: Record<string, number> | null | undefined,
  rng: () => number = Math.random,
): { rowPicks: Record<string, number>; nextCursors: Record<string, number> } {
  const rowPicks: Record<string, number> = {};
  const nextCursors: Record<string, number> = { ...(cursors ?? {}) };
  for (const v of variables ?? []) {
    if (v.mode !== 'assign') continue;
    if (v.sourceType !== 'csv' && v.sourceType !== 'gsheet') continue;
    const mode = v.sourceRowMode ?? 'fixed';
    if (mode === 'fixed') continue;
    const rowCount = getRowCount(v, gsheetSources, csvSources);
    const cursor = cursors?.[v.id];
    const { row, nextCursor } = pickRowForVariable(v, rowCount, cursor, rng);
    rowPicks[v.id] = row;
    if (nextCursor !== undefined) nextCursors[v.id] = nextCursor;
  }
  return { rowPicks, nextCursors };
}

function buildSyntheticRefForVar(
  variable: TestVariable,
  rowOverride: number | undefined,
): string | null {
  if (variable.mode !== 'assign') return null;
  if (variable.sourceType === 'static') return null;
  if (!variable.sourceAlias || !variable.sourceColumn) return null;
  const row = rowOverride ?? variable.sourceRow ?? 0;
  if (variable.sourceType === 'gsheet') {
    return `{{sheet:${variable.sourceAlias}.${variable.sourceColumn}[${row}]}}`;
  }
  if (variable.sourceType === 'csv') {
    return `{{csv:${variable.sourceAlias}.${variable.sourceColumn}[${row}]}}`;
  }
  return null;
}

function resolveSingleVar(
  variable: TestVariable,
  gsheetSources: GoogleSheetsDataSource[],
  csvSources: CsvDataSource[],
  rowOverride?: number,
): { value: string; error?: string } {
  if (variable.mode !== 'assign') {
    return { value: '', error: `Variable "${variable.name}" is not in assign mode` };
  }
  if (variable.sourceType === 'static') {
    return { value: variable.staticValue ?? '' };
  }
  const synthetic = buildSyntheticRefForVar(variable, rowOverride);
  if (!synthetic) {
    return { value: variable.staticValue ?? '', error: `Variable "${variable.name}" has no source binding` };
  }

  if (variable.sourceType === 'gsheet') {
    const r = resolveSheetReferences(synthetic, gsheetSources);
    const ref = r.references[0];
    if (ref?.error) return { value: variable.staticValue ?? '', error: ref.error };
    return { value: ref?.resolvedValue ?? variable.staticValue ?? '' };
  }
  if (variable.sourceType === 'csv') {
    const r = resolveCsvReferences(synthetic, csvSources);
    const ref = r.references[0];
    if (ref?.error) return { value: variable.staticValue ?? '', error: ref.error };
    return { value: ref?.resolvedValue ?? variable.staticValue ?? '' };
  }
  return { value: variable.staticValue ?? '' };
}

export function resolveVarReferences(
  code: string,
  variables: TestVariable[] | null | undefined,
  gsheetSources: GoogleSheetsDataSource[],
  csvSources: CsvDataSource[],
  /** Per-variable row overrides keyed by TestVariable.id. Used by the
   *  executor to pin a single row across all {{var:x}} occurrences in a run
   *  (so increment/random vars stay consistent within one run). */
  rowOverrides?: Record<string, number>,
): VarResolveResult {
  const vars = variables ?? [];
  const byName = new Map<string, TestVariable>();
  for (const v of vars) byName.set(v.name, v);

  const references: ResolvedVarReference[] = [];
  const errors: string[] = [];
  let resolvedCode = code;

  // Materialize matches first to avoid mutating-while-replacing issues
  const matches: Array<{ fullMatch: string; varName: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = VAR_REF_RE.exec(code)) !== null) {
    matches.push({ fullMatch: m[0], varName: m[1] });
  }

  for (const { fullMatch, varName } of matches) {
    const variable = byName.get(varName);
    if (!variable) {
      const err = `Variable "${varName}" not defined`;
      errors.push(err);
      references.push({ fullMatch, varName, resolvedValue: fullMatch, error: err });
      continue;
    }
    if (variable.mode === 'extract') {
      const err = `Variable "${varName}" is extract-mode — cannot use {{var:...}} in code`;
      errors.push(err);
      references.push({ fullMatch, varName, resolvedValue: fullMatch, error: err });
      continue;
    }
    const rowOverride = rowOverrides?.[variable.id];
    const { value, error } = resolveSingleVar(variable, gsheetSources, csvSources, rowOverride);
    if (error) errors.push(`${fullMatch}: ${error}`);
    references.push({ fullMatch, varName, resolvedValue: value, error });
    // replace all occurrences of this token at once
    resolvedCode = resolvedCode.split(fullMatch).join(value);
  }

  return { resolvedCode, references, errors };
}

/** Resolve every assign-mode var to its current value. Mirrors how the
 *  executor builds `assignedVariables` for testResults — exposed for tests
 *  and previews. Static vars resolve to their literal value; CSV/Sheet vars
 *  resolve through `rowOverrides` when supplied (else fall back to fixed
 *  sourceRow / row 0). */
export function resolveAssignedValues(
  variables: TestVariable[] | null | undefined,
  gsheetSources: GoogleSheetsDataSource[],
  csvSources: CsvDataSource[],
  rowOverrides?: Record<string, number>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of variables ?? []) {
    if (v.mode !== 'assign') continue;
    const { value } = resolveSingleVar(v, gsheetSources, csvSources, rowOverrides?.[v.id]);
    out[v.name] = value;
  }
  return out;
}

export function previewVarReferences(
  code: string,
  variables: TestVariable[] | null | undefined,
  gsheetSources: GoogleSheetsDataSource[],
  csvSources: CsvDataSource[],
) {
  const vars = variables ?? [];
  const byName = new Map<string, TestVariable>();
  for (const v of vars) byName.set(v.name, v);

  const matches: Array<{ fullMatch: string; varName: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = VAR_REF_RE.exec(code)) !== null) {
    matches.push({ fullMatch: m[0], varName: m[1] });
  }

  return matches.map(({ fullMatch, varName }) => {
    const variable = byName.get(varName);
    if (!variable) {
      return { fullMatch, varName, error: `Variable "${varName}" not defined` };
    }
    if (variable.mode === 'extract') {
      return { fullMatch, varName, mode: variable.mode, error: 'Extract-mode vars cannot be referenced in code' };
    }
    const { value, error } = resolveSingleVar(variable, gsheetSources, csvSources);
    return {
      fullMatch,
      varName,
      mode: variable.mode,
      sourceType: variable.sourceType,
      sourceAlias: variable.sourceAlias,
      sourceColumn: variable.sourceColumn,
      sourceRow: variable.sourceRow,
      sourceRowMode: variable.sourceRowMode,
      previewValue: error ? undefined : value,
      error,
    };
  });
}
