/**
 * Google Sheets data reference resolver.
 * Resolves {{sheet:alias.column[row]}} references in test code
 * using cached data from GoogleSheetsDataSources.
 */

import { findSheetReferences } from './api';
import type { GoogleSheetsDataSource } from '@/lib/db/schema';

export interface ResolvedReference {
  fullMatch: string;
  resolvedValue: string;
  error?: string;
}

export interface ResolveResult {
  resolvedCode: string;
  references: ResolvedReference[];
  errors: string[];
}

/**
 * Resolve all {{sheet:...}} references in test code using cached data sources.
 * Returns the code with all references replaced by their resolved values.
 */
export function resolveSheetReferences(
  code: string,
  dataSources: GoogleSheetsDataSource[]
): ResolveResult {
  const refs = findSheetReferences(code);
  const resolved: ResolvedReference[] = [];
  const errors: string[] = [];
  let resolvedCode = code;

  // Build a lookup map by alias
  const sourceByAlias = new Map<string, GoogleSheetsDataSource>();
  for (const ds of dataSources) {
    sourceByAlias.set(ds.alias, ds);
  }

  for (const { fullMatch, reference } of refs) {
    const source = sourceByAlias.get(reference.alias);
    if (!source) {
      const err = `Data source alias "${reference.alias}" not found`;
      errors.push(err);
      resolved.push({ fullMatch, resolvedValue: fullMatch, error: err });
      continue;
    }

    const headers = source.cachedHeaders || [];
    const data = source.cachedData || [];

    try {
      let value: string;

      if (reference.type === 'cell') {
        // Direct cell reference like A1
        const cellRef = reference.cellRef!;
        const colMatch = cellRef.match(/^([A-Z]+)(\d+)$/);
        if (!colMatch) {
          throw new Error(`Invalid cell reference: ${cellRef}`);
        }

        const colLetter = colMatch[1];
        const rowNum = parseInt(colMatch[2], 10);

        // Convert column letter to index
        let colIndex = 0;
        for (let i = 0; i < colLetter.length; i++) {
          colIndex = colIndex * 26 + (colLetter.charCodeAt(i) - 64);
        }
        colIndex -= 1; // 0-based

        // Row 1 = headers, Row 2+ = data
        if (rowNum === (source.headerRow || 1)) {
          value = headers[colIndex] || '';
        } else {
          const dataRowIdx = rowNum - (source.headerRow || 1) - 1;
          if (dataRowIdx < 0 || dataRowIdx >= data.length) {
            throw new Error(`Row ${rowNum} out of range`);
          }
          value = data[dataRowIdx]?.[colIndex] || '';
        }
      } else if (reference.type === 'row') {
        // Entire row as JSON object
        const rowIdx = reference.rowIndex!;
        if (rowIdx < 0 || rowIdx >= data.length) {
          throw new Error(`Row index ${rowIdx} out of range (have ${data.length} rows)`);
        }
        const row = data[rowIdx];
        const obj: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
          obj[headers[i]] = row[i] || '';
        }
        value = JSON.stringify(obj);
      } else {
        // Column reference
        const colName = reference.column!;
        const colIndex = headers.findIndex(
          (h) => h.toLowerCase() === colName.toLowerCase()
        );

        if (colIndex === -1) {
          // Try as column letter
          const letterMatch = colName.match(/^[A-Z]+$/);
          if (letterMatch) {
            let idx = 0;
            for (let i = 0; i < colName.length; i++) {
              idx = idx * 26 + (colName.charCodeAt(i) - 64);
            }
            idx -= 1;

            if (reference.rowIndex !== undefined) {
              if (reference.rowIndex < 0 || reference.rowIndex >= data.length) {
                throw new Error(`Row index ${reference.rowIndex} out of range`);
              }
              value = data[reference.rowIndex]?.[idx] || '';
            } else {
              value = JSON.stringify(data.map((row) => row[idx] || ''));
            }
          } else {
            throw new Error(
              `Column "${colName}" not found. Available: ${headers.join(', ')}`
            );
          }
        } else {
          if (reference.rowIndex !== undefined) {
            if (reference.rowIndex < 0 || reference.rowIndex >= data.length) {
              throw new Error(`Row index ${reference.rowIndex} out of range`);
            }
            value = data[reference.rowIndex]?.[colIndex] || '';
          } else {
            // All values from column
            value = JSON.stringify(data.map((row) => row[colIndex] || ''));
          }
        }
      }

      resolved.push({ fullMatch, resolvedValue: value });
      resolvedCode = resolvedCode.replace(fullMatch, value);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      errors.push(`${fullMatch}: ${err}`);
      resolved.push({ fullMatch, resolvedValue: fullMatch, error: err });
    }
  }

  return { resolvedCode, references: resolved, errors };
}

/**
 * Preview what sheet references in code would resolve to.
 * Returns reference info without modifying code - used for UI previews.
 */
export function previewSheetReferences(
  code: string,
  dataSources: GoogleSheetsDataSource[]
): Array<{
  fullMatch: string;
  alias: string;
  column?: string;
  rowIndex?: number;
  cellRef?: string;
  type: 'column' | 'cell' | 'row';
  previewValue?: string;
  error?: string;
  source?: {
    spreadsheetName: string;
    sheetName: string;
    headers: string[];
    sampleData: string[][];
  };
}> {
  const refs = findSheetReferences(code);
  const sourceByAlias = new Map<string, GoogleSheetsDataSource>();
  for (const ds of dataSources) {
    sourceByAlias.set(ds.alias, ds);
  }

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
      return { ...base, error: `Data source "${reference.alias}" not found` };
    }

    const headers = source.cachedHeaders || [];
    const data = source.cachedData || [];

    // Try to resolve a preview value
    const result = resolveSheetReferences(fullMatch, [source]);
    const resolved = result.references[0];

    return {
      ...base,
      previewValue: resolved?.error ? undefined : resolved?.resolvedValue,
      error: resolved?.error,
      source: {
        spreadsheetName: source.spreadsheetName,
        sheetName: source.sheetName,
        headers,
        sampleData: data.slice(0, 5),
      },
    };
  });
}
