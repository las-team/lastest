/**
 * The stopping rule — what replaces `MAX_PLAN_ITEMS = 20`.
 *
 * The established answer to "how far into a combinatorial space" is
 * combinatorial test design: target t-way (default pairwise) coverage of the
 * value combinations that occur, rather than the full cartesian product. For
 * 12 countries x 8 call types x 4 channels that is ~15-20 runs instead of
 * hundreds, and it catches the large majority of interaction defects.
 *
 * Every evaluation returns a human-readable explanation. An agent that stops
 * without being able to say what it skipped and why is not trustworthy, and
 * that — not the raw number of tests — is the actual deliverable here.
 */

import {
  DEFAULT_COVERAGE_STOP_POLICY,
  type CoverageStopPolicy,
} from "./policy";
import { tupleKeys, coveredTupleKeys } from "./weight";

export interface StopCell {
  /** A cell's identity is (objectType, coordsKey) — the coordsKey alone is not
   *  unique, because two data sources can share a column name and a value
   *  ("status=passed|viewport=1280x720" occurs in more than one table). Every
   *  consumer that resolves a queue entry back to a cell needs both halves. */
  objectType: string;
  coordsKey: string;
  coords: Record<string, string>;
  observedCount: number;
  weight: number;
  covered: boolean;
  excluded?: boolean;
  excludedReason?: string;
}

export interface CoverageMetrics {
  /** Cells that occur in the data and are not excluded. */
  eligibleCells: number;
  coveredCells: number;
  excludedCells: number;
  /** t-way tuples present in eligible cells, and how many are covered. */
  totalTuples: number;
  coveredTuples: number;
  tupleCoverage: number;
  /** Share of observed record volume sitting in covered cells. */
  weightedVolumeCoverage: number;
  /** Highest-weight uncovered cell, if any. */
  nextBest: StopCell | null;
  marginalWeight: number;
}

export type StopReason =
  | "targets_met"
  | "marginal_below_epsilon"
  | "budget_exhausted"
  | "no_work_left";

export interface StopDecision {
  shouldStop: boolean;
  reasons: StopReason[];
  metrics: CoverageMetrics;
  /** Ranked uncovered cells, highest weight first — the planner's work queue. */
  queue: StopCell[];
  explanation: string;
}

export function computeMetrics(
  cells: StopCell[],
  strength = DEFAULT_COVERAGE_STOP_POLICY.strength,
): CoverageMetrics {
  const eligible = cells.filter((c) => !c.excluded);
  const covered = eligible.filter((c) => c.covered);

  const allTuples = new Set<string>();
  for (const c of eligible) {
    for (const k of tupleKeys(c.coords, strength)) allTuples.add(k);
  }
  const coveredTuples = coveredTupleKeys(covered, strength);
  // Intersect: a covered cell can only cover tuples that exist in the universe.
  let coveredTupleCount = 0;
  for (const k of coveredTuples) if (allTuples.has(k)) coveredTupleCount += 1;

  const totalVolume = eligible.reduce((s, c) => s + c.observedCount, 0);
  const coveredVolume = covered.reduce((s, c) => s + c.observedCount, 0);

  const uncovered = eligible
    .filter((c) => !c.covered)
    .sort(
      (a, b) => b.weight - a.weight || a.coordsKey.localeCompare(b.coordsKey),
    );

  return {
    eligibleCells: eligible.length,
    coveredCells: covered.length,
    excludedCells: cells.length - eligible.length,
    totalTuples: allTuples.size,
    coveredTuples: coveredTupleCount,
    tupleCoverage: allTuples.size > 0 ? coveredTupleCount / allTuples.size : 1,
    weightedVolumeCoverage:
      totalVolume > 0
        ? coveredVolume / totalVolume
        : eligible.length > 0
          ? covered.length / eligible.length
          : 1,
    nextBest: uncovered[0] ?? null,
    marginalWeight: uncovered[0]?.weight ?? 0,
  };
}

export function evaluateStop(
  cells: StopCell[],
  opts: {
    policy?: CoverageStopPolicy;
    /** Runs already generated/executed this session, against policy.maxRuns. */
    runsSoFar?: number;
    /** Remaining budget in minutes; <= 0 stops. Undefined = unbounded. */
    budgetMinutesRemaining?: number;
  } = {},
): StopDecision {
  const policy = { ...DEFAULT_COVERAGE_STOP_POLICY, ...(opts.policy ?? {}) };
  const metrics = computeMetrics(cells, policy.strength);
  const reasons: StopReason[] = [];

  const queue = cells
    .filter((c) => !c.excluded && !c.covered)
    .sort(
      (a, b) => b.weight - a.weight || a.coordsKey.localeCompare(b.coordsKey),
    );

  if (queue.length === 0) {
    reasons.push("no_work_left");
  } else {
    const targetsMet =
      metrics.tupleCoverage >= policy.pairwiseTarget &&
      metrics.weightedVolumeCoverage >= policy.weightedVolumeTarget;
    if (targetsMet) reasons.push("targets_met");
    // The marginal-weight rule is a diminishing-returns test: the next cell is
    // not worth the run GIVEN what has already been covered. With nothing
    // covered at all there are no diminishing returns to detect, and firing it
    // there tells the agent to stop before it has done anything — which is
    // exactly what an unweighted cell set (weight defaults to 0) produces.
    if (
      metrics.coveredCells > 0 &&
      metrics.marginalWeight < policy.marginalWeightEpsilon
    ) {
      reasons.push("marginal_below_epsilon");
    }
  }

  const runsSoFar = opts.runsSoFar ?? 0;
  if (
    runsSoFar >= policy.maxRuns ||
    (opts.budgetMinutesRemaining !== undefined &&
      opts.budgetMinutesRemaining <= 0)
  ) {
    reasons.push("budget_exhausted");
  }

  return {
    shouldStop: reasons.length > 0,
    reasons,
    metrics,
    queue,
    explanation: explain(metrics, reasons, policy, runsSoFar, cells),
  };
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

function describeCell(c: StopCell): string {
  const coords = Object.entries(c.coords)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
    .join(" / ");
  return coords || c.coordsKey;
}

export function explain(
  metrics: CoverageMetrics,
  reasons: StopReason[],
  policy: CoverageStopPolicy,
  runsSoFar: number,
  cells: StopCell[],
): string {
  const parts: string[] = [];
  const wayLabel =
    policy.strength === 2 ? "Pairwise" : `${policy.strength}-way`;

  parts.push(
    reasons.length > 0
      ? `Stopped after ${runsSoFar} run(s).`
      : `Continuing after ${runsSoFar} run(s).`,
  );
  parts.push(
    `${wayLabel} coverage ${pct(metrics.tupleCoverage)} (${metrics.coveredTuples}/${metrics.totalTuples} combinations), weighted volume ${pct(metrics.weightedVolumeCoverage)}, cells ${metrics.coveredCells}/${metrics.eligibleCells}.`,
  );

  if (reasons.includes("no_work_left")) {
    parts.push("No uncovered cells remain.");
  } else if (metrics.nextBest) {
    const label = describeCell(metrics.nextBest);
    const share =
      metrics.nextBest.observedCount > 0
        ? ` — ${metrics.nextBest.observedCount} record(s)`
        : "";
    parts.push(
      reasons.includes("marginal_below_epsilon")
        ? `Next best cell (${label}${share}) scores ${metrics.marginalWeight.toFixed(3)}, below the ${policy.marginalWeightEpsilon} marginal threshold.`
        : `Next best cell: ${label}${share}, weight ${metrics.marginalWeight.toFixed(3)}.`,
    );
  }

  if (reasons.includes("budget_exhausted")) {
    parts.push(`Budget exhausted (cap ${policy.maxRuns} runs).`);
  }

  const excluded = cells.filter((c) => c.excluded);
  if (excluded.length > 0) {
    const sample = excluded[0]?.excludedReason;
    parts.push(
      `${excluded.length} combination(s) excluded${sample ? `: ${sample}` : "."}`,
    );
  }

  return parts.join(" ");
}
