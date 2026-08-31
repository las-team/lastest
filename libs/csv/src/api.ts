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

export type CsvReferenceType = "cell" | "row" | "column";

export interface CsvReference {
  type: CsvReferenceType;
  alias: string;
  column?: string;
  rowIndex?: number;
  cellRef?: string;
}

const DELIMITER_CANDIDATES = [",", ";", "\t"];

function detectDelimiter(firstLine: string): string {
  let best = ",";
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

/**
 * Records scanned between two pauses in the cooperative parser.
 *
 * Only `parseCsvYielding` uses it; the synchronous entry point runs the same
 * scan with no boundary at all. Big enough that the pause cost is noise next to
 * the scan, small enough that a multi-MB file hands the event loop back many
 * times instead of once at the end.
 */
const DEFAULT_YIELD_ROWS = 5000;

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    // `setImmediate` is Node-only and this package is also bundled for the
    // browser (the CSV data browser). `typeof` on an undeclared name is safe.
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

/** Normalize the text and pin the delimiter — the part that must run before
 *  any record can be scanned. */
function prepareCsv(text: string): { normalized: string; delimiter: string } {
  // Normalize line endings, drop BOM
  const normalized = text.replace(/^\ufeff/, "");

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
    if (!inQuotes && (ch === "\n" || ch === "\r")) break;
  }
  const firstLine = normalized.slice(0, firstLineEnd);
  return { normalized, delimiter: detectDelimiter(firstLine) };
}

/**
 * The scan itself, as a generator so the SAME code serves both entry points.
 *
 * A generator suspends the whole loop — index, in-quotes flag, the partially
 * built field and row all survive a yield — so a pause can land anywhere,
 * including in the middle of a quoted field spanning several physical lines.
 * That is why the yielding parser is not a second implementation: there is
 * only one parser, driven either straight through or in slices.
 *
 * `chunkRows = Infinity` never yields, which is the synchronous path.
 */
function* scanRecords(
  normalized: string,
  delimiter: string,
  chunkRows: number,
): Generator<number, string[][], void> {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let sinceYield = 0;

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
      field = "";
      continue;
    }
    if (ch === "\r") {
      // swallow \r — handled when \n hits or as a record terminator
      if (normalized[i + 1] === "\n") i++;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      if (++sinceYield >= chunkRows) {
        sinceYield = 0;
        yield records.length;
      }
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      if (++sinceYield >= chunkRows) {
        sinceYield = 0;
        yield records.length;
      }
      continue;
    }
    field += ch;
  }
  // Flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}

/** Header split, row padding, trailing-blank strip — the part that only makes
 *  sense once every record has been scanned. */
function finishCsv(records: string[][], delimiter: string): ParsedCsv {
  // Strip a final empty record from a trailing newline
  if (records.length > 0) {
    const last = records[records.length - 1];
    if (last.length === 1 && last[0] === "") records.pop();
  }

  if (records.length === 0) {
    return { headers: [], rows: [], rowCount: 0, delimiter };
  }

  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1);

  // Pad/truncate rows to header length
  const normalizedRows = rows.map((r) => {
    const out = r.slice(0, headers.length);
    while (out.length < headers.length) out.push("");
    return out;
  });

  return {
    headers,
    rows: normalizedRows,
    rowCount: normalizedRows.length,
    delimiter,
  };
}

export function parseCsv(text: string): ParsedCsv {
  const { normalized, delimiter } = prepareCsv(text);
  const scan = scanRecords(normalized, delimiter, Infinity);
  let step = scan.next();
  while (!step.done) step = scan.next();
  return finishCsv(step.value, delimiter);
}

export function parseCsvBuffer(buf: Buffer): ParsedCsv {
  return parseCsv(buf.toString("utf8"));
}

export interface CsvYieldOptions {
  /** Records scanned between pauses. Defaults to `DEFAULT_YIELD_ROWS`. */
  chunkRows?: number;
}

/**
 * `parseCsv`, but cooperative — identical output, event loop handed back every
 * `chunkRows` records.
 *
 * A coverage sync runs inside the serving process and resolves every CSV data
 * source to its FULL row set; a multi-MB parse on the synchronous path blocks
 * every other request for its whole duration. Callers already on an async path
 * (the data-sources plugin's full-file resolve) should prefer this. The
 * synchronous API stays exactly as it was for the executor's inline reference
 * resolution, where the files are small and the call site is not async.
 */
export async function parseCsvYielding(
  text: string,
  opts: CsvYieldOptions = {},
): Promise<ParsedCsv> {
  const { normalized, delimiter } = prepareCsv(text);
  const chunkRows =
    opts.chunkRows && opts.chunkRows > 0 ? opts.chunkRows : DEFAULT_YIELD_ROWS;
  const scan = scanRecords(normalized, delimiter, chunkRows);
  let step = scan.next();
  while (!step.done) {
    await yieldToEventLoop();
    step = scan.next();
  }
  return finishCsv(step.value, delimiter);
}

export function parseCsvBufferYielding(
  buf: Buffer,
  opts: CsvYieldOptions = {},
): Promise<ParsedCsv> {
  return parseCsvYielding(buf.toString("utf8"), opts);
}

/** Parse a single {{csv:alias.accessor}} reference token. */
export function parseCsvReference(ref: string): CsvReference | null {
  const cleaned = ref.replace(/^\{\{/, "").replace(/\}\}$/, "").trim();
  if (!cleaned.startsWith("csv:")) return null;

  const body = cleaned.slice(4);
  const dotIndex = body.indexOf(".");
  if (dotIndex === -1) return null;

  const alias = body.slice(0, dotIndex);
  const accessor = body.slice(dotIndex + 1);
  if (!alias || !accessor) return null;

  const rowMatch = accessor.match(/^row\[(\d+)\]$/);
  if (rowMatch) {
    return { type: "row", alias, rowIndex: parseInt(rowMatch[1], 10) };
  }

  const cellMatch = accessor.match(/^([A-Z]+)(\d+)$/);
  if (cellMatch) {
    return { type: "cell", alias, cellRef: accessor };
  }

  const colIdxMatch = accessor.match(/^(.+)\[(\d+)\]$/);
  if (colIdxMatch) {
    return {
      type: "column",
      alias,
      column: colIdxMatch[1],
      rowIndex: parseInt(colIdxMatch[2], 10),
    };
  }

  return { type: "column", alias, column: accessor };
}

export function findCsvReferences(
  code: string,
): Array<{ fullMatch: string; reference: CsvReference }> {
  const regex = /\{\{csv:[^}]+\}\}/g;
  const results: Array<{ fullMatch: string; reference: CsvReference }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    const parsed = parseCsvReference(match[0]);
    if (parsed) results.push({ fullMatch: match[0], reference: parsed });
  }
  return results;
}
