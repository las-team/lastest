/**
 * Cell derivation — the combinations that ACTUALLY OCCUR in the data.
 *
 * This is the point of the whole model. 12 countries x 8 call types is 96
 * cartesian combinations, but production may only contain 41. The other 55 are
 * never planned, never counted against coverage, and never shown to the AI as
 * work. Deriving cells from real rows rather than from a cartesian product is
 * what makes "what is worth testing" a mechanical question.
 */

import { coordsKey } from "./coords";

export interface DerivedCell {
  objectType: string;
  coords: Record<string, string>;
  coordsKey: string;
  /** Rows/runs matching this combination. */
  observedCount: number;
}

export interface CellDerivationInput {
  objectType: string;
  /** Dimension fields to project onto, in any order. */
  fields: string[];
  /** Source records as field→value maps. Rows missing a field are skipped —
   *  a partial tuple is not evidence that the combination occurs. */
  records: Array<Record<string, string>>;
}

export function deriveCells(input: CellDerivationInput): DerivedCell[] {
  const fields = [...new Set(input.fields)].sort();
  if (fields.length === 0) return [];

  const byKey = new Map<string, DerivedCell>();
  for (const record of input.records) {
    const coords: Record<string, string> = {};
    let complete = true;
    for (const f of fields) {
      const v = record[f];
      if (v === undefined || v === null || String(v).trim() === "") {
        complete = false;
        break;
      }
      coords[f] = String(v).trim();
    }
    if (!complete) continue;

    const key = coordsKey(coords);
    const existing = byKey.get(key);
    if (existing) {
      existing.observedCount += 1;
    } else {
      byKey.set(key, {
        objectType: input.objectType,
        coords,
        coordsKey: key,
        observedCount: 1,
      });
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      b.observedCount - a.observedCount ||
      a.coordsKey.localeCompare(b.coordsKey),
  );
}

/** Turn a cached table (headers + rows) into field→value records. */
export function tableToRecords(
  headers: string[],
  rows: string[][],
): Array<Record<string, string>> {
  const clean = headers.map((h) => (h ?? "").trim());
  return rows.map((row) => {
    const rec: Record<string, string> = {};
    clean.forEach((h, i) => {
      if (h) rec[h] = row[i] ?? "";
    });
    return rec;
  });
}

/**
 * The cartesian product, for reporting only — how many combinations a naive
 * full-factorial suite would attempt. Surfacing `cartesian - occurring` is the
 * clearest single number for "how much work we are correctly not doing".
 */
export function cartesianSize(valueCounts: number[]): number {
  return valueCounts.reduce((acc, n) => acc * Math.max(n, 0), 1);
}
