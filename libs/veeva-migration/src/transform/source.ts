/**
 * Source-column access shared by the registry and `applyMapping` (kept apart
 * from `apply.ts` so the registry can use it without an import cycle).
 */
import type { SourceRow } from "../types";

/** Read a source column, accepting flattened dotted keys or nested objects. */
export function readSource(row: SourceRow, path: string): unknown {
  if (!path) return undefined;
  if (path in row) return row[path];
  if (!path.includes(".")) return undefined;
  let cur: unknown = row;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
