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

function buildSyntheticRefForVar(
  variable: TestVariable,
): string | null {
  if (variable.mode !== 'assign') return null;
  if (variable.sourceType === 'static') return null;
  if (!variable.sourceAlias || !variable.sourceColumn) return null;
  const row = variable.sourceRow ?? 0;
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
): { value: string; error?: string } {
  if (variable.mode !== 'assign') {
    return { value: '', error: `Variable "${variable.name}" is not in assign mode` };
  }
  if (variable.sourceType === 'static') {
    return { value: variable.staticValue ?? '' };
  }
  const synthetic = buildSyntheticRefForVar(variable);
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
    const { value, error } = resolveSingleVar(variable, gsheetSources, csvSources);
    if (error) errors.push(`${fullMatch}: ${error}`);
    references.push({ fullMatch, varName, resolvedValue: value, error });
    // replace all occurrences of this token at once
    resolvedCode = resolvedCode.split(fullMatch).join(value);
  }

  return { resolvedCode, references, errors };
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
      previewValue: error ? undefined : value,
      error,
    };
  });
}
