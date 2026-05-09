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
}

export function deriveCaseStatus(input: DeriveInput): CaseStatus {
  const { step, feedback, isInChangedArea } = input;

  const anyApproved = feedback.some((f) => f.status === 'approved' || f.status === 'auto_approved');
  const anyRejected = feedback.some((f) => f.status === 'rejected');

  if (anyRejected) return 'regression';

  if (step.verdict === 'red') {
    return anyApproved ? 'done' : 'regression';
  }

  if (step.verdict === 'yellow') {
    if (anyApproved) return 'done';
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
