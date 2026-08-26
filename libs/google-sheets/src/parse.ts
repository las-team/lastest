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
  type: "column" | "cell" | "row";
  alias: string;
  column?: string; // Column header name or letter
  rowIndex?: number; // 0-based row index (within data, not header)
  cellRef?: string; // Direct cell reference like A1, B2
}

export function parseSheetReference(ref: string): SheetReference | null {
  // Remove {{ and }} wrapper if present
  const cleaned = ref.replace(/^\{\{/, "").replace(/\}\}$/, "").trim();

  // Must start with "sheet:"
  if (!cleaned.startsWith("sheet:")) return null;

  const body = cleaned.slice(6); // Remove "sheet:"
  const dotIndex = body.indexOf(".");
  if (dotIndex === -1) return null;

  const alias = body.slice(0, dotIndex);
  const accessor = body.slice(dotIndex + 1);

  if (!alias || !accessor) return null;

  // Check for row reference: row[N]
  const rowMatch = accessor.match(/^row\[(\d+)\]$/);
  if (rowMatch) {
    return {
      type: "row",
      alias,
      rowIndex: parseInt(rowMatch[1], 10),
    };
  }

  // Check for direct cell reference: A1, B2, AA10, etc.
  const cellMatch = accessor.match(/^([A-Z]+)(\d+)$/);
  if (cellMatch) {
    return {
      type: "cell",
      alias,
      cellRef: accessor,
    };
  }

  // Check for column with index: columnName[N]
  const colIndexMatch = accessor.match(/^(.+)\[(\d+)\]$/);
  if (colIndexMatch) {
    return {
      type: "column",
      alias,
      column: colIndexMatch[1],
      rowIndex: parseInt(colIndexMatch[2], 10),
    };
  }

  // Plain column reference: columnName
  return {
    type: "column",
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
