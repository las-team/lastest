/**
 * Google Sheets API integration for fetching spreadsheet data.
 * Uses the Google Sheets API v4 to read spreadsheet content.
 */

export interface SpreadsheetInfo {
  spreadsheetId: string;
  title: string;
  sheets: SheetTab[];
}

export interface SheetTab {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

export interface SheetData {
  range: string;
  headers: string[];
  rows: string[][];
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
} | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

/**
 * List Google Sheets files from the user's Drive.
 */
export async function listSpreadsheets(accessToken: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id,name,mimeType,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '50',
  });

  const response = await fetch(`${DRIVE_API_BASE}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to list spreadsheets: ${response.status}`);
  }

  const data = await response.json();
  return data.files || [];
}

/**
 * Get spreadsheet metadata (title, sheets/tabs).
 */
export async function getSpreadsheetInfo(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetInfo> {
  const response = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Failed to get spreadsheet info: ${response.status}`);
  }

  const data = await response.json();
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties.title,
    sheets: (data.sheets || []).map((s: { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      rowCount: s.properties.gridProperties?.rowCount || 0,
      columnCount: s.properties.gridProperties?.columnCount || 0,
    })),
  };
}

/**
 * Read data from a specific range in a spreadsheet.
 * If no range is provided, reads the entire first sheet.
 */
export async function getSheetData(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  maxRows: number = 100
): Promise<SheetData> {
  const encodedRange = encodeURIComponent(range);
  const response = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodedRange}?valueRenderOption=FORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Failed to get sheet data: ${response.status}`);
  }

  const data = await response.json();
  const values: string[][] = data.values || [];

  if (values.length === 0) {
    return { range, headers: [], rows: [] };
  }

  const headers = values[0].map((v: string) => String(v || ''));
  const rows = values.slice(1, maxRows + 1).map((row: string[]) =>
    row.map((v: string) => String(v || ''))
  );

  return { range, headers, rows };
}

/**
 * Get a single cell value.
 */
export async function getCellValue(
  accessToken: string,
  spreadsheetId: string,
  cellRef: string
): Promise<string> {
  const response = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(cellRef)}?valueRenderOption=FORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Failed to get cell value: ${response.status}`);
  }

  const data = await response.json();
  return data.values?.[0]?.[0] || '';
}

/**
 * Convert a column index (0-based) to a column letter (A, B, ..., Z, AA, AB, ...).
 */
export function columnIndexToLetter(index: number): string {
  let letter = '';
  let i = index;
  while (i >= 0) {
    letter = String.fromCharCode((i % 26) + 65) + letter;
    i = Math.floor(i / 26) - 1;
  }
  return letter;
}

/**
 * Parse a sheet data reference string like "sheet:alias.column" or "sheet:alias.A1".
 * Returns the parsed components.
 *
 * Syntax:
 *   {{sheet:alias.columnName}}          - All values from a column (by header name)
 *   {{sheet:alias.columnName[0]}}       - Specific row value from column (0-indexed)
 *   {{sheet:alias.A1}}                  - Direct cell reference
 *   {{sheet:alias.row[0]}}              - Entire row as object {header: value, ...}
 */
export interface SheetReference {
  type: 'column' | 'cell' | 'row';
  alias: string;
  column?: string;     // Column header name or letter
  rowIndex?: number;   // 0-based row index (within data, not header)
  cellRef?: string;    // Direct cell reference like A1, B2
}

export function parseSheetReference(ref: string): SheetReference | null {
  // Remove {{ and }} wrapper if present
  const cleaned = ref.replace(/^\{\{/, '').replace(/\}\}$/, '').trim();

  // Must start with "sheet:"
  if (!cleaned.startsWith('sheet:')) return null;

  const body = cleaned.slice(6); // Remove "sheet:"
  const dotIndex = body.indexOf('.');
  if (dotIndex === -1) return null;

  const alias = body.slice(0, dotIndex);
  const accessor = body.slice(dotIndex + 1);

  if (!alias || !accessor) return null;

  // Check for row reference: row[N]
  const rowMatch = accessor.match(/^row\[(\d+)\]$/);
  if (rowMatch) {
    return {
      type: 'row',
      alias,
      rowIndex: parseInt(rowMatch[1], 10),
    };
  }

  // Check for direct cell reference: A1, B2, AA10, etc.
  const cellMatch = accessor.match(/^([A-Z]+)(\d+)$/);
  if (cellMatch) {
    return {
      type: 'cell',
      alias,
      cellRef: accessor,
    };
  }

  // Check for column with index: columnName[N]
  const colIndexMatch = accessor.match(/^(.+)\[(\d+)\]$/);
  if (colIndexMatch) {
    return {
      type: 'column',
      alias,
      column: colIndexMatch[1],
      rowIndex: parseInt(colIndexMatch[2], 10),
    };
  }

  // Plain column reference: columnName
  return {
    type: 'column',
    alias,
    column: accessor,
  };
}

/**
 * Find all sheet references in a code string.
 * Returns array of { fullMatch, reference } for each {{sheet:...}} found.
 */
export function findSheetReferences(code: string): Array<{
  fullMatch: string;
  reference: SheetReference;
}> {
  const regex = /\{\{sheet:[^}]+\}\}/g;
  const results: Array<{ fullMatch: string; reference: SheetReference }> = [];
  let match;

  while ((match = regex.exec(code)) !== null) {
    const parsed = parseSheetReference(match[0]);
    if (parsed) {
      results.push({ fullMatch: match[0], reference: parsed });
    }
  }

  return results;
}
