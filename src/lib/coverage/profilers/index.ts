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
import { DEFAULT_COVERAGE_ENVIRONMENT } from "@/lib/db/schema";
import { coordsKey } from "../coords";
import { groupsToDimensionValues, type SutProfiler } from "./types";

export * from "./types";
export { VaultProfiler, buildVqlGroupQuery, parseVaultGroups } from "./vault";
export { RestProfiler, groupRecords, extractRecords } from "./rest";

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

/**
 * Vendor-release churn signal.
 *
 * Marks object types a vendor release touched, so their cells outrank equally
 * sized untouched ones. This is the release-wave prioritisation the whole
 * Vault pitch rests on: when 26R2 changes the Call Report layout, the cells on
 * `call__v` should climb the queue on their own.
 *
 * Matching is deliberately literal — a release note naming `call__v` marks
 * `call__v`. Inferring "the release probably affects X" from prose is exactly
 * the kind of guess that would make the churn term untrustworthy.
 */
export function extractChurnedObjectTypes(
  releaseNotes: string,
  knownObjectTypes: string[],
): string[] {
  const haystack = releaseNotes.toLowerCase();
  return knownObjectTypes.filter((t) => {
    const needle = t.toLowerCase();
    // Word-ish boundary so `call__v` does not match inside `recall__vx`.
    const idx = haystack.indexOf(needle);
    if (idx === -1) return false;
    const before = haystack[idx - 1] ?? " ";
    const after = haystack[idx + needle.length] ?? " ";
    return !/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after);
  });
}
