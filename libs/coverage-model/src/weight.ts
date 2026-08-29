/**
 * Cell weighting — the priority signal handed to the planner.
 *
 * Deliberately a plain, inspectable linear formula with per-term contributions
 * retained. If a user cannot see why a cell ranked first, they will not trust
 * the stopping rule that follows from it, and the whole model is worthless.
 *
 *   weight = wVolume*volume + wCriticality*criticality
 *          + wFailureHistory*failure + wChurn*churn
 *          - wRedundancy*redundancy                    (clamped to 0..1)
 */

import {
  DEFAULT_COVERAGE_WEIGHT_POLICY,
  type CoverageWeightBreakdown,
  type CoverageWeightPolicy,
} from "./policy";
import { projectCoords, coordsKey } from "./coords";

export interface WeightInput {
  coordsKey: string;
  coords: Record<string, string>;
  observedCount: number;
  runCount: number;
  failCount: number;
  /** 0..1 business criticality of the object type / functional area. */
  criticality?: number;
  /** 0..1 signal that a vendor release touched this object (D3/B6). */
  churn?: number;
  /** Whether this cell is already covered — drives redundancy for its peers. */
  covered?: boolean;
}

export interface WeightedCell extends WeightInput {
  weight: number;
  breakdown: CoverageWeightBreakdown;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** log1p-normalized volume, relative to the largest cell in the set. Log
 *  because a cell with 100x the records is not 100x the risk. */
export function normalizeVolume(count: number, maxCount: number): number {
  if (maxCount <= 0) return 0;
  return clamp01(Math.log1p(Math.max(count, 0)) / Math.log1p(maxCount));
}

/**
 * Redundancy: the fraction of this cell's value-pairs that are ALREADY covered
 * by some other covered cell. If DE/Detail and FR/Detail both pass, ES/Detail
 * carries little new information and should rank lower. This is what stops the
 * cell space from being worked through exhaustively.
 */
export function redundancy(
  coords: Record<string, string>,
  coveredPairKeys: ReadonlySet<string>,
  strength = 2,
): number {
  const pairs = tupleKeys(coords, strength);
  if (pairs.length === 0) return 0;
  const seen = pairs.filter((p) => coveredPairKeys.has(p)).length;
  return seen / pairs.length;
}

/** All t-way value-tuple keys contained in a cell's coordinates. */
export function tupleKeys(
  coords: Record<string, string>,
  strength: number,
): string[] {
  const fields = Object.keys(coords).sort();
  const t = Math.max(1, Math.min(strength, fields.length));
  const out: string[] = [];
  const combo: string[] = [];

  const walk = (start: number) => {
    if (combo.length === t) {
      out.push(coordsKey(projectCoords(coords, combo)));
      return;
    }
    for (let i = start; i < fields.length; i++) {
      combo.push(fields[i]);
      walk(i + 1);
      combo.pop();
    }
  };
  walk(0);
  return out;
}

/** Every t-way tuple covered by the given cells. */
export function coveredTupleKeys(
  cells: Array<{ coords: Record<string, string> }>,
  strength = 2,
): Set<string> {
  const set = new Set<string>();
  for (const c of cells) {
    for (const k of tupleKeys(c.coords, strength)) set.add(k);
  }
  return set;
}

export function computeWeights(
  cells: WeightInput[],
  policy: CoverageWeightPolicy = DEFAULT_COVERAGE_WEIGHT_POLICY,
  strength = 2,
): WeightedCell[] {
  const maxCount = cells.reduce((m, c) => Math.max(m, c.observedCount), 0);
  const coveredPairs = coveredTupleKeys(
    cells.filter((c) => c.covered),
    strength,
  );

  return cells.map((c) => {
    const volume = normalizeVolume(c.observedCount, maxCount);
    const criticality = clamp01(c.criticality ?? 0.5);
    const failure = c.runCount > 0 ? clamp01(c.failCount / c.runCount) : 0;
    const churn = clamp01(c.churn ?? 0);
    // A covered cell's own tuples are in the covered set; exclude itself so a
    // cell is not penalised for redundancy with nothing but its own coverage.
    const red = c.covered ? 0 : redundancy(c.coords, coveredPairs, strength);

    const terms = {
      volume: policy.wVolume * volume,
      criticality: policy.wCriticality * criticality,
      failureHistory: policy.wFailureHistory * failure,
      churn: policy.wChurn * churn,
      redundancy: policy.wRedundancy * red,
    };
    const total = clamp01(
      terms.volume +
        terms.criticality +
        terms.failureHistory +
        terms.churn -
        terms.redundancy,
    );

    const breakdown: CoverageWeightBreakdown = { ...terms, total };
    return { ...c, weight: total, breakdown };
  });
}
