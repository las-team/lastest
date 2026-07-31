/**
 * P3 — replaces the QA agent's hardcoded plan cap with a measured stopping rule.
 *
 * Before this, `MAX_PLAN_ITEMS = 20` WAS the agent's answer to "how far should
 * I go?" — a constant, documented as a defensive backstop, with no relationship
 * to the application or its data. The agent could not say why it stopped at 20,
 * nor what it had chosen not to test.
 *
 * Here the budget comes from the data space instead: how many cells remain
 * uncovered, weighted by real volume and risk, against t-way coverage targets.
 * The constant survives ONLY as an absolute backstop for the case where no
 * coverage model has been built yet.
 */

import {
  DEFAULT_COVERAGE_STOP_POLICY,
  type CoverageStopPolicy,
} from "@/lib/db/schema";
import type { CoverageReport } from "@/lib/coverage/rollup";
import type { StopCell, StopDecision } from "@/lib/coverage/stop";
import { MAX_PLAN_ITEMS } from "./plan";

export interface PlanBudget {
  /** Effective cap on plan items for this run. */
  maxItems: number;
  /** Why that number — shown to the user, and recorded with the plan. */
  rationale: string;
  /** True when a coverage model drove the number rather than the constant. */
  coverageDriven: boolean;
  /** Set when the stop rule says no further planning is warranted at all. */
  shouldStop: boolean;
  stopExplanation?: string;
}

/**
 * Derive the plan budget from the current coverage state.
 *
 * The number of uncovered cells is not the budget directly: one test item can
 * cover several cells (a matrix test covers its whole slice), and the pairwise
 * target means most cells never need a dedicated item. The budget is therefore
 * the count of cells needed to close the t-way gap, floored so the agent always
 * has room to do something useful, and capped by the absolute backstop.
 */
export function computePlanBudget(opts: {
  stop?: StopDecision | null;
  policy?: CoverageStopPolicy;
  /** Absolute ceiling. Browser tests generate sequentially, so an unbounded
   *  plan runs for hours regardless of what coverage says is desirable. */
  hardCap?: number;
}): PlanBudget {
  const policy = { ...DEFAULT_COVERAGE_STOP_POLICY, ...(opts.policy ?? {}) };
  const hardCap = opts.hardCap ?? MAX_PLAN_ITEMS;

  if (!opts.stop || opts.stop.metrics.eligibleCells === 0) {
    return {
      maxItems: hardCap,
      rationale: `No coverage model for this repository yet — falling back to the fixed cap of ${hardCap} items. Profile data dimensions to get a measured budget.`,
      coverageDriven: false,
      shouldStop: false,
    };
  }

  const { metrics, queue, shouldStop, explanation } = opts.stop;

  if (shouldStop) {
    return {
      maxItems: 0,
      rationale: `Coverage targets already met — no new tests warranted. ${explanation}`,
      coverageDriven: true,
      shouldStop: true,
      stopExplanation: explanation,
    };
  }

  // Cells worth planning: above the marginal threshold, ordered by weight.
  const worthwhile = queue.filter(
    (c) => c.weight >= policy.marginalWeightEpsilon,
  );

  // A t-way covering set needs roughly the largest dimension's value count,
  // not one test per cell. Estimate it from the uncovered tuple deficit rather
  // than the raw cell count, or the budget balloons on wide data.
  const tupleDeficit = Math.max(
    0,
    Math.ceil(
      (policy.pairwiseTarget - metrics.tupleCoverage) * metrics.totalTuples,
    ),
  );
  const estimate = Math.max(
    Math.ceil(Math.sqrt(Math.max(tupleDeficit, 1))),
    Math.min(worthwhile.length, 4),
  );
  const maxItems = Math.max(1, Math.min(estimate, hardCap));

  return {
    maxItems,
    rationale:
      `${worthwhile.length} cell(s) above the ${policy.marginalWeightEpsilon} marginal threshold; ` +
      `${tupleDeficit} of ${metrics.totalTuples} ${policy.strength}-way combination(s) still uncovered ` +
      `(currently ${Math.round(metrics.tupleCoverage * 100)}%, target ${Math.round(policy.pairwiseTarget * 100)}%). ` +
      `Budget: ${maxItems} item(s)${maxItems === hardCap ? ` (clipped by the ${hardCap}-item hard cap)` : ""}.`,
    coverageDriven: true,
    shouldStop: false,
  };
}

const MAX_DIRECTIVE_CELLS = 40;

function describeCoords(coords: Record<string, string>): string {
  return Object.entries(coords)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

/**
 * The ranked-cell directive handed to the planner.
 *
 * This is the substantive P3 change to prompting. Previously the planner got a
 * page snapshot and "write a small set of tests" — unverifiable, because there
 * was nothing to check the output against. Now it gets specific data
 * combinations to cover, which makes the plan checkable after the fact: run it,
 * read back the cells the runs exercised, and see which ones actually closed.
 */
export function buildCoverageDirective(opts: {
  report: CoverageReport;
  queue: StopCell[];
  budget: PlanBudget;
  excluded?: StopCell[];
}): string | null {
  if (!opts.budget.coverageDriven) return null;

  const lines: string[] = [
    "--- DATA COVERAGE DIRECTIVE ---",
    "Coverage here is measured over the application's DATA SPACE, not its page count. A 'cell' is a combination of data-dimension values that actually occurs in the data. Plan tests that exercise the UNCOVERED cells listed below, highest weight first.",
    "",
    `Budget: at most ${opts.budget.maxItems} plan item(s). ${opts.budget.rationale}`,
    "",
  ];

  for (const objectType of opts.report.byObjectType) {
    lines.push(
      `Object type "${objectType.objectType}": ${objectType.coveredCells}/${objectType.totalCells} cells covered ` +
        `(${Math.round(objectType.cellCoverage * 100)}%), ` +
        `${Math.round(objectType.tupleCoverage * 100)}% pairwise, ` +
        `${objectType.skippedAsNonOccurring} cartesian combination(s) do not occur in the data and are correctly untested.`,
    );
  }

  const untouched = opts.report.byDimension.filter(
    (d) => d.untouchedValues.length > 0,
  );
  if (untouched.length > 0) {
    lines.push("", "Dimension values never yet exercised:");
    for (const d of untouched.slice(0, 20)) {
      lines.push(
        `- ${d.objectType}.${d.field}: ${d.untouchedValues.slice(0, 12).join(", ")}${d.untouchedValues.length > 12 ? ", …" : ""}`,
      );
    }
  }

  if (opts.queue.length > 0) {
    lines.push(
      "",
      "Uncovered cells, ranked by weight (volume x criticality x failure history x vendor churn, minus redundancy):",
    );
    for (const c of opts.queue.slice(0, MAX_DIRECTIVE_CELLS)) {
      lines.push(
        `- [${c.weight.toFixed(3)}] ${describeCoords(c.coords)}` +
          (c.observedCount > 0 ? ` (${c.observedCount} record(s))` : ""),
      );
    }
    if (opts.queue.length > MAX_DIRECTIVE_CELLS) {
      lines.push(
        `… and ${opts.queue.length - MAX_DIRECTIVE_CELLS} more below the top ${MAX_DIRECTIVE_CELLS}.`,
      );
    }
  }

  const excluded = opts.excluded ?? [];
  if (excluded.length > 0) {
    lines.push("", "Deliberately excluded — do NOT plan tests for these:");
    for (const c of excluded.slice(0, 20)) {
      lines.push(
        `- ${describeCoords(c.coords)}${c.excludedReason ? ` — ${c.excludedReason}` : ""}`,
      );
    }
  }

  lines.push(
    "",
    "Prefer ONE matrix test bound to a data slice over many near-duplicate single-row tests: a test whose variables use sourceRowMode='matrix' with a rowFilter covers its whole slice in one definition. State the intended slice in the item's rationale.",
  );

  return lines.join("\n");
}

/** The user-facing account of what the agent did and did not do. */
export function buildStopSummary(opts: {
  budget: PlanBudget;
  stop?: StopDecision | null;
  plannedItems: number;
}): string {
  if (!opts.budget.coverageDriven || !opts.stop) {
    return `Planned ${opts.plannedItems} item(s) against the fixed cap of ${opts.budget.maxItems}. No data coverage model exists for this repository, so the agent cannot report what it chose not to test — profile data dimensions to enable that.`;
  }
  return `Planned ${opts.plannedItems} item(s). ${opts.budget.rationale} ${opts.stop.explanation}`;
}
