/**
 * CSV data reference resolver. Resolves {{csv:alias.column[row]}} references
 * against cached CsvDataSource rows. Mirrors src/lib/google-sheets/resolver.ts.
 */

import { findCsvReferences } from './api';
import type { CsvDataSource } from '@/lib/db/schema';

export interface ResolvedCsvReference {
  fullMatch: string;
  resolvedValue: string;
  error?: string;
}

export interface CsvResolveResult {
  resolvedCode: string;
  references: ResolvedCsvReference[];
  errors: string[];
}

function colLetterToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

export function resolveCsvReferences(code: string, dataSources: CsvDataSource[]): CsvResolveResult {
  const refs = findCsvReferences(code);
  const resolved: ResolvedCsvReference[] = [];
  const errors: string[] = [];
  let resolvedCode = code;

  const sourceByAlias = new Map<string, CsvDataSource>();
  for (const ds of dataSources) sourceByAlias.set(ds.alias, ds);

  for (const { fullMatch, reference } of refs) {
    const source = sourceByAlias.get(reference.alias);
    if (!source) {
      const err = `CSV alias "${reference.alias}" not found`;
      errors.push(err);
      resolved.push({ fullMatch, resolvedValue: fullMatch, error: err });
      continue;
    }

    const headers = source.cachedHeaders ?? [];
    const data = source.cachedData ?? [];

    try {
      let value: string;

      if (reference.type === 'cell') {
        const cellRef = reference.cellRef!;
        const m = cellRef.match(/^([A-Z]+)(\d+)$/);
        if (!m) throw new Error(`Invalid cell reference: ${cellRef}`);
        const colIndex = colLetterToIndex(m[1]);
        const rowNum = parseInt(m[2], 10);
        if (rowNum === 1) {
          value = headers[colIndex] ?? '';
        } else {
          const dataRowIdx = rowNum - 2;
          if (dataRowIdx < 0 || dataRowIdx >= data.length) {
            throw new Error(`Row ${rowNum} out of range (have ${data.length} data rows)`);
          }
          value = data[dataRowIdx]?.[colIndex] ?? '';
        }
      } else if (reference.type === 'row') {
        const rowIdx = reference.rowIndex!;
        if (rowIdx < 0 || rowIdx >= data.length) {
          throw new Error(`Row index ${rowIdx} out of range (have ${data.length} rows)`);
        }
        const obj: Record<string, string> = {};
        const row = data[rowIdx];
        for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i] ?? '';
        value = JSON.stringify(obj);
      } else {
        const colName = reference.column!;
        let colIndex = headers.findIndex(h => h.toLowerCase() === colName.toLowerCase());
        if (colIndex === -1 && /^[A-Z]+$/.test(colName)) {
          colIndex = colLetterToIndex(colName);
        }
        if (colIndex === -1) {
          throw new Error(`Column "${colName}" not found. Available: ${headers.join(', ')}`);
        }
        if (reference.rowIndex !== undefined) {
          if (reference.rowIndex < 0 || reference.rowIndex >= data.length) {
            throw new Error(`Row index ${reference.rowIndex} out of range`);
          }
          value = data[reference.rowIndex]?.[colIndex] ?? '';
        } else {
          value = JSON.stringify(data.map(r => r[colIndex] ?? ''));
        }
      }

      resolved.push({ fullMatch, resolvedValue: value });
      resolvedCode = resolvedCode.replace(fullMatch, value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${fullMatch}: ${msg}`);
      resolved.push({ fullMatch, resolvedValue: fullMatch, error: msg });
    }
  }

  return { resolvedCode, references: resolved, errors };
}

export function previewCsvReferences(code: string, dataSources: CsvDataSource[]) {
  const refs = findCsvReferences(code);
  const sourceByAlias = new Map<string, CsvDataSource>();
  for (const ds of dataSources) sourceByAlias.set(ds.alias, ds);

  return refs.map(({ fullMatch, reference }) => {
    const source = sourceByAlias.get(reference.alias);
    const base = {
      fullMatch,
      alias: reference.alias,
      column: reference.column,
      rowIndex: reference.rowIndex,
      cellRef: reference.cellRef,
      type: reference.type,
    };

    if (!source) {
      return { ...base, error: `CSV alias "${reference.alias}" not found` };
    }

    const result = resolveCsvReferences(fullMatch, [source]);
    const resolved = result.references[0];
    return {
      ...base,
      previewValue: resolved?.error ? undefined : resolved?.resolvedValue,
      error: resolved?.error,
      source: {
        filename: source.filename,
        headers: source.cachedHeaders ?? [],
        sampleData: (source.cachedData ?? []).slice(0, 5),
      },
    };
  });
}
