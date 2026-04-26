/**
 * CSV parsing + reference syntax helpers.
 *
 * Supports {{csv:alias.column[row]}} references, mirroring the gsheet syntax.
 * RFC-4180-ish parser handles quoted fields, escaped quotes, and \r\n / \n line endings.
 * Field separator auto-detected between comma, semicolon, and tab from the header row.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  rowCount: number;
  delimiter: string;
}

export type CsvReferenceType = 'cell' | 'row' | 'column';

export interface CsvReference {
  type: CsvReferenceType;
  alias: string;
  column?: string;
  rowIndex?: number;
  cellRef?: string;
}

const DELIMITER_CANDIDATES = [',', ';', '\t'];

function detectDelimiter(firstLine: string): string {
  let best = ',';
  let bestCount = -1;
  for (const candidate of DELIMITER_CANDIDATES) {
    // Count occurrences outside of quoted regions
    let inQuotes = false;
    let count = 0;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') {
        if (inQuotes && firstLine[i + 1] === '"') {
          i++; // escaped
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && ch === candidate) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

export function parseCsv(text: string): ParsedCsv {
  // Normalize line endings, drop BOM
  const normalized = text.replace(/^﻿/, '');

  // Find first physical line (outside quotes) for delimiter detection
  let firstLineEnd = 0;
  let inQuotes = false;
  for (; firstLineEnd < normalized.length; firstLineEnd++) {
    const ch = normalized[firstLineEnd];
    if (ch === '"') {
      if (inQuotes && normalized[firstLineEnd + 1] === '"') {
        firstLineEnd++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) break;
  }
  const firstLine = normalized.slice(0, firstLineEnd);
  const delimiter = detectDelimiter(firstLine);

  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];

    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\r') {
      // swallow \r — handled when \n hits or as a record terminator
      if (normalized[i + 1] === '\n') i++;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }
  // Flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  // Strip a final empty record from a trailing newline
  if (records.length > 0) {
    const last = records[records.length - 1];
    if (last.length === 1 && last[0] === '') records.pop();
  }

  if (records.length === 0) {
    return { headers: [], rows: [], rowCount: 0, delimiter };
  }

  const headers = records[0].map(h => h.trim());
  const rows = records.slice(1);

  // Pad/truncate rows to header length
  const normalizedRows = rows.map(r => {
    const out = r.slice(0, headers.length);
    while (out.length < headers.length) out.push('');
    return out;
  });

  return { headers, rows: normalizedRows, rowCount: normalizedRows.length, delimiter };
}

export function parseCsvBuffer(buf: Buffer): ParsedCsv {
  return parseCsv(buf.toString('utf8'));
}

/** Parse a single {{csv:alias.accessor}} reference token. */
export function parseCsvReference(ref: string): CsvReference | null {
  const cleaned = ref.replace(/^\{\{/, '').replace(/\}\}$/, '').trim();
  if (!cleaned.startsWith('csv:')) return null;

  const body = cleaned.slice(4);
  const dotIndex = body.indexOf('.');
  if (dotIndex === -1) return null;

  const alias = body.slice(0, dotIndex);
  const accessor = body.slice(dotIndex + 1);
  if (!alias || !accessor) return null;

  const rowMatch = accessor.match(/^row\[(\d+)\]$/);
  if (rowMatch) {
    return { type: 'row', alias, rowIndex: parseInt(rowMatch[1], 10) };
  }

  const cellMatch = accessor.match(/^([A-Z]+)(\d+)$/);
  if (cellMatch) {
    return { type: 'cell', alias, cellRef: accessor };
  }

  const colIdxMatch = accessor.match(/^(.+)\[(\d+)\]$/);
  if (colIdxMatch) {
    return {
      type: 'column',
      alias,
      column: colIdxMatch[1],
      rowIndex: parseInt(colIdxMatch[2], 10),
    };
  }

  return { type: 'column', alias, column: accessor };
}

export function findCsvReferences(code: string): Array<{ fullMatch: string; reference: CsvReference }> {
  const regex = /\{\{csv:[^}]+\}\}/g;
  const results: Array<{ fullMatch: string; reference: CsvReference }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    const parsed = parseCsvReference(match[0]);
    if (parsed) results.push({ fullMatch: match[0], reference: parsed });
  }
  return results;
}
