/**
 * Assessment: the pure judgement layer that sits on top of the clustering
 * pre-pass.
 *
 * `cluster.ts` answers "what belongs together". This module answers everything
 * the Run Results screen needs *after* that:
 *
 *   - `groupRisk`      — how much this cluster should worry a reviewer,
 *   - `suggestVerdict` — the reviewer action the model recommends,
 *   - `rankGroups`     — the order the clusters are shown in,
 *   - `deriveRunCounts`— the run-level tallies above the list,
 *   - `describeAge`    — "new this run" / "present since run 2".
 *
 * Everything here is a total function of its arguments. No database, no clock,
 * no AI client, no randomness — the same input always produces the same output,
 * which is what makes a "skipped" (AI-off) triage run still useful.
 */

import type { TriageCandidateHistory } from "./cluster";
import type { TriageCaseStatus, TriageGroupKind, TriageVerdict } from "./types";

/**
 * Risk band of a cluster. Structurally identical to `ChangeRisk` in
 * `packages/db/src/schema/runs.ts` (which the pure half must not import), and
 * persisted into `triage_groups.risk` verbatim.
 */
export type TriageRisk = "low" | "medium" | "high";

/** One case, narrowed to what assessment reads. */
export interface AssessCase {
  testId: string;
  stepLabel?: string | null;
  status: TriageCaseStatus;
  browser?: string | null;
  layers?: readonly string[] | null;
  /** Percentage of pixels changed, when this case came from a visual diff. */
  diffPercentage?: number | null;
  history?: TriageCandidateHistory | null;
}

/** One cluster, narrowed to what assessment reads. */
export interface AssessGroup {
  /** Stable key within the run — `ClusterGroup.key`. */
  key: string;
  kind: TriageGroupKind;
  /** 0-100. */
  confidence: number;
  cases: readonly AssessCase[];
  /** Browsers the cluster spans. Derived from `cases` when omitted. */
  browsers?: readonly string[];
  /** Check layers the cluster's cases flagged. Derived from `cases` when omitted. */
  layers?: readonly string[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Verdict-map key. Must match `triageVerdictKey()` in
 * `src/lib/db/queries/triage.ts` — the identity of a case that survives
 * re-triage. Duplicated (not imported) because this half must stay DB-free.
 */
export function triageCaseKey(
  testId: string,
  stepLabel: string | null | undefined,
): string {
  return `${testId}::${stepLabel ?? ""}`;
}

function uniqueSorted(
  values: readonly (string | null | undefined)[],
): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

function groupBrowsers(group: AssessGroup): string[] {
  return group.browsers
    ? uniqueSorted(group.browsers)
    : uniqueSorted(group.cases.map((c) => c.browser));
}

function groupLayers(group: AssessGroup): string[] {
  return group.layers
    ? uniqueSorted(group.layers)
    : uniqueSorted(group.cases.flatMap((c) => [...(c.layers ?? [])]));
}

/**
 * Layers that are a regression signal on their own: a new console error, a new
 * 4xx/5xx, a URL divergence or a new a11y violation is never "just pixels".
 * Mirrors the `signal: "high"` layers in the Verify evidence model.
 */
export const HIGH_SIGNAL_LAYERS: readonly string[] = [
  "console",
  "network",
  "url",
  "a11y",
];

// ---------------------------------------------------------------------------
// groupRisk
// ---------------------------------------------------------------------------

/**
 * Risk band of a cluster, from three deterministic signals:
 *
 *   - **breadth** — how many cases it claimed (2+ = +1, 5+ = +2). One test
 *     failing is an incident; ten tests failing the same way is an outage.
 *   - **browser spread** — a break reproduced on 2+ browsers is far more
 *     likely to be genuine than a single-engine rendering quirk (+1).
 *   - **layer signal** — any high-signal layer present (+1); a visual-only
 *     cluster earns nothing here.
 *
 * The kind then nudges: a regression is worth one more point, flake/noise one
 * less (they are, by definition, not the thing that breaks users).
 *
 * 3+ → high, 1-2 → medium, otherwise low.
 */
export function groupRisk(group: AssessGroup): TriageRisk {
  const caseCount = group.cases.length;
  const browsers = groupBrowsers(group);
  const layers = groupLayers(group);

  let score = 0;
  if (caseCount >= 5) score += 2;
  else if (caseCount >= 2) score += 1;

  if (browsers.length >= 2) score += 1;
  if (layers.some((l) => HIGH_SIGNAL_LAYERS.includes(l))) score += 1;

  if (group.kind === "regression") score += 1;
  else if (group.kind === "flake" || group.kind === "noise") score -= 1;

  if (score >= 3) return "high";
  if (score >= 1) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// suggestVerdict
// ---------------------------------------------------------------------------

/**
 * Below this confidence the model declines to recommend anything rather than
 * putting a shrug in front of the reviewer as if it were advice.
 */
export const MIN_SUGGEST_CONFIDENCE = 40;

/**
 * The reviewer action a classification recommends.
 *
 *   regression  → `bug`            (file it)
 *   flake       → `flaky_retry`    (prove it before believing it)
 *   noise       → `false_positive` (the diff means nothing)
 *   maintenance → `new_baseline` when the only signal is visual (the UI
 *                 intentionally changed and the screenshot is simply stale),
 *                 otherwise `bug` — a maintenance cluster carrying console /
 *                 network / url / a11y evidence is not a stale screenshot.
 *   environment → `null` — nothing to decide about the product; fix the env.
 *   unknown     → `null`.
 *
 * `null` is also returned whenever confidence is below
 * `MIN_SUGGEST_CONFIDENCE`.
 */
export function suggestVerdict(group: AssessGroup): TriageVerdict | null {
  if (group.confidence < MIN_SUGGEST_CONFIDENCE) return null;

  switch (group.kind) {
    case "regression":
      return "bug";
    case "flake":
      return "flaky_retry";
    case "noise":
      return "false_positive";
    case "maintenance": {
      const layers = groupLayers(group);
      const visualOnly =
        layers.length === 0 ||
        layers.every((l) => !HIGH_SIGNAL_LAYERS.includes(l));
      return visualOnly ? "new_baseline" : "bug";
    }
    case "environment":
    case "unknown":
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// rankGroups
// ---------------------------------------------------------------------------

/**
 * Kind ordering. Genuine regressions first, then the things that might be a
 * regression, then the things that explicitly are not — noise last.
 */
const KIND_RANK: Record<TriageGroupKind, number> = {
  regression: 0,
  maintenance: 1,
  environment: 2,
  unknown: 3,
  flake: 4,
  noise: 5,
};

const RISK_RANK: Record<TriageRisk, number> = { high: 0, medium: 1, low: 2 };

export interface RankableGroup extends AssessGroup {
  /** Precomputed risk. Derived with `groupRisk` when omitted. */
  risk?: TriageRisk;
}

/**
 * Order clusters for the Run Results screen.
 *
 * Comparison keys, in order — every one of them is a stable property of the
 * group, so the ordering is reproducible across runs and across processes:
 *
 *   1. kind        (regression → … → noise, see `KIND_RANK`)
 *   2. risk        (high → medium → low)
 *   3. case count  (descending — the bigger blast radius first)
 *   4. confidence  (descending)
 *   5. key         (ascending, lexicographic — the final tiebreak, so two
 *                   otherwise-identical clusters never swap places between
 *                   two renders of the same data)
 *
 * Returns a new array; the input is not mutated.
 */
export function rankGroups<T extends RankableGroup>(groups: readonly T[]): T[] {
  return [...groups].sort((a, b) => {
    const kind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (kind !== 0) return kind;

    const risk =
      RISK_RANK[a.risk ?? groupRisk(a)] - RISK_RANK[b.risk ?? groupRisk(b)];
    if (risk !== 0) return risk;

    const size = b.cases.length - a.cases.length;
    if (size !== 0) return size;

    const confidence = b.confidence - a.confidence;
    if (confidence !== 0) return confidence;

    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// deriveRunCounts
// ---------------------------------------------------------------------------

/** Minimal shape of a persisted reviewer verdict. */
export interface VerdictLike {
  verdict: TriageVerdict;
}

export interface TriageRunCounts {
  /** Every case in the run. */
  total: number;
  /** Cases that failed outright. */
  failed: number;
  /** Cases that only need review (a diff changed, nothing threw). */
  review: number;
  /**
   * Cases a human settled as *not* a defect — `false_positive` or
   * `new_baseline`. The run's "passed after review" number.
   */
  passed: number;
  /** Cases carrying any reviewer verdict at all. */
  resolved: number;
  /** `total - resolved`. */
  undecided: number;
  /** Verdict histogram — every verdict key present, zero-filled. */
  byVerdict: Record<TriageVerdict, number>;
}

const ZERO_VERDICTS = (): Record<TriageVerdict, number> => ({
  bug: 0,
  improvement: 0,
  false_positive: 0,
  flaky_retry: 0,
  new_baseline: 0,
  snoozed: 0,
});

/** Verdicts that mean "this case turned out not to be a defect". */
const CLEARING_VERDICTS: ReadonlySet<TriageVerdict> = new Set<TriageVerdict>([
  "false_positive",
  "new_baseline",
]);

/**
 * Run-level tallies.
 *
 * `verdicts` is keyed by `triageCaseKey(testId, stepLabel)` — the same map
 * `getTriageVerdicts()` returns, so the caller can pass it straight through.
 */
export function deriveRunCounts(
  cases: readonly AssessCase[],
  verdicts: Readonly<Record<string, VerdictLike>> = {},
): TriageRunCounts {
  const byVerdict = ZERO_VERDICTS();
  let failed = 0;
  let review = 0;
  let passed = 0;
  let resolved = 0;

  for (const c of cases) {
    if (c.status === "failed") failed++;
    else review++;

    const decision = verdicts[triageCaseKey(c.testId, c.stepLabel)];
    if (!decision) continue;
    resolved++;
    byVerdict[decision.verdict] = (byVerdict[decision.verdict] ?? 0) + 1;
    if (CLEARING_VERDICTS.has(decision.verdict)) passed++;
  }

  return {
    total: cases.length,
    failed,
    review,
    passed,
    resolved,
    undecided: cases.length - resolved,
    byVerdict,
  };
}

// ---------------------------------------------------------------------------
// describeAge
// ---------------------------------------------------------------------------

/**
 * Human-readable age of a case.
 *
 * `buildOrder` is the repo's recent build ids **oldest first**, with the build
 * being triaged as the last element — the caller owns that ordering because
 * only it can query builds.
 *
 *   - first seen in the current build (or unknown-and-not-in-history)
 *     → "new this run"
 *   - first seen at position i → "present since run i+1"
 *   - first seen in a build older than the window → "present since an earlier run"
 */
export function describeAge(
  firstSeenBuildId: string | null | undefined,
  buildOrder: readonly string[],
): string {
  if (!firstSeenBuildId) return "new this run";

  const current = buildOrder[buildOrder.length - 1];
  if (firstSeenBuildId === current) return "new this run";

  const index = buildOrder.indexOf(firstSeenBuildId);
  if (index === -1) return "present since an earlier run";
  return `present since run ${index + 1}`;
}
