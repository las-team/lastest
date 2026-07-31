/**
 * Coverage roll-up — the data-driven spec.
 *
 * Rolls the cell ledger up three ways: per object type / DB table, per
 * dimension, and per cell. The per-cell grid, exported, is also the PQ test
 * protocol coverage matrix a validation auditor asks for — the model is built
 * once and used for both the QA agent and the evidence pack.
 */

import type { CoverageCell, CoverageDimension } from "@/lib/db/schema";
import { cartesianSize } from "./cells";
import { computeMetrics, type StopCell } from "./stop";
import { DEFAULT_COVERAGE_STOP_POLICY } from "@/lib/db/schema";

export interface ObjectTypeRollup {
  objectType: string;
  totalCells: number;
  coveredCells: number;
  excludedCells: number;
  failingCells: number;
  cellCoverage: number;
  tupleCoverage: number;
  weightedVolumeCoverage: number;
  /** Full-factorial size of the dimension domains for this object type. */
  cartesianCombinations: number;
  /** cartesian - occurring: the work correctly NOT being done. */
  skippedAsNonOccurring: number;
}

export interface DimensionRollup {
  objectType: string;
  field: string;
  label: string;
  totalValues: number;
  touchedValues: number;
  untouchedValues: string[];
  valueCoverage: number;
}

export interface CoverageReport {
  repositoryId: string;
  environmentKey: string;
  strength: number;
  byObjectType: ObjectTypeRollup[];
  byDimension: DimensionRollup[];
  totals: {
    objectTypes: number;
    dimensions: number;
    cells: number;
    coveredCells: number;
    excludedCells: number;
    cellCoverage: number;
  };
}

const COVERED_STATUSES = new Set(["covered", "failing"]);

/** A cell counts as covered once a run has exercised it — including a run that
 *  failed. A failing cell is tested, it is just broken; folding it into
 *  "uncovered" would make the agent re-plan work it has already done. */
export function isCovered(cell: Pick<CoverageCell, "status" | "runCount">) {
  return COVERED_STATUSES.has(cell.status) || cell.runCount > 0;
}

function toStopCell(cell: CoverageCell): StopCell {
  return {
    coordsKey: cell.coordsKey,
    coords: cell.coords,
    observedCount: cell.observedCount,
    weight: cell.weight,
    covered: isCovered(cell),
    excluded: cell.status === "excluded",
    excludedReason: cell.excludedReason ?? undefined,
  };
}

export function buildCoverageReport(opts: {
  repositoryId: string;
  environmentKey: string;
  cells: CoverageCell[];
  dimensions: CoverageDimension[];
  strength?: number;
}): CoverageReport {
  const strength = opts.strength ?? DEFAULT_COVERAGE_STOP_POLICY.strength;
  const enabledDims = opts.dimensions.filter((d) => d.enabled);

  const objectTypes = [
    ...new Set([
      ...opts.cells.map((c) => c.objectType),
      ...enabledDims.map((d) => d.objectType),
    ]),
  ].sort();

  const byObjectType: ObjectTypeRollup[] = objectTypes.map((objectType) => {
    const cells = opts.cells.filter((c) => c.objectType === objectType);
    const dims = enabledDims.filter((d) => d.objectType === objectType);
    const metrics = computeMetrics(cells.map(toStopCell), strength);
    const eligible = cells.filter((c) => c.status !== "excluded");
    const cartesian =
      dims.length > 0 ? cartesianSize(dims.map((d) => d.cardinality)) : 0;

    return {
      objectType,
      totalCells: cells.length,
      coveredCells: metrics.coveredCells,
      excludedCells: metrics.excludedCells,
      failingCells: cells.filter((c) => c.status === "failing").length,
      cellCoverage:
        eligible.length > 0 ? metrics.coveredCells / eligible.length : 0,
      tupleCoverage: metrics.tupleCoverage,
      weightedVolumeCoverage: metrics.weightedVolumeCoverage,
      cartesianCombinations: cartesian,
      skippedAsNonOccurring: Math.max(0, cartesian - cells.length),
    };
  });

  const byDimension: DimensionRollup[] = enabledDims
    .map((dim) => {
      const touched = new Set(
        opts.cells
          .filter((c) => c.objectType === dim.objectType && isCovered(c))
          .map((c) => c.coords[dim.field])
          .filter((v): v is string => !!v),
      );
      const values = dim.values.map((v) => v.value);
      const untouched = values.filter((v) => !touched.has(v));
      return {
        objectType: dim.objectType,
        field: dim.field,
        label: dim.label ?? dim.field,
        totalValues: values.length,
        touchedValues: values.length - untouched.length,
        untouchedValues: untouched,
        valueCoverage:
          values.length > 0
            ? (values.length - untouched.length) / values.length
            : 0,
      };
    })
    .sort(
      (a, b) =>
        a.objectType.localeCompare(b.objectType) ||
        a.field.localeCompare(b.field),
    );

  const eligibleAll = opts.cells.filter((c) => c.status !== "excluded");
  const coveredAll = eligibleAll.filter(isCovered);

  return {
    repositoryId: opts.repositoryId,
    environmentKey: opts.environmentKey,
    strength,
    byObjectType,
    byDimension,
    totals: {
      objectTypes: objectTypes.length,
      dimensions: enabledDims.length,
      cells: opts.cells.length,
      coveredCells: coveredAll.length,
      excludedCells: opts.cells.length - eligibleAll.length,
      cellCoverage:
        eligibleAll.length > 0 ? coveredAll.length / eligibleAll.length : 0,
    },
  };
}
