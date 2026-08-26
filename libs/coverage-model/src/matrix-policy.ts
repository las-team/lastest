/**
 * How a matrix test's expanded runs are selected, and which of them capture a
 * visual baseline.
 *
 * Lives here rather than in the schema because `matrix.ts` — the expansion
 * itself — is pure and must not import the database. `packages/db`'s
 * `schema/tests.ts` imports this type for the `tests.matrix_policy` jsonb
 * column and re-exports it, so `@/lib/db/schema` still exports the name.
 */

/** How a matrix test's expanded runs are selected and which of them capture a
 *  visual baseline. */
export interface MatrixPolicy {
  /** 'all' runs every selected row. 'pairwise' reduces to a t-way covering set,
   *  which is normally a fraction of the rows for the same defect yield. */
  selection: "all" | "pairwise";
  /** t for 'pairwise' selection. 2 unless a slice is high risk. */
  strength: number;
  /**
   * Visual layer policy across expanded runs.
   *
   * 'representative' (the default) captures a PNG baseline for ONE run per
   * slice; the rest run the cheap layers only (dom/network/url/console). This
   * is not a nicety — a per-cell PNG baseline for a 40-cell matrix multiplies
   * storage and human review load by 40, which is what makes matrix testing
   * unusable in practice. 'all' opts into per-cell visual baselines anyway;
   * 'none' disables the visual layer for expanded runs entirely.
   */
  visual: "representative" | "all" | "none";
  /** Hard ceiling on expanded runs per test. A data source that grows
   *  unexpectedly must not silently turn one test into thousands of runs. */
  maxRuns: number;
}

export const DEFAULT_MATRIX_POLICY: MatrixPolicy = {
  selection: "pairwise",
  strength: 2,
  visual: "representative",
  maxRuns: 50,
};
