/**
 * `@lastest/coverage-model` — the pure half of data-driven coverage.
 *
 * Everything here is a function of its arguments: dimension profiling, the
 * cells that actually occur, the weight formula, the t-way stopping rule,
 * matrix expansion, the row-filter grammar and the specification renderer.
 * No database, no storage, no clock, no credentials — recipe §5's row one, so
 * it is a library rather than core or a plugin.
 *
 * The stateful half (`syncCoverage`, `ensureFreshCoverage`, snapshots,
 * cell<->run attribution, the SUT profilers' query execution) stays in
 * `src/lib/coverage`, which owns the queries and calls into this package.
 *
 * Two consumers outside that feature depend on this being a library rather
 * than a feature import: `src/lib/execution/matrix-expand.ts` (core's own
 * fan-out, which needs `expandMatrix`) and the QA agent's planner (which needs
 * `computePlanBudget`). Both were feature -> feature edges while this code sat
 * under `src/lib/coverage`.
 */

export * from "./policy";
export * from "./matrix-policy";
export * from "./types";
export * from "./source-types";
export * from "./coords";
export * from "./cells";
export * from "./row-filter";
export * from "./dimensions";
export * from "./weight";
export * from "./rollup";
export * from "./stop";
export * from "./spec";
export * from "./budget";
export * from "./matrix";
export * from "./churn";
export * from "./profilers/types";
export * from "./profilers/rest";
export * from "./profilers/vault";
