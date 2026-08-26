/**
 * Turns tests with matrix-mode variables into one runnable instance per data
 * cell, before dispatch.
 *
 * Expansion happens at the single public entry point (`executeTests`) so every
 * dispatch path — remote runner, EB pool, fallback chain — inherits it without
 * each having to know matrix execution exists.
 *
 * Each expanded instance is a shallow clone of the test whose matrix variables
 * have been rewritten to `sourceRowMode: 'fixed'` at the pinned row. Downstream
 * resolution is then completely unaware of matrices: it sees an ordinary test
 * with fixed variables, which is exactly the property that keeps this change
 * from rippling through the executor.
 */

import type { Test } from "@/lib/db/schema";
import type { TabularSourceLike } from "@lastest/coverage-model";
import { expandMatrix, matrixVariables } from "@lastest/coverage-model";

export interface MatrixRunMeta {
  dataCell: string;
  coords: Record<string, string>;
  index: number;
  total: number;
  /** False when the representative-cell policy excludes this run from the
   *  visual layer. The dispatch path drops screenshot capture accordingly. */
  capturesVisual: boolean;
}

export type RunnableTest = Test & { matrixRun?: MatrixRunMeta };

export interface ExpansionOutcome {
  tests: RunnableTest[];
  /** Per-test notes: expansion size, reductions, truncation, filter errors. */
  notes: Array<{ testId: string; testName: string; explanation: string }>;
  /** Tests whose matrix config is broken — these are NOT silently run once. */
  failures: Array<{ testId: string; testName: string; error: string }>;
}

export function expandTestsForMatrix(
  tests: Test[],
  gsheetSources: TabularSourceLike[],
  csvSources: TabularSourceLike[],
): ExpansionOutcome {
  const out: RunnableTest[] = [];
  const notes: ExpansionOutcome["notes"] = [];
  const failures: ExpansionOutcome["failures"] = [];

  for (const test of tests) {
    if (matrixVariables(test.variables).length === 0) {
      out.push(test);
      continue;
    }

    const expansion = expandMatrix({
      variables: test.variables,
      gsheetSources,
      csvSources,
      policy: test.matrixPolicy,
    });

    if (expansion.runs.length === 0) {
      // A matrix test that expands to nothing is a configuration error — a
      // bad row filter, or a data source that lost its cache. Running it once
      // with unpinned rows would quietly test the wrong data and report green.
      failures.push({
        testId: test.id,
        testName: test.name,
        error:
          expansion.errors.join("; ") ||
          "Matrix expansion produced no runs (check the row filter and data source)",
      });
      continue;
    }

    notes.push({
      testId: test.id,
      testName: test.name,
      explanation: expansion.explanation,
    });

    for (const run of expansion.runs) {
      out.push({
        ...test,
        variables: (test.variables ?? []).map((v) =>
          run.rowPicks[v.id] === undefined
            ? v
            : {
                ...v,
                sourceRowMode: "fixed" as const,
                sourceRow: run.rowPicks[v.id],
              },
        ),
        matrixRun: {
          dataCell: run.coordsKey,
          coords: run.coords,
          index: run.index,
          total: expansion.runs.length,
          capturesVisual: run.capturesVisual,
        },
      });
    }
  }

  return { tests: out, notes, failures };
}
