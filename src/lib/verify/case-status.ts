/**
 * Derive the 4-state case status the design uses (regression / done / missed
 * / unknown) from the existing verdict + per-layer feedback model.
 *
 * Mapping:
 *   - regression: any rejected feedback, OR red verdict without an approval
 *   - done:       green verdict (no diff = passed = done), OR any approval, OR
 *                 auto-approved at build completion for 0-diff cases
 *   - missed:     yellow verdict in a changed area without an approval
 *                 (intent area moved less than expected)
 *   - unknown:    yellow verdict outside a changed area, no decision yet
 */

import type {
  StepComparison,
  StepLayerFeedback,
  StepVerdict,
} from "@/lib/db/schema";

export type CaseStatus = "regression" | "done" | "missed" | "unknown";

interface DeriveInput {
  step: StepComparison;
  feedback: StepLayerFeedback[];
  /** True when the step's test belongs to a code-changed or manually-scoped area. */
  isInChangedArea: boolean;
  /** True when the underlying test_result.status indicates a runner-side
   *  failure ('failed' or 'setup_failed' — timeout, assertion error, nav
   *  failure, setup script crash, etc.). The diff scorer doesn't know about
   *  this, so a failed test with no captured layer evidence would otherwise
   *  score as green = done. Hard failures dominate any verdict and force the
   *  case into Broken until every evidence layer is explicitly approved. */
  testFailed?: boolean;
  /** Mode-aware verdict re-derived from step.evidence + the active per-layer
   *  modes (see effectiveVerdict). When provided it supersedes the stored
   *  step.verdict — the persisted verdict is mode-blind, so the board columns
   *  must use the mode-aware value or a `log`-mode high-signal layer lands the
   *  card in Broken with no red chip. Omitted callers fall back to step.verdict. */
  verdictOverride?: StepVerdict;
  /** True when a screenshot was captured but there's no approved visual
   *  baseline yet (first run / never approved). A step in this state has
   *  never been verified against a reference, so it must not auto-settle
   *  into Verified (green) or Missed (yellow) — it defaults to Unsorted
   *  until the reviewer approves, which writes the baseline. Callers compute
   *  this with `isVisualBaselineMissing`, which honors the visual check mode
   *  (a `disable`d visual layer never sets it). */
  visualBaselineMissing?: boolean;
}

export function deriveCaseStatus(input: DeriveInput): CaseStatus {
  const { step, feedback, isInChangedArea, testFailed } = input;
  const verdict = input.verdictOverride ?? step.verdict;
  const visualBaselineMissing = input.visualBaselineMissing ?? false;

  const anyRejected = feedback.some((f) => f.status === "rejected");
  if (anyRejected) return "regression";

  // "Fully approved" — every evidence layer has an approval. Step.evidence
  // can carry multiple rows per layer, so we collapse to unique layers and
  // require each one to be in the approved set. If a case has no evidence
  // (e.g. hard runner failure), any single approval counts as full approval.
  const evidenceLayers = Array.from(new Set(step.evidence.map((e) => e.layer)));
  const approvedLayers = new Set(
    feedback
      .filter((f) => f.status === "approved" || f.status === "auto_approved")
      .map((f) => f.layer),
  );
  const fullyApproved =
    evidenceLayers.length > 0
      ? evidenceLayers.every((l) => approvedLayers.has(l))
      : approvedLayers.size > 0;

  // Reviewer-flagged "missed" — produced by dragging a card onto the Missed
  // column. We model that as a fully-snoozed step with no approvals (and no
  // rejection, which we already short-circuited above). Distinct from
  // "no feedback at all", which falls through to the verdict-based logic.
  const snoozedLayers = new Set(
    feedback.filter((f) => f.status === "snoozed").map((f) => f.layer),
  );
  const fullySnoozed =
    evidenceLayers.length > 0
      ? evidenceLayers.every((l) => snoozedLayers.has(l)) &&
        approvedLayers.size === 0
      : snoozedLayers.size > 0 && approvedLayers.size === 0;
  if (fullySnoozed) return "missed";

  // Hard test failures dominate any layer-evidence verdict — they only count
  // as resolved if every evidence layer is explicitly approved by a reviewer.
  // System auto-approval (the zero-diff shortcut at build completion) doesn't
  // count here: a failed test with verdict='green' + empty evidence shares
  // the shape of a clean pass, and we never want a hard runner failure to
  // slip into Verified without a human signing off.
  if (testFailed) {
    const explicitApprovedLayers = new Set(
      feedback.filter((f) => f.status === "approved").map((f) => f.layer),
    );
    const explicitFullyApproved =
      evidenceLayers.length > 0
        ? evidenceLayers.every((l) => explicitApprovedLayers.has(l))
        : explicitApprovedLayers.size > 0;
    return explicitFullyApproved ? "done" : "regression";
  }

  // A captured-but-never-approved visual layer (no baseline to diff against)
  // has not actually been verified. Such a step must not auto-classify as
  // Verified (green) or Missed (yellow) — it defaults to Unsorted until the
  // reviewer approves, which writes the baseline. Explicit approvals
  // (fullyApproved), rejections + hard failures (handled above) and red
  // regressions (below) still surface so real problems aren't hidden behind
  // "needs a baseline".
  if (visualBaselineMissing && !fullyApproved && verdict !== "red") {
    return "unknown";
  }

  if (verdict === "red") {
    return fullyApproved ? "done" : "regression";
  }

  if (verdict === "yellow") {
    if (fullyApproved) return "done";
    return isInChangedArea ? "missed" : "unknown";
  }

  // green verdict — 0 diff. Treat as done (the test passed cleanly).
  return "done";
}

export interface CaseStatusCounts {
  regression: number;
  done: number;
  missed: number;
  unknown: number;
}

export function emptyCounts(): CaseStatusCounts {
  return { regression: 0, done: 0, missed: 0, unknown: 0 };
}

/**
 * Whether a step's visual layer was captured but has no approved baseline to
 * diff against yet (first run / never approved). Used by every board/focus
 * derivation site to feed `deriveCaseStatus({ visualBaselineMissing })` so a
 * baseline-less step defaults to Unsorted instead of auto-verifying.
 *
 * Honors the visual check mode: a `disable`d visual layer is opted out, so a
 * missing baseline there is irrelevant and never forces Unsorted.
 */
export function isVisualBaselineMissing(
  visual:
    | { currentImagePath: string | null; baselineImagePath: string | null }
    | null
    | undefined,
  visualMode: "enforce" | "log" | "disable",
): boolean {
  return (
    visualMode !== "disable" &&
    !!visual?.currentImagePath &&
    !visual?.baselineImagePath
  );
}
