/**
 * Row selector for matrix-mode variables — binds a test to a SLICE of a data
 * source rather than a single row.
 *
 * Grammar (deliberately tiny — this is a user-facing settings field, not a
 * query language, and anything Turing-complete here becomes a support burden):
 *
 *   expr   := clause (AND clause)*
 *   clause := field IN (v, v, ...)
 *           | field NOT IN (v, v, ...)
 *           | field = v
 *           | field != v
 *
 * Field names and values may be bare or quoted. Matching is case-insensitive
 * on both, because spreadsheet data is entered by humans.
 */

export type RowFilterOp = "in" | "not-in" | "eq" | "neq";

export interface RowFilterClause {
  field: string;
  op: RowFilterOp;
  values: string[];
}

export interface ParsedRowFilter {
  clauses: RowFilterClause[];
  errors: string[];
}

const CLAUSE_SPLIT = /\s+AND\s+/i;

function unquote(raw: string): string {
  const s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => unquote(v))
    .filter((v) => v.length > 0);
}

export function parseRowFilter(
  filter: string | null | undefined,
): ParsedRowFilter {
  const clauses: RowFilterClause[] = [];
  const errors: string[] = [];
  const trimmed = (filter ?? "").trim();
  if (!trimmed) return { clauses, errors };

  for (const raw of trimmed.split(CLAUSE_SPLIT)) {
    const part = raw.trim();
    if (!part) continue;

    // field NOT IN (...) — checked before IN so the NOT is not swallowed.
    let m = part.match(/^(.+?)\s+NOT\s+IN\s*\((.*)\)$/i);
    if (m) {
      const values = splitList(m[2]);
      if (values.length === 0) {
        errors.push(`Empty value list in: ${part}`);
        continue;
      }
      clauses.push({ field: unquote(m[1]), op: "not-in", values });
      continue;
    }

    m = part.match(/^(.+?)\s+IN\s*\((.*)\)$/i);
    if (m) {
      const values = splitList(m[2]);
      if (values.length === 0) {
        errors.push(`Empty value list in: ${part}`);
        continue;
      }
      clauses.push({ field: unquote(m[1]), op: "in", values });
      continue;
    }

    m = part.match(/^(.+?)\s*!=\s*(.+)$/);
    if (m) {
      clauses.push({
        field: unquote(m[1]),
        op: "neq",
        values: [unquote(m[2])],
      });
      continue;
    }

    // Single '=' only; '==' is accepted as a courtesy.
    m = part.match(/^(.+?)\s*==?\s*(.+)$/);
    if (m) {
      clauses.push({ field: unquote(m[1]), op: "eq", values: [unquote(m[2])] });
      continue;
    }

    errors.push(`Unparseable filter clause: ${part}`);
  }

  return { clauses, errors };
}

const norm = (v: string) => (v ?? "").trim().toLowerCase();

export function matchesClause(
  record: Record<string, string>,
  clause: RowFilterClause,
): boolean {
  // Case-insensitive field lookup — sheet headers rarely match what the user
  // typed exactly.
  const key = Object.keys(record).find((k) => norm(k) === norm(clause.field));
  const actual = key === undefined ? "" : norm(record[key]);
  const wanted = clause.values.map(norm);

  switch (clause.op) {
    case "in":
      return wanted.includes(actual);
    case "not-in":
      return !wanted.includes(actual);
    case "eq":
      return actual === wanted[0];
    case "neq":
      return actual !== wanted[0];
  }
}

/** Clauses are AND-joined. An empty filter matches everything. */
export function matchesRowFilter(
  record: Record<string, string>,
  parsed: ParsedRowFilter,
): boolean {
  return parsed.clauses.every((c) => matchesClause(record, c));
}

/** Row indices of `records` that satisfy the filter, in source order. */
export function selectRowIndices(
  records: Array<Record<string, string>>,
  filter: string | null | undefined,
): { indices: number[]; errors: string[] } {
  const parsed = parseRowFilter(filter);
  // A malformed filter must not silently widen the slice to every row —
  // that would run the whole data set under the impression it was filtered.
  if (parsed.errors.length > 0) {
    return { indices: [], errors: parsed.errors };
  }
  const indices: number[] = [];
  records.forEach((rec, i) => {
    if (matchesRowFilter(rec, parsed)) indices.push(i);
  });
  return { indices, errors: [] };
}
