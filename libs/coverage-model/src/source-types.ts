/**
 * The narrowed shapes of a tabular data source that the coverage model reads.
 *
 * Coverage does not import `CsvDataSource`/`GoogleSheetsDataSource` from the
 * `data-sources` plugin: those are somebody else's row types, and the model
 * reads three fields of them (recipe §6.1, "narrow" — the same call the
 * executor's resolvers already made when `libs/csv` declared `CsvSourceLike`
 * and `libs/google-sheets` declared `SheetSourceLike`). Both of those types
 * satisfy `TabularSourceLike` structurally, so a caller can pass either.
 *
 * Keeping the model on a narrowed shape is what lets `dimensions.ts`,
 * `matrix.ts` and `cells.ts` stay dependency-free — they are the pure half of
 * this feature and the candidates for `libs/coverage-model`.
 */

/** What profiling and matrix expansion read from any tabular source. */
export interface TabularSourceLike {
  alias: string;
  cachedHeaders: string[] | null;
  cachedData: string[][] | null;
}

/**
 * A CSV source whose *full* row set can be re-read from storage when the cache
 * is short. `rowCount` is the source's own total (which may exceed
 * `cachedData.length`); `storagePath` is opaque to the model — only the
 * app-side reader that owns the storage root ever interprets it.
 */
export interface CsvFileSourceLike extends TabularSourceLike {
  rowCount: number | null;
  storagePath: string | null;
}

/**
 * A resolved tabular source: its rows, plus an honest account of how much of
 * the source they are. `truncated` is the field that matters — a profile built
 * on a sample must never present itself as the population.
 */
export interface SourceTable {
  alias: string;
  headers: string[];
  rows: string[][];
  /** Rows the profile is actually based on. */
  profiledRows: number;
  /** Rows the source reports having in total. */
  totalRows: number;
  /** True when `profiledRows < totalRows` — the numbers are a sample. */
  truncated: boolean;
}
