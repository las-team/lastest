/**
 * Coverage sync — the P1 orchestration.
 *
 *   1. profile  — derive candidate dimensions from CSV/Sheet caches and from
 *                 historical assignedVariables maps
 *   2. derive   — build the cells that actually occur, from those same sources
 *   3. attribute— link historical runs to cells via assignedVariables
 *   4. weight   — score every cell, with the per-term breakdown retained
 *
 * Nothing here talks to the system under test. That is D3 — this phase only
 * measures using data Lastest already holds.
 */

import {
  DEFAULT_COVERAGE_ENVIRONMENT,
  DEFAULT_COVERAGE_STOP_POLICY,
  DEFAULT_COVERAGE_WEIGHT_POLICY,
  type CoverageStopPolicy,
  type CoverageWeightBreakdown,
  type CoverageWeightPolicy,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { coordsKey } from "./coords";
import { deriveCells, tableToRecords, type DerivedCell } from "./cells";
import {
  profileCsvSource,
  profileObservedRuns,
  profileSheetSource,
  type ProfiledDimension,
} from "./dimensions";
import { computeWeights, type WeightInput } from "./weight";
import { buildCoverageReport, isCovered, type CoverageReport } from "./rollup";
import { evaluateStop, type StopDecision, type StopCell } from "./stop";

/** Object type used for dimensions inferred from run history, which has no
 *  inherent object type — the variable names are all we know. */
export const OBSERVED_OBJECT_TYPE = "run-variables";

export interface SyncOptions {
  environmentKey?: string;
  weightPolicy?: CoverageWeightPolicy;
  stopPolicy?: CoverageStopPolicy;
  /** Per-object-type business criticality, 0..1. Defaults to 0.5. */
  criticality?: Record<string, number>;
  /** Cap on historical runs scanned for profiling/attribution. */
  runLimit?: number;
}

export interface SyncResult {
  environmentKey: string;
  dimensionsProposed: number;
  dimensionsRejected: Array<{
    objectType: string;
    field: string;
    reason: string;
  }>;
  dimensionsEnabled: number;
  cellsUpserted: number;
  runsScanned: number;
  attributionsRecorded: number;
  report: CoverageReport;
  /** Only meaningful once dimensions are enabled; all-zero before that. */
  stop: StopDecision;
}

/**
 * Profile candidate dimensions and persist them. Auto-detected dimensions land
 * disabled — the user confirms them. That is deliberate: a profiler that
 * silently enables everything it finds turns one bad free-text column into
 * thousands of junk cells, and the coverage number becomes meaningless.
 */
export async function profileDimensions(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<{
  proposed: ProfiledDimension[];
  rejected: ProfiledDimension[];
  runsScanned: number;
}> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const [csvSources, sheetSources, runs] = await Promise.all([
    queries.getCsvDataSources(repositoryId),
    queries.getGoogleSheetsDataSources(repositoryId),
    queries.getAssignedVariableRuns(repositoryId, { limit: opts.runLimit }),
  ]);

  const proposed: ProfiledDimension[] = [];
  const rejected: ProfiledDimension[] = [];

  for (const source of csvSources) {
    const { accepted, rejected: rej } = profileCsvSource(source);
    proposed.push(...accepted);
    rejected.push(...rej);
  }
  for (const source of sheetSources) {
    const { accepted, rejected: rej } = profileSheetSource(source);
    proposed.push(...accepted);
    rejected.push(...rej);
  }
  if (runs.length > 0) {
    const { accepted, rejected: rej } = profileObservedRuns(
      runs.map((r) => r.assignedVariables),
      { objectType: OBSERVED_OBJECT_TYPE },
    );
    proposed.push(...accepted);
    rejected.push(...rej);
  }

  const now = new Date();
  for (const dim of proposed) {
    await queries.upsertCoverageDimension({
      repositoryId,
      environmentKey,
      objectType: dim.objectType,
      field: dim.field,
      label: dim.label,
      valueSource: dim.valueSource,
      sourceAlias: dim.sourceAlias,
      values: dim.values,
      cardinality: dim.cardinality,
      profiledAt: now,
    });
  }

  return { proposed, rejected, runsScanned: runs.length };
}

/** Build the occurring-cell set for every enabled dimension group. */
export async function deriveAndPersistCells(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<number> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const dimensions = (
    await queries.getCoverageDimensions(repositoryId, environmentKey)
  ).filter((d) => d.enabled);
  if (dimensions.length === 0) return 0;

  const [csvSources, sheetSources, runs] = await Promise.all([
    queries.getCsvDataSources(repositoryId),
    queries.getGoogleSheetsDataSources(repositoryId),
    queries.getAssignedVariableRuns(repositoryId, { limit: opts.runLimit }),
  ]);

  const byObjectType = new Map<string, string[]>();
  for (const d of dimensions) {
    byObjectType.set(d.objectType, [
      ...(byObjectType.get(d.objectType) ?? []),
      d.field,
    ]);
  }

  const derived: DerivedCell[] = [];
  for (const [objectType, fields] of byObjectType) {
    const records =
      objectType === OBSERVED_OBJECT_TYPE
        ? runs.map((r) => r.assignedVariables)
        : recordsForObjectType(objectType, csvSources, sheetSources);
    derived.push(...deriveCells({ objectType, fields, records }));
  }

  await queries.upsertCoverageCells(
    derived.map((c) => ({
      repositoryId,
      environmentKey,
      objectType: c.objectType,
      coordsKey: c.coordsKey,
      coords: c.coords,
      observedCount: c.observedCount,
    })),
  );
  return derived.length;
}

function recordsForObjectType(
  objectType: string,
  csvSources: Awaited<ReturnType<typeof queries.getCsvDataSources>>,
  sheetSources: Awaited<ReturnType<typeof queries.getGoogleSheetsDataSources>>,
): Array<Record<string, string>> {
  // objectType defaults to the source alias during profiling, so match on it.
  const csv = csvSources.find((s) => s.alias === objectType);
  if (csv) {
    return tableToRecords(csv.cachedHeaders ?? [], csv.cachedData ?? []);
  }
  const sheet = sheetSources.find((s) => s.alias === objectType);
  if (sheet) {
    return tableToRecords(sheet.cachedHeaders ?? [], sheet.cachedData ?? []);
  }
  return [];
}

/**
 * Attribute historical runs to cells. A run covers a cell when its
 * assignedVariables map contains every coordinate of that cell with matching
 * values — a superset match, since a test may bind variables beyond the ones
 * that happen to be dimensions.
 */
export async function attributeRuns(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<{ runsScanned: number; attributionsRecorded: number }> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const [cells, runs] = await Promise.all([
    queries.getCoverageCells(repositoryId, { environmentKey }),
    queries.getAssignedVariableRuns(repositoryId, { limit: opts.runLimit }),
  ]);
  if (cells.length === 0 || runs.length === 0) {
    return { runsScanned: runs.length, attributionsRecorded: 0 };
  }

  // Index cells by the fields they constrain, so each run is matched by
  // projecting its variable map rather than scanning every cell.
  const byFieldSet = new Map<string, Map<string, string>>();
  for (const cell of cells) {
    const fields = Object.keys(cell.coords).sort();
    const fieldSetKey = fields.join(",");
    const bucket = byFieldSet.get(fieldSetKey) ?? new Map<string, string>();
    bucket.set(cell.coordsKey, cell.id);
    byFieldSet.set(fieldSetKey, bucket);
  }

  const attributions: Parameters<typeof queries.recordCoverageCellRuns>[0] = [];
  for (const run of runs) {
    for (const [fieldSetKey, bucket] of byFieldSet) {
      const fields = fieldSetKey.split(",");
      const projected: Record<string, string> = {};
      let complete = true;
      for (const f of fields) {
        const v = run.assignedVariables[f];
        if (v === undefined || v === null || String(v).trim() === "") {
          complete = false;
          break;
        }
        projected[f] = String(v).trim();
      }
      if (!complete) continue;

      const cellId = bucket.get(coordsKey(projected));
      if (!cellId) continue;
      attributions.push({
        cellId,
        testResultId: run.testResultId,
        testId: run.testId,
        buildId: run.buildId,
        verdict: run.status,
        ranAt: run.ranAt,
      });
    }
  }

  await queries.recordCoverageCellRuns(attributions);
  await queries.refreshCoverageCellStats(repositoryId, environmentKey);
  return {
    runsScanned: runs.length,
    attributionsRecorded: attributions.length,
  };
}

/** Score every cell and persist weight + per-term breakdown. */
export async function recomputeWeights(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<void> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const policy = opts.weightPolicy ?? DEFAULT_COVERAGE_WEIGHT_POLICY;
  const strength = (opts.stopPolicy ?? DEFAULT_COVERAGE_STOP_POLICY).strength;
  const cells = await queries.getCoverageCells(repositoryId, {
    environmentKey,
  });
  if (cells.length === 0) return;

  // Weighting is relative within an object type — volumes are not comparable
  // across different tables, so normalizing globally would distort ranking.
  const byObjectType = new Map<string, typeof cells>();
  for (const c of cells) {
    byObjectType.set(c.objectType, [
      ...(byObjectType.get(c.objectType) ?? []),
      c,
    ]);
  }

  const updates: Array<{
    id: string;
    weight: number;
    weightBreakdown: CoverageWeightBreakdown;
  }> = [];

  for (const [objectType, group] of byObjectType) {
    const inputs: Array<WeightInput & { id: string }> = group.map((c) => ({
      id: c.id,
      coordsKey: c.coordsKey,
      coords: c.coords,
      observedCount: c.observedCount,
      runCount: c.runCount,
      failCount: c.failCount,
      criticality: opts.criticality?.[objectType] ?? 0.5,
      covered: isCovered(c),
    }));
    const weighted = computeWeights(inputs, policy, strength);
    weighted.forEach((w, i) => {
      updates.push({
        id: inputs[i].id,
        weight: w.weight,
        weightBreakdown: w.breakdown,
      });
    });
  }

  await queries.updateCoverageCellWeights(updates);
}

/** Full pass: profile → derive → attribute → weight → report → stop decision. */
export async function syncCoverage(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;

  const { proposed, rejected, runsScanned } = await profileDimensions(
    repositoryId,
    opts,
  );
  const cellsUpserted = await deriveAndPersistCells(repositoryId, opts);
  const attribution = await attributeRuns(repositoryId, opts);
  await recomputeWeights(repositoryId, opts);

  const [cells, dimensions] = await Promise.all([
    queries.getCoverageCells(repositoryId, { environmentKey }),
    queries.getCoverageDimensions(repositoryId, environmentKey),
  ]);

  const stopPolicy = {
    ...DEFAULT_COVERAGE_STOP_POLICY,
    ...(opts.stopPolicy ?? {}),
  };
  const stopCells: StopCell[] = cells.map((c) => ({
    coordsKey: c.coordsKey,
    coords: c.coords,
    observedCount: c.observedCount,
    weight: c.weight,
    covered: isCovered(c),
    excluded: c.status === "excluded",
    excludedReason: c.excludedReason ?? undefined,
  }));

  return {
    environmentKey,
    dimensionsProposed: proposed.length,
    dimensionsRejected: rejected.map((r) => ({
      objectType: r.objectType,
      field: r.field,
      reason: r.rejectedReason ?? "rejected",
    })),
    dimensionsEnabled: dimensions.filter((d) => d.enabled).length,
    cellsUpserted,
    runsScanned: Math.max(runsScanned, attribution.runsScanned),
    attributionsRecorded: attribution.attributionsRecorded,
    report: buildCoverageReport({
      repositoryId,
      environmentKey,
      cells,
      dimensions,
      strength: stopPolicy.strength,
    }),
    stop: evaluateStop(stopCells, {
      policy: stopPolicy,
      runsSoFar: cells.filter((c) => c.runCount > 0).length,
    }),
  };
}

/** Read-only report — no profiling, no writes. */
export async function getCoverageReport(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<{ report: CoverageReport; stop: StopDecision }> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const stopPolicy = {
    ...DEFAULT_COVERAGE_STOP_POLICY,
    ...(opts.stopPolicy ?? {}),
  };
  const [cells, dimensions] = await Promise.all([
    queries.getCoverageCells(repositoryId, { environmentKey }),
    queries.getCoverageDimensions(repositoryId, environmentKey),
  ]);

  return {
    report: buildCoverageReport({
      repositoryId,
      environmentKey,
      cells,
      dimensions,
      strength: stopPolicy.strength,
    }),
    stop: evaluateStop(
      cells.map((c) => ({
        coordsKey: c.coordsKey,
        coords: c.coords,
        observedCount: c.observedCount,
        weight: c.weight,
        covered: isCovered(c),
        excluded: c.status === "excluded",
        excludedReason: c.excludedReason ?? undefined,
      })),
      {
        policy: stopPolicy,
        runsSoFar: cells.filter((c) => c.runCount > 0).length,
      },
    ),
  };
}
