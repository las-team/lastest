/**
 * Google Sheets/Drive REST client. Caller-supplied token, no OAuth exchange or
 * refresh — that is a credential boundary and stays behind
 * `src/lib/core/data-sources-host.ts`. See `docs/architecture/core-scope.md` §3.
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

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files";

/**
 * List Google Sheets files from the user's Drive.
 */
export async function listSpreadsheets(
  accessToken: string,
): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: "files(id,name,mimeType,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "50",
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
  spreadsheetId: string,
): Promise<SpreadsheetInfo> {
  const response = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    throw new Error(`Failed to get spreadsheet info: ${response.status}`);
  }

  const data = await response.json();
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties.title,
    sheets: (data.sheets || []).map(
      (s: {
        properties: {
          sheetId: number;
          title: string;
          gridProperties: { rowCount: number; columnCount: number };
        };
      }) => ({
        sheetId: s.properties.sheetId,
        title: s.properties.title,
        rowCount: s.properties.gridProperties?.rowCount || 0,
        columnCount: s.properties.gridProperties?.columnCount || 0,
      }),
    ),
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
  maxRows: number = 100,
): Promise<SheetData> {
  const encodedRange = encodeURIComponent(range);
  const response = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodedRange}?valueRenderOption=FORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    throw new Error(`Failed to get sheet data: ${response.status}`);
  }

  const data = await response.json();
  const values: string[][] = data.values || [];

  if (values.length === 0) {
    return { range, headers: [], rows: [] };
  }

  const headers = values[0].map((v: string) => String(v || ""));
  const rows = values
    .slice(1, maxRows + 1)
    .map((row: string[]) => row.map((v: string) => String(v || "")));

  return { range, headers, rows };
}

/**
 * Get a single cell value.
 */
export async function getCellValue(
  accessToken: string,
  spreadsheetId: string,
  cellRef: string,
): Promise<string> {
  const response = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(cellRef)}?valueRenderOption=FORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    throw new Error(`Failed to get cell value: ${response.status}`);
  }

  const data = await response.json();
  return data.values?.[0]?.[0] || "";
}

/**
 * Convert a column index (0-based) to a column letter (A, B, ..., Z, AA, AB, ...).
 */
export function columnIndexToLetter(index: number): string {
  let letter = "";
  let i = index;
  while (i >= 0) {
    letter = String.fromCharCode((i % 26) + 65) + letter;
    i = Math.floor(i / 26) - 1;
  }
  return letter;
}
