/**
 * P4 orchestration — turn a SUT profile into dimensions and cells carrying
 * REAL record volume.
 *
 * The distinction from P1 matters and is preserved in `valueSource`: a
 * 'profiled' dimension's counts are production volume; a 'csv'/'sheet' one's
 * are spreadsheet rows; an 'observed' one's are run frequencies. Weighting
 * treats them identically by construction, so the source label is the only
 * thing telling a user whether the ranking reflects business reality.
 */

import * as queries from "@/lib/db/queries";
import {
  coordsKey,
  DEFAULT_COVERAGE_ENVIRONMENT,
  groupsToDimensionValues,
  type SutProfiler,
} from "@lastest/coverage-model";
import { recomputeWeights } from "../sync";

// The profilers themselves (Vault VQL, REST) are pure and live in
// `@lastest/coverage-model`; this module is the half that persists what they
// return. Re-exported so `@/lib/coverage/profilers` stays one import for
// callers that need both.
export {
  extractChurnedObjectTypes,
  VaultProfiler,
  buildVqlGroupQuery,
  parseVaultGroups,
  RestProfiler,
  groupRecords,
  extractRecords,
  groupsToDimensionValues,
  type SutProfiler,
} from "@lastest/coverage-model";

export interface SutProfileOutcome {
  objectType: string;
  fields: string[];
  dimensionsWritten: number;
  cellsWritten: number;
  cellsPruned: number;
  totalRecords: number;
  truncated: boolean;
  warnings: string[];
}

/**
 * Profile one object type and persist both its dimensions and its occurring
 * cells, with production counts.
 *
 * Unlike the P1 profiler, dimensions from a SUT profile are written ENABLED:
 * the user explicitly pointed at this system and named these fields, so there
 * is no auto-detection guess to confirm.
 */
export async function profileFromSut(opts: {
  repositoryId: string;
  environmentKey?: string;
  profiler: SutProfiler;
  objectType: string;
  fields: string[];
  where?: string;
  limit?: number;
}): Promise<SutProfileOutcome> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const warnings: string[] = [];

  const result = await opts.profiler.profile({
    objectType: opts.objectType,
    fields: opts.fields,
    where: opts.where,
    limit: opts.limit,
  });

  if (result.truncated) {
    warnings.push(
      `Profile of ${opts.objectType} was truncated — counts are a lower bound, not the full distribution. Narrow the field set or raise the limit before trusting the weights.`,
    );
  }
  if (result.groups.length === 0) {
    warnings.push(
      `Profile of ${opts.objectType} returned no groups — check the field names and any WHERE filter.`,
    );
    return {
      objectType: opts.objectType,
      fields: opts.fields,
      dimensionsWritten: 0,
      cellsWritten: 0,
      cellsPruned: 0,
      totalRecords: 0,
      truncated: result.truncated,
      warnings,
    };
  }

  const now = new Date();
  let dimensionsWritten = 0;
  for (const field of opts.fields) {
    const values = groupsToDimensionValues(result.groups, field);
    if (values.length === 0) {
      warnings.push(`Field "${field}" produced no values — skipped.`);
      continue;
    }
    await queries.upsertCoverageDimension({
      repositoryId: opts.repositoryId,
      environmentKey,
      objectType: opts.objectType,
      field,
      label: field,
      valueSource: "profiled",
      values,
      cardinality: values.length,
      enabled: true,
      profiledAt: now,
    });
    dimensionsWritten += 1;
  }

  // A SUT profile enumerates the occurring combinations directly — no
  // derivation from local rows needed, and the counts are real.
  const cells = result.groups.map((g) => ({
    repositoryId: opts.repositoryId,
    environmentKey,
    objectType: opts.objectType,
    coordsKey: coordsKey(g.coords),
    coords: g.coords,
    observedCount: g.count,
  }));
  await queries.upsertCoverageCells(cells);

  // Only prune against a COMPLETE profile. On a truncated one, absence from
  // the result means "past the limit", not "no longer occurs" — pruning there
  // would delete live cells and their attribution history.
  let cellsPruned = 0;
  if (!result.truncated) {
    cellsPruned = await queries.pruneCoverageCells(
      opts.repositoryId,
      environmentKey,
      opts.objectType,
      cells.map((c) => c.coordsKey),
    );
  } else {
    warnings.push(
      "Stale cells were not pruned because the profile was truncated.",
    );
  }

  // Cells are written with a default weight of 0, and weight is what orders
  // the QA agent's work queue and drives the stopping rule. Leaving it unset
  // makes a 1,800-record gap rank below a 3-record one, and an all-zero queue
  // trips the marginal-weight stop — the agent is told there is nothing worth
  // testing at 0% coverage. Score them here, as part of profiling.
  await recomputeWeights(opts.repositoryId, { environmentKey });

  return {
    objectType: opts.objectType,
    fields: opts.fields,
    dimensionsWritten,
    cellsWritten: cells.length,
    cellsPruned,
    totalRecords: result.groups.reduce((s, g) => s + g.count, 0),
    truncated: result.truncated,
    warnings,
  };
}
