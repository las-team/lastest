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
} from '@/lib/db/schema';

export type CaseStatus = 'regression' | 'done' | 'missed' | 'unknown';

interface DeriveInput {
  step: StepComparison;
  feedback: StepLayerFeedback[];
  /** True when the step's test belongs to a code-changed or manually-scoped area. */
  isInChangedArea: boolean;
  /** True when the underlying test_result.status is 'failed' (runner threw —
   *  timeout, assertion error, navigation failure, etc.). The diff scorer
   *  doesn't know about this, so a failed test with no captured layer
   *  evidence would otherwise score as green = done. */
  testFailed?: boolean;
}

export function deriveCaseStatus(input: DeriveInput): CaseStatus {
  const { step, feedback, isInChangedArea, testFailed } = input;

  const anyRejected = feedback.some((f) => f.status === 'rejected');
  if (anyRejected) return 'regression';

  // "Fully approved" — every evidence layer has an approval. Step.evidence
  // can carry multiple rows per layer, so we collapse to unique layers and
  // require each one to be in the approved set. If a case has no evidence
  // (e.g. hard runner failure), any single approval counts as full approval.
  const evidenceLayers = Array.from(new Set(step.evidence.map((e) => e.layer)));
  const approvedLayers = new Set(
    feedback
      .filter((f) => f.status === 'approved' || f.status === 'auto_approved')
      .map((f) => f.layer),
  );
  const fullyApproved = evidenceLayers.length > 0
    ? evidenceLayers.every((l) => approvedLayers.has(l))
    : approvedLayers.size > 0;

  // Hard test failures dominate any layer-evidence verdict — they only count
  // as resolved if every evidence layer is explicitly approved.
  if (testFailed) {
    return fullyApproved ? 'done' : 'regression';
  }

  if (step.verdict === 'red') {
    return fullyApproved ? 'done' : 'regression';
  }

  if (step.verdict === 'yellow') {
    if (fullyApproved) return 'done';
    return isInChangedArea ? 'missed' : 'unknown';
  }

  // green verdict — 0 diff. Treat as done (the test passed cleanly).
  return 'done';
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
