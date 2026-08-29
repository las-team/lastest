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
  type CoverageCell,
  type CoverageDimension,
  type CoverageStopPolicy,
  type CoverageWeightBreakdown,
  type CoverageWeightPolicy,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import type { AssignedVariableRun } from "@/lib/db/queries";
import { type SourceTable } from "./source-rows";
import {
  csvDataSourceTablesForRepo,
  sheetDataSourceTablesForRepo,
} from "@/lib/core/data-sources-reads";
import { backfillCoverageSnapshots, captureCoverageSnapshot } from "./trend";
import { invalidatePageCoverageAttribution } from "./page-attribution";
import {
  coordsKey,
  deriveCells,
  tableToRecords,
  type DerivedCell,
  profileObservedRuns,
  profileSourceTable,
  type ProfiledDimension,
  computeWeights,
  type WeightInput,
  buildCoverageReport,
  isCovered,
  type CoverageReport,
  evaluateStop,
  type StopDecision,
  type StopCell,
} from "@lastest/coverage-model";

/** Object type used for dimensions inferred from run history, which has no
 *  inherent object type — the variable names are all we know. */
export const OBSERVED_OBJECT_TYPE = "run-variables";

/**
 * Stage boundaries a full sync passes through, in order.
 *
 * Reported to `SyncOptions.onStage` so a DETACHED caller can prove the sync is
 * still alive: `syncCoverage` runs as a `coverage_sync` background job, and
 * `cleanupStaleJobs` marks any `running` job whose lastActivityAt is older than
 * five minutes as crashed. A sync on a large repo takes longer than that, so
 * without these beats the watchdog failed a job whose promise was still
 * working — which lied to the Coverage poller AND broke the per-repo dedupe,
 * letting the next click start a second sync racing the first through
 * reconcile/prune.
 */
export type CoverageSyncStage =
  | "profile"
  | "derive"
  | "attribute"
  | "weight"
  | "snapshot";

export interface CoverageSyncProgress {
  stage: CoverageSyncStage;
  /** Human-readable; safe to show as a background-job label. */
  label: string;
  /** Position within a stage that chunks, when it has one. */
  done?: number;
  total?: number;
}

const STAGE_LABELS: Record<CoverageSyncStage, string> = {
  profile: "Coverage sync: profiling data sources",
  derive: "Coverage sync: deriving cells",
  attribute: "Coverage sync: attributing runs",
  weight: "Coverage sync: scoring cells",
  snapshot: "Coverage sync: recording snapshot",
};

/**
 * How many rows/cells the chunked stages process between beats. Small enough
 * that the five-minute watchdog window cannot close between two of them even
 * on a slow database, large enough that the heartbeat write is noise next to
 * the work it reports on.
 */
const HEARTBEAT_CHUNK = 200;

/**
 * How many cells one weight UPDATE carries.
 *
 * `updateCoverageCellWeights` issues a single `UPDATE ... FROM (VALUES ...)`
 * per call, so this is a statement size, not a loop bound — 500 mirrors the
 * chunk the cell INSERTs already use in `src/lib/db/queries/coverage.ts`, and
 * stays far inside Postgres's bind-parameter ceiling. A beat every 500 cells
 * is still two orders of magnitude inside the five-minute watchdog window.
 */
const WEIGHT_PERSIST_CHUNK = 500;

/**
 * Fire the progress hook, swallowing anything it throws.
 *
 * A heartbeat is bookkeeping for the caller; losing one must never lose the
 * sync. Every call site awaits this, which also yields the event loop inside
 * the CPU-bound matching loop.
 */
async function beat(
  opts: SyncOptions,
  stage: CoverageSyncStage,
  position?: { done: number; total: number },
): Promise<void> {
  if (!opts.onStage) return;
  try {
    await opts.onStage({ stage, label: STAGE_LABELS[stage], ...position });
  } catch (err) {
    console.warn(`[coverage] sync heartbeat (${stage}) failed:`, err);
  }
}

export interface SyncOptions {
  environmentKey?: string;
  weightPolicy?: CoverageWeightPolicy;
  stopPolicy?: CoverageStopPolicy;
  /** Per-object-type business criticality, 0..1. Defaults to 0.5. */
  criticality?: Record<string, number>;
  /** P4: per-object-type vendor-release churn, 0..1. An object type a release
   *  touched outranks an equally sized untouched one — this is the mechanism
   *  behind release-wave prioritisation. Defaults to 0. */
  churn?: Record<string, number>;
  /** Cap on historical runs scanned for profiling/attribution. */
  runLimit?: number;
  /**
   * Runs generated SO FAR IN THE CALLING SESSION, weighed against
   * `stopPolicy.maxRuns` (the QA agent's per-session generation budget).
   *
   * Only a caller that owns a session can know this, so it is passed in and
   * defaults to 0. It must never be back-filled from the ledger: a lifetime
   * count of cells that have ever run is not a session budget, and using one
   * made every repo past `maxRuns` covered cells report `budget_exhausted`
   * permanently — the agent then refused to plan anything, forever, on exactly
   * the repos with the most coverage history.
   */
  runsSoFar?: number;
  /**
   * Progress heartbeat, fired at every stage boundary and every
   * `HEARTBEAT_CHUNK` rows inside the two stages that scale with the data.
   * Best-effort — see `beat`. Only in-process callers set it; it is not
   * serializable across a server-action boundary.
   */
  onStage?: (progress: CoverageSyncProgress) => void | Promise<void>;
}

/**
 * Everything a sync reads from OUTSIDE the coverage tables, loaded once.
 *
 * Each of these was previously fetched by every stage that needed it — the
 * two data-source reads twice and the run scan three times per sync. That is
 * not a cheap repeat: a CSV source resolves to its *full* file, so each fetch
 * re-read the stored blob and re-parsed it, and `getAssignedVariableRuns`
 * scans up to 20,000 jsonb rows.
 *
 * Only read-only-for-the-sync inputs belong here. Dimensions and cells
 * deliberately do NOT: `profileDimensions` writes dimensions and
 * `deriveAndPersistCells` writes cells, so anything preloaded at the top of
 * the sync would describe the state BEFORE the stage that produces it.
 * `syncCoverage` reads those between the stages that write them instead — see
 * the ordering note there.
 */
export interface CoverageSyncInputs {
  csvSources: SourceTable[];
  sheetSources: SourceTable[];
  runs: AssignedVariableRun[];
}

/** Load the shared inputs. Exported stages call this when a caller runs them
 *  standalone; `syncCoverage` calls it once and passes the result down. */
export async function loadCoverageSyncInputs(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<CoverageSyncInputs> {
  const [csvSources, sheetSources, runs] = await Promise.all([
    csvDataSourceTablesForRepo(repositoryId),
    sheetDataSourceTablesForRepo(repositoryId),
    queries.getAssignedVariableRuns(repositoryId, { limit: opts.runLimit }),
  ]);
  return { csvSources, sheetSources, runs };
}

/** How many rows each data source's numbers actually rest on. Reported so a
 *  sampled profile can never be mistaken for the full distribution. */
export interface SourceSample {
  objectType: string;
  profiledRows: number;
  totalRows: number;
  truncated: boolean;
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
  /** Cells dropped as stale — wrong field set, or no longer occurring. */
  cellsPruned: number;
  runsScanned: number;
  attributionsRecorded: number;
  /** Per-source sample size behind the reported record counts. */
  sources: SourceSample[];
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
  /** Preloaded shared inputs. Omit to have this stage load its own — the
   *  standalone signature is unchanged. */
  inputs?: CoverageSyncInputs,
): Promise<{
  proposed: ProfiledDimension[];
  rejected: ProfiledDimension[];
  runsScanned: number;
  sources: SourceSample[];
}> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const { csvSources, sheetSources, runs } =
    inputs ?? (await loadCoverageSyncInputs(repositoryId, opts));

  const proposed: ProfiledDimension[] = [];
  const rejected: ProfiledDimension[] = [];
  const sources: SourceSample[] = [];

  for (const table of csvSources) {
    sources.push(toSample(table));
    const { accepted, rejected: rej } = profileSourceTable(table, "csv");
    proposed.push(...accepted);
    rejected.push(...rej);
  }
  for (const table of sheetSources) {
    sources.push(toSample(table));
    const { accepted, rejected: rej } = profileSourceTable(table, "sheet");
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

  return { proposed, rejected, runsScanned: runs.length, sources };
}

function toSample(table: SourceTable): SourceSample {
  return {
    objectType: table.alias,
    profiledRows: table.profiledRows,
    totalRows: table.totalRows,
    truncated: table.truncated,
  };
}

/**
 * Build the occurring-cell set for every enabled dimension group, and prune
 * anything stale.
 *
 * Pruning is not optional bookkeeping. Enabling or disabling a dimension
 * changes which fields a cell spans, so the previous generation of cells
 * becomes meaningless — but they still count toward the denominator, which
 * quietly corrupts every coverage percentage and every stop decision derived
 * from it. Derivation therefore always reconciles, never just appends.
 */
export async function deriveAndPersistCells(
  repositoryId: string,
  opts: SyncOptions = {},
  /** Preloaded shared inputs. Omit to have this stage load its own. */
  inputs?: CoverageSyncInputs,
): Promise<{
  derived: number;
  pruned: number;
  /** The dimension rows this stage had to read anyway, returned so the caller
   *  can report on them without a second read. Safe to reuse: nothing after
   *  derivation writes dimensions. */
  dimensions: CoverageDimension[];
}> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const allDimensions = await queries.getCoverageDimensions(
    repositoryId,
    environmentKey,
  );
  const dimensions = allDimensions.filter((d) => d.enabled);
  // A SUT-profiled object type stays SUT-owned even if the user disables its
  // dimensions — the cells are still the profiler's to reconcile, not ours to
  // delete.
  const sutObjectTypes = new Set(
    allDimensions
      .filter((d) => d.valueSource === "profiled")
      .map((d) => d.objectType),
  );

  // Object types that had cells but no longer have any enabled dimension must
  // still be visited, or their cells survive forever.
  const existingObjectTypes = await queries.getCoverageCellObjectTypes(
    repositoryId,
    environmentKey,
  );

  if (dimensions.length === 0) {
    let pruned = 0;
    for (const objectType of existingObjectTypes) {
      if (sutObjectTypes.has(objectType)) continue;
      pruned += await queries.pruneCoverageCells(
        repositoryId,
        environmentKey,
        objectType,
        [],
      );
    }
    return { derived: 0, pruned, dimensions: allDimensions };
  }

  const { csvSources, sheetSources, runs } =
    inputs ?? (await loadCoverageSyncInputs(repositoryId, opts));

  const byObjectType = new Map<string, string[]>();
  for (const d of dimensions) {
    byObjectType.set(d.objectType, [
      ...(byObjectType.get(d.objectType) ?? []),
      d.field,
    ]);
  }

  // Object types whose dimensions came from a system-under-test profile are
  // owned by that profiler, which enumerates the occurring combinations
  // directly and reconciles them itself. There is no local table to re-derive
  // them from, so deriving here would produce zero cells and the reconcile
  // below would then delete the entire profile along with its attribution
  // history. Leave them alone.
  const sutOwned = sutObjectTypes;
  for (const objectType of sutOwned) byObjectType.delete(objectType);

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

  // Reconcile every object type that either was just derived or still holds
  // cells from an earlier dimension selection.
  const keptByObjectType = new Map<string, string[]>();
  for (const c of derived) {
    keptByObjectType.set(c.objectType, [
      ...(keptByObjectType.get(c.objectType) ?? []),
      c.coordsKey,
    ]);
  }
  let pruned = 0;
  for (const objectType of new Set([
    ...keptByObjectType.keys(),
    ...existingObjectTypes,
  ])) {
    if (sutOwned.has(objectType)) continue;
    pruned += await queries.pruneCoverageCells(
      repositoryId,
      environmentKey,
      objectType,
      keptByObjectType.get(objectType) ?? [],
    );
  }

  return { derived: derived.length, pruned, dimensions: allDimensions };
}

function recordsForObjectType(
  objectType: string,
  csvSources: SourceTable[],
  sheetSources: SourceTable[],
): Array<Record<string, string>> {
  // objectType defaults to the source alias during profiling, so match on it.
  // Cells are derived from the same full-file view the dimensions were
  // profiled from, or the two disagree about which combinations occur.
  const table =
    csvSources.find((s) => s.alias === objectType) ??
    sheetSources.find((s) => s.alias === objectType);
  return table ? tableToRecords(table.headers, table.rows) : [];
}

/**
 * Attribute historical runs to cells. A run covers a cell when its
 * assignedVariables map contains every coordinate of that cell with matching
 * values — a superset match, since a test may bind variables beyond the ones
 * that happen to be dimensions.
 *
 * The superset rule is per object type, and the MOST SPECIFIC match wins: an
 * object type whose field set is a strict subset of another matched object
 * type's is not credited. A plain run carries no object-type marker, so
 * without this rule any two sources sharing a column name cross-credit each
 * other — a run binding {branch, speed_band, stability, status, viewport}
 * also closed a cell on an unrelated table whose only dimensions happened to
 * be {status, viewport}, inflating that table's coverage with runs that never
 * touched it.
 */
export async function attributeRuns(
  repositoryId: string,
  opts: SyncOptions = {},
  /** Preloaded inputs. `cells` MUST have been read after derivation — see the
   *  ordering note in `syncCoverage`. Omit either to load it here. */
  inputs?: Partial<CoverageSyncInputs> & { cells?: CoverageCell[] },
): Promise<{ runsScanned: number; attributionsRecorded: number }> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const [cells, runs] = await Promise.all([
    inputs?.cells ?? queries.getCoverageCells(repositoryId, { environmentKey }),
    inputs?.runs ??
      queries.getAssignedVariableRuns(repositoryId, { limit: opts.runLimit }),
  ]);
  if (cells.length === 0 || runs.length === 0) {
    return { runsScanned: runs.length, attributionsRecorded: 0 };
  }

  // Index cells by (objectType, field set), so each run is matched by
  // projecting its variable map rather than scanning every cell. The object
  // type is part of the index key because a coordsKey is only unique within
  // one — keying the bucket on coordsKey alone made one of two colliding
  // cells permanently unattributable.
  interface Group {
    objectType: string;
    fields: string[];
    byCoordsKey: Map<string, string>;
  }
  const groups = new Map<string, Group>();
  for (const cell of cells) {
    const fields = Object.keys(cell.coords).sort();
    const key = `${cell.objectType} ${fields.join(",")}`;
    const group = groups.get(key) ?? {
      objectType: cell.objectType,
      fields,
      byCoordsKey: new Map<string, string>(),
    };
    group.byCoordsKey.set(cell.coordsKey, cell.id);
    groups.set(key, group);
  }

  const attributions: Parameters<typeof queries.recordCoverageCellRuns>[0] = [];
  let scanned = 0;
  for (const run of runs) {
    // Every group the run's variable map fully covers.
    const matched: Array<{ group: Group; cellId: string }> = [];
    for (const group of groups.values()) {
      const projected: Record<string, string> = {};
      let complete = true;
      for (const f of group.fields) {
        const v = run.assignedVariables[f];
        if (v === undefined || v === null || String(v).trim() === "") {
          complete = false;
          break;
        }
        projected[f] = String(v).trim();
      }
      if (!complete) continue;
      const cellId = group.byCoordsKey.get(coordsKey(projected));
      if (cellId) matched.push({ group, cellId });
    }

    // Most specific wins: drop any match whose field set is a strict subset of
    // another match's. A run that binds five variables is evidence about the
    // five-dimension table, not about every table that happens to reuse two of
    // its column names.
    const specific = matched.filter(
      ({ group }) =>
        !matched.some(
          (other) =>
            other.group !== group &&
            other.group.fields.length > group.fields.length &&
            group.fields.every((f) => other.group.fields.includes(f)),
        ),
    );

    for (const { cellId } of specific) {
      attributions.push({
        cellId,
        testResultId: run.testResultId,
        testId: run.testId,
        buildId: run.buildId,
        verdict: run.status,
        ranAt: run.ranAt,
      });
    }

    // Matching is O(runs x groups) in memory and can run for minutes on a repo
    // with a long history — one beat per stage would not survive it.
    scanned += 1;
    if (scanned % HEARTBEAT_CHUNK === 0) {
      await beat(opts, "attribute", { done: scanned, total: runs.length });
    }
  }

  await queries.recordCoverageCellRuns(attributions);
  await queries.refreshCoverageCellStats(repositoryId, environmentKey);
  return {
    runsScanned: runs.length,
    attributionsRecorded: attributions.length,
  };
}

/**
 * Score every cell and persist weight + per-term breakdown.
 *
 * Returns the SAME cell rows with the new weight and breakdown applied in
 * memory, so a caller that has to report on what it just wrote (the sync's
 * `buildCoverageReport`/`evaluateStop`) does not re-read the table it is the
 * sole writer of.
 */
export async function recomputeWeights(
  repositoryId: string,
  opts: SyncOptions = {},
  /** Preloaded cells. MUST have been read after attribution: weighting reads
   *  `runCount`/`failCount`/`status`, which `attributeRuns` recomputes in SQL
   *  via `refreshCoverageCellStats`. Omit to read them here. */
  inputs?: { cells?: CoverageCell[] },
): Promise<CoverageCell[]> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const policy = opts.weightPolicy ?? DEFAULT_COVERAGE_WEIGHT_POLICY;
  const strength = (opts.stopPolicy ?? DEFAULT_COVERAGE_STOP_POLICY).strength;
  const cells =
    inputs?.cells ??
    (await queries.getCoverageCells(repositoryId, {
      environmentKey,
    }));
  if (cells.length === 0) return cells;

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
      churn: opts.churn?.[objectType] ?? 0,
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

  // Persist in chunks and beat between them. Each chunk is ONE statement
  // (`UPDATE ... FROM (VALUES ...)`), not one round trip per cell.
  for (let i = 0; i < updates.length; i += WEIGHT_PERSIST_CHUNK) {
    const chunk = updates.slice(i, i + WEIGHT_PERSIST_CHUNK);
    await queries.updateCoverageCellWeights(chunk);
    await beat(opts, "weight", {
      done: Math.min(i + chunk.length, updates.length),
      total: updates.length,
    });
  }

  // Mirror the persisted values onto the rows we were handed, so the caller's
  // copy matches the table without reading it back.
  const byId = new Map(updates.map((u) => [u.id, u]));
  return cells.map((c) => {
    const u = byId.get(c.id);
    return u
      ? { ...c, weight: u.weight, weightBreakdown: u.weightBreakdown }
      : c;
  });
}

/** Full pass: profile → derive → attribute → weight → report → stop decision. */
export async function syncCoverage(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;

  // ── Read ordering ───────────────────────────────────────────────────────
  // Data sources and the historical run scan are read-only for the whole
  // sync, so they are loaded ONCE here and handed to every stage that wants
  // them. The coverage tables are not: each stage writes the rows the next
  // one reads, so those reads have to sit BETWEEN the stages.
  //
  //   dimensions  written by profile → read by derive (and reused after)
  //   cells       written by derive  → read for attribute
  //   cell stats  written by attribute (refreshCoverageCellStats, in SQL)
  //               → cells re-read for weight
  //   weights     written by weight  → applied in memory, never re-read
  //
  // Taking any of those from a snapshot older than the stage that wrote it
  // silently scores the previous generation of the model.
  const inputs = await loadCoverageSyncInputs(repositoryId, opts);

  await beat(opts, "profile");
  const { proposed, rejected, runsScanned, sources } = await profileDimensions(
    repositoryId,
    opts,
    inputs,
  );
  await beat(opts, "derive");
  const {
    derived: cellsUpserted,
    pruned: cellsPruned,
    dimensions,
  } = await deriveAndPersistCells(repositoryId, opts, inputs);

  await beat(opts, "attribute");
  const derivedCells = await queries.getCoverageCells(repositoryId, {
    environmentKey,
  });
  const attribution = await attributeRuns(repositoryId, opts, {
    ...inputs,
    cells: derivedCells,
  });

  await beat(opts, "weight");
  // Re-read: attribution rewrote every cell's run counters and status in SQL,
  // and weighting is a function of exactly those.
  const attributedCells = await queries.getCoverageCells(repositoryId, {
    environmentKey,
  });
  const cells = await recomputeWeights(repositoryId, opts, {
    cells: attributedCells,
  });

  await beat(opts, "snapshot");
  // A sync re-derives the cell set, so page attribution built on the previous
  // one is stale by definition.
  invalidatePageCoverageAttribution(repositoryId);

  const stopPolicy = {
    ...DEFAULT_COVERAGE_STOP_POLICY,
    ...(opts.stopPolicy ?? {}),
  };
  const stopCells: StopCell[] = cells.map((c) => ({
    objectType: c.objectType,
    coordsKey: c.coordsKey,
    coords: c.coords,
    observedCount: c.observedCount,
    weight: c.weight,
    covered: isCovered(c),
    excluded: c.status === "excluded",
    excludedReason: c.excludedReason ?? undefined,
  }));

  const report = buildCoverageReport({
    repositoryId,
    environmentKey,
    cells,
    dimensions,
    strength: stopPolicy.strength,
  });
  const stop = evaluateStop(stopCells, {
    policy: stopPolicy,
    runsSoFar: opts.runsSoFar ?? 0,
  });

  // Snapshot the result, and reconstruct any pre-snapshot history the
  // attribution ledger still holds. Best-effort: a repo whose trend fails to
  // record still has a valid current model, and failing the sync would throw
  // that away too.
  try {
    await captureCoverageSnapshot(repositoryId, {
      environmentKey,
      source: "sync",
      strength: stopPolicy.strength,
      shouldStop: stop.shouldStop,
      // Already in hand and already current — no third read of the two tables
      // this function is, at this moment, the sole writer of.
      cells,
      dimensions,
    });
    await backfillCoverageSnapshots(repositoryId, {
      environmentKey,
      strength: stopPolicy.strength,
    });
  } catch (err) {
    console.warn("[coverage] snapshot/backfill failed:", err);
  }

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
    cellsPruned,
    runsScanned: Math.max(runsScanned, attribution.runsScanned),
    attributionsRecorded: attribution.attributionsRecorded,
    sources,
    report,
    stop,
  };
}

/** How long a coverage model may go unsynced before anything that plans
 *  against it re-derives first. Six hours: long enough that a normal working
 *  day costs a couple of syncs, short enough that an overnight data refresh is
 *  reflected by the morning's scheduled run. */
export const DEFAULT_COVERAGE_MAX_AGE_MINUTES = 360;

export function coverageMaxAgeMs(): number {
  const raw = Number(process.env.COVERAGE_SYNC_INTERVAL_MINUTES);
  const minutes =
    Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COVERAGE_MAX_AGE_MINUTES;
  return minutes * 60_000;
}

/**
 * Has the model gone longer than the max age without a SYNC-sourced snapshot?
 *
 * One snapshot-row read — the cheap gate for callers (the scheduler tick) that
 * only need to DECIDE whether to sync, not to see the report.
 * `ensureFreshCoverage` computes a full report even when fresh, which is the
 * right shape for planning paths that consume it and pure waste for a
 * once-a-minute staleness poll.
 */
export async function coverageIsStale(
  repositoryId: string,
  environmentKey: string = DEFAULT_COVERAGE_ENVIRONMENT,
  maxAgeMs: number = coverageMaxAgeMs(),
): Promise<boolean> {
  const { stale } = await coverageStaleness(
    repositoryId,
    environmentKey,
    maxAgeMs,
  );
  return stale;
}

/**
 * The same one-row read as `coverageIsStale`, but reporting HOW stale.
 *
 * A caller that can only start a few syncs per tick has to choose between the
 * stale repos, and the only fair basis for that choice is age — starting from
 * the head of a repo list means the tail starves whenever the backlog is
 * longer than the per-tick budget. `ageMs` is `Infinity` for a model that has
 * never been sync-derived, which sorts it first, where it belongs.
 */
export async function coverageStaleness(
  repositoryId: string,
  environmentKey: string = DEFAULT_COVERAGE_ENVIRONMENT,
  maxAgeMs: number = coverageMaxAgeMs(),
): Promise<{ stale: boolean; ageMs: number; lastSyncedAt: Date | null }> {
  const latest = await queries
    .getLatestCoverageSnapshot(repositoryId, environmentKey, { source: "sync" })
    .catch(() => null);
  const lastSyncedAt = latest?.capturedAt ?? null;
  const ageMs = lastSyncedAt ? Date.now() - lastSyncedAt.getTime() : Infinity;
  return { stale: ageMs > maxAgeMs, ageMs, lastSyncedAt };
}

/**
 * Re-derive the model if it has gone stale, then report.
 *
 * The failure this closes: `syncCoverage` only ever ran from the Coverage
 * page, so a scheduled QA run planned against whatever the last human visit
 * left behind — a CSV refreshed since then was invisible, and the "uncovered
 * cells" queue it worked from described a data space that no longer existed.
 *
 * A failed re-sync is not fatal. A stale model still beats no model, so the
 * previous state is reported with `stale: true` rather than throwing into the
 * caller's planning path.
 */
export async function ensureFreshCoverage(
  repositoryId: string,
  opts: SyncOptions & { maxAgeMs?: number; force?: boolean } = {},
): Promise<{
  report: CoverageReport;
  stop: StopDecision;
  synced: boolean;
  stale: boolean;
  lastSyncedAt: Date | null;
}> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const maxAgeMs = opts.maxAgeMs ?? coverageMaxAgeMs();
  // Only a SYNC snapshot marks the model as derived. Builds write a snapshot
  // per run against the existing cell set; counting those as freshness kept
  // resetting this clock, so an actively-building repo never re-profiled its
  // data sources and planning ran forever against the cell space of whenever a
  // human last opened the Coverage page.
  const latest = await queries
    .getLatestCoverageSnapshot(repositoryId, environmentKey, { source: "sync" })
    .catch(() => null);
  const lastSyncedAt = latest?.capturedAt ?? null;
  const age = lastSyncedAt ? Date.now() - lastSyncedAt.getTime() : Infinity;
  const needsSync = opts.force === true || age > maxAgeMs;

  if (needsSync) {
    try {
      const result = await syncCoverage(repositoryId, opts);
      return {
        report: result.report,
        stop: result.stop,
        synced: true,
        stale: false,
        lastSyncedAt: new Date(),
      };
    } catch (err) {
      console.warn(
        `[coverage] re-sync failed for repo ${repositoryId}, reporting stale model:`,
        err,
      );
      const fallback = await getCoverageReport(repositoryId, opts);
      return { ...fallback, synced: false, stale: true, lastSyncedAt };
    }
  }

  const current = await getCoverageReport(repositoryId, opts);
  return { ...current, synced: false, stale: false, lastSyncedAt };
}

/**
 * Live attribution for a just-finished build.
 *
 * Called from the build-completion path so coverage reflects reality without
 * waiting for a manual sync. Cheap: it only touches cells whose coordsKey the
 * build actually produced, and it never creates cells — a run against a
 * combination with no cell means the dimension set does not cover it, which is
 * a profiling gap to surface, not a cell to invent.
 */
export async function attributeBuildRuns(
  repositoryId: string,
  results: Array<{
    testResultId: string;
    testId?: string | null;
    buildId?: string | null;
    dataCell?: string | null;
    status?: string | null;
    ranAt?: Date | null;
  }>,
  opts: SyncOptions = {},
): Promise<{ attributed: number; unmatchedCells: string[] }> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const withCells = results.filter((r) => !!r.dataCell);
  if (withCells.length === 0) return { attributed: 0, unmatchedCells: [] };

  const cells = await queries.getCoverageCells(repositoryId, {
    environmentKey,
  });
  // One coordsKey can belong to several object types, and a matrix run's
  // data_cell records only the coordinates — the source alias behind them is
  // not persisted. A Map keyed on coordsKey therefore kept exactly one of the
  // colliding cells and left the other permanently unattributable, so a real
  // run against it never registered. Every cell carrying those coordinates is
  // credited instead: they are the same fields with the same values, and
  // silently dropping one of them loses coverage that was genuinely exercised.
  const byKey = new Map<string, string[]>();
  for (const c of cells) {
    byKey.set(c.coordsKey, [...(byKey.get(c.coordsKey) ?? []), c.id]);
  }

  const attributions: Parameters<typeof queries.recordCoverageCellRuns>[0] = [];
  const unmatched = new Set<string>();
  for (const r of withCells) {
    const cellIds = byKey.get(r.dataCell!);
    if (!cellIds || cellIds.length === 0) {
      unmatched.add(r.dataCell!);
      continue;
    }
    for (const cellId of cellIds) {
      attributions.push({
        cellId,
        testResultId: r.testResultId,
        testId: r.testId ?? null,
        buildId: r.buildId ?? null,
        verdict: r.status ?? null,
        ranAt: r.ranAt ?? null,
      });
    }
  }

  if (attributions.length > 0) {
    await queries.recordCoverageCellRuns(attributions);
    await queries.refreshCoverageCellStats(repositoryId, environmentKey);
    // New attributions change which cells sit on which page.
    invalidatePageCoverageAttribution(repositoryId);
  }
  return { attributed: attributions.length, unmatchedCells: [...unmatched] };
}

/**
 * Build the report + stop decision from rows ALREADY read.
 *
 * Separated from `getCoverageReport` so a caller that needs the cells and
 * dimensions for its own rendering does not have to fetch them twice. Pure
 * apart from the policy merge.
 */
export function coverageReportFrom(opts: {
  repositoryId: string;
  environmentKey: string;
  cells: CoverageCell[];
  dimensions: CoverageDimension[];
  stopPolicy?: CoverageStopPolicy;
  /** Runs generated so far in the CALLING session — see SyncOptions.runsSoFar.
   *  A report is not a session, so this defaults to 0. */
  runsSoFar?: number;
}): { report: CoverageReport; stop: StopDecision } {
  const stopPolicy = {
    ...DEFAULT_COVERAGE_STOP_POLICY,
    ...(opts.stopPolicy ?? {}),
  };
  return {
    report: buildCoverageReport({
      repositoryId: opts.repositoryId,
      environmentKey: opts.environmentKey,
      cells: opts.cells,
      dimensions: opts.dimensions,
      strength: stopPolicy.strength,
    }),
    stop: evaluateStop(
      opts.cells.map((c) => ({
        objectType: c.objectType,
        coordsKey: c.coordsKey,
        coords: c.coords,
        observedCount: c.observedCount,
        weight: c.weight,
        covered: isCovered(c),
        excluded: c.status === "excluded",
        excludedReason: c.excludedReason ?? undefined,
      })),
      { policy: stopPolicy, runsSoFar: opts.runsSoFar ?? 0 },
    ),
  };
}

/** Read-only report — no profiling, no writes. */
export async function getCoverageReport(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<{ report: CoverageReport; stop: StopDecision }> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const [cells, dimensions] = await Promise.all([
    queries.getCoverageCells(repositoryId, { environmentKey }),
    queries.getCoverageDimensions(repositoryId, environmentKey),
  ]);
  return coverageReportFrom({
    repositoryId,
    environmentKey,
    cells,
    dimensions,
    stopPolicy: opts.stopPolicy,
    runsSoFar: opts.runsSoFar,
  });
}
