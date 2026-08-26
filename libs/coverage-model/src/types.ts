/**
 * Narrowed shapes of the rows this package reads.
 *
 * `CoverageCell`, `CoverageDimension` and `TestVariable` are database types —
 * `$inferSelect` over a Drizzle table, or an interface that sits in a jsonb
 * column next to twenty fields about assertions and AI presets. None of them
 * can leave `packages/db`, and importing them is what would make this package
 * a feature rather than a library.
 *
 * So it declares the fields it reads and nothing else (recipe §6.1, "narrow"
 * — the same call `libs/csv` made with `CsvSourceLike`). The database rows
 * satisfy these structurally, so callers pass them unchanged.
 *
 * These also document the read surface: a column absent here is one the model
 * never looks at, and can change in the schema without touching this package.
 */

import type { CoverageCellStatus, CoverageDimensionValue } from "./policy";

/** What the model reads off a `coverage_cells` row. */
export interface CellLike {
  id: string;
  objectType: string;
  coordsKey: string;
  coords: Record<string, string>;
  observedCount: number;
  weight: number;
  status: CoverageCellStatus;
  excludedReason: string | null;
  runCount: number;
  passCount: number;
  failCount: number;
  lastVerdict: string | null;
}

/** What the model reads off a `coverage_dimensions` row. */
export interface DimensionLike {
  objectType: string;
  field: string;
  label: string | null;
  valueSource: string;
  values: CoverageDimensionValue[];
  cardinality: number;
  enabled: boolean;
}

/**
 * What matrix expansion reads off a test's variable list.
 *
 * `mode` and `sourceType` are widened to `string` deliberately: the database's
 * unions (`TestVariableMode`, `TestVariableSourceType`) are core's to change,
 * and this package only ever compares them to the literals it cares about
 * ("assign", "csv", "gsheet", "matrix").
 */
export interface TestVariableLike {
  id: string;
  name: string;
  mode: string;
  sourceType?: string;
  sourceAlias?: string;
  sourceColumn?: string;
  sourceRow?: number;
  sourceRowMode?: string;
  rowFilter?: string;
}
