/**
 * Incremental RFC-4180 CSV parser for Bulk 2.0 result pages (§2.1.5 CSV
 * contract): UTF-8, comma delimiter, LF (or CRLF) line endings, `"`
 * quoting with `""` escapes, quoted fields may contain newlines and commas.
 * Empty (unquoted or `""`) fields become `null`; every other value is the
 * raw string. A leading UTF-8 BOM is dropped.
 *
 * `CsvParser` accepts arbitrary chunk boundaries (`push()` may cut a quoted
 * field, an escaped quote or a CRLF in half) so a results page can be
 * decoded from a streamed body without buffering the whole text.
 */
import type { SourceRow } from "../types";

export type CsvRecord = Record<string, string | null>;

export interface CsvParserOptions {
  /** Field delimiter (Bulk 2.0 `columnDelimiter: COMMA`). */
  delimiter?: string;
  /** Called once with the header row when it has been read. */
  onHeader?: (columns: string[]) => void;
}

const BOM = "\uFEFF";

/**
 * Streaming CSV parser. Feed text with `push()`, drain complete rows with
 * the returned array, then call `finish()` for the last unterminated row.
 */
export class CsvParser {
  private readonly delimiter: string;
  private readonly onHeader: ((columns: string[]) => void) | undefined;
  private header: string[] | null = null;
  private fields: string[] = [];
  private quoted: boolean[] = [];
  private field = "";
  private inQuotes = false;
  /** True right after a closing quote inside a quoted field (`"` seen, need to know if `""`). */
  private afterQuote = false;
  /** True when the current field has been quoted (so `""` → "" not null). */
  private fieldWasQuoted = false;
  private sawAnyChar = false;
  private pendingCr = false;
  private rowCount = 0;

  constructor(opts: CsvParserOptions = {}) {
    this.delimiter = opts.delimiter ?? ",";
    if (this.delimiter.length !== 1)
      throw new RangeError("CSV delimiter must be a single character");
    this.onHeader = opts.onHeader;
  }

  /** Header columns once known (after the first line has been parsed). */
  get columns(): string[] | null {
    return this.header ? [...this.header] : null;
  }

  /** Data rows emitted so far (header excluded). */
  get rows(): number {
    return this.rowCount;
  }

  /** Feed a chunk of text; returns the complete data rows it produced. */
  push(chunk: string): CsvRecord[] {
    const out: CsvRecord[] = [];
    let i = 0;
    if (!this.sawAnyChar && chunk.length > 0) {
      if (chunk.startsWith(BOM)) i = 1;
      this.sawAnyChar = true;
    }
    for (; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.pendingCr) {
        this.pendingCr = false;
        if (c === "\n") continue; // CRLF already handled at the CR
      }
      if (this.inQuotes) {
        if (this.afterQuote) {
          this.afterQuote = false;
          if (c === '"') {
            this.field += '"';
            continue;
          }
          // closing quote consumed; the field continues unquoted
          this.inQuotes = false;
          // fall through to unquoted handling of `c`
        } else {
          if (c === '"') this.afterQuote = true;
          else this.field += c;
          continue;
        }
      }
      if (c === '"') {
        this.inQuotes = true;
        this.fieldWasQuoted = true;
        continue;
      }
      if (c === this.delimiter) {
        this.endField();
        continue;
      }
      if (c === "\n" || c === "\r") {
        if (c === "\r") this.pendingCr = true;
        this.endField();
        const row = this.endRow();
        if (row) out.push(row);
        continue;
      }
      this.field += c;
    }
    return out;
  }

  /** Flush the trailing row (no terminating newline). */
  finish(): CsvRecord[] {
    if (this.inQuotes && !this.afterQuote)
      throw new Error("CSV ended inside a quoted field");
    this.inQuotes = false;
    this.afterQuote = false;
    this.pendingCr = false;
    const out: CsvRecord[] = [];
    if (
      this.field.length > 0 ||
      this.fields.length > 0 ||
      this.fieldWasQuoted
    ) {
      this.endField();
      const row = this.endRow();
      if (row) out.push(row);
    }
    return out;
  }

  private endField(): void {
    this.fields.push(this.field);
    this.quoted.push(this.fieldWasQuoted);
    this.field = "";
    this.fieldWasQuoted = false;
  }

  private endRow(): CsvRecord | null {
    const values = this.fields;
    const quoted = this.quoted;
    this.fields = [];
    this.quoted = [];
    // A completely empty line (e.g. trailing newline after the last row) is skipped.
    if (values.length === 1 && values[0] === "" && !quoted[0]) return null;
    if (!this.header) {
      this.header = values;
      this.onHeader?.([...values]);
      return null;
    }
    if (values.length !== this.header.length) {
      throw new Error(
        `CSV row ${this.rowCount + 2} has ${values.length} fields, header has ${this.header.length}`,
      );
    }
    const rec: CsvRecord = {};
    for (let k = 0; k < this.header.length; k++) {
      const v = values[k];
      rec[this.header[k]] = v === "" ? null : v;
    }
    this.rowCount++;
    return rec;
  }
}

/** Parse a whole CSV text into records (header row required). */
export function parseCsv(
  text: string,
  opts: CsvParserOptions = {},
): CsvRecord[] {
  const p = new CsvParser(opts);
  const rows = p.push(text);
  rows.push(...p.finish());
  return rows;
}

/** Parse Bulk result CSV into `SourceRow`s (throws when `Id` is missing from the header). */
export function parseCsvRows(text: string): SourceRow[] {
  let header: string[] = [];
  const rows = parseCsv(text, { onHeader: (h) => (header = h) });
  if (rows.length > 0 && !header.includes("Id"))
    throw new Error(`Bulk CSV header has no Id column: ${header.join(",")}`);
  return rows as unknown as SourceRow[];
}

/** Serialise rows back to RFC-4180 CSV (LF, header first) — used for checkpoint files. */
export function toCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c])).join(","));
  return lines.join("\n") + "\n";
}
