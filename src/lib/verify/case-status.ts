/**
 * Derive the 4-state case status the design uses (regression / done / missed
 * / unknown) from the existing verdict + per-layer feedback model.
 *
 * Mapping (heuristic, refined as feedback comes in):
 *   - regression: red verdict and no approving feedback, OR any layer marked rejected
 *   - done:       approved feedback present (any layer), or green verdict in changed area
 *   - missed:     yellow verdict in a changed area (intent area moved less than expected),
 *                 OR red/yellow verdict where feedback.note indicates an open issue
 *   - unknown:    everything else (yellow in unchanged area, no signal at all)
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

  // green
  if (isInChangedArea && anyApproved) return 'done';
  if (isInChangedArea) return 'done';
  return 'unknown';
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
