// Per-step pass/fail rule engine.
//
// `evaluateStepCriteria` runs after a test result is persisted and reads the
// already-saved test, visual diffs, console errors, and assertion results to
// decide whether any user-configured rule should promote the result to failed.
//
// Pure helpers (`evaluateRules`) operate on plain data shapes so they're
// trivial to unit-test without a database.

import * as queries from '@/lib/db/queries';
import type {
  AssertionResult,
  EvaluationOutcome,
  StepCriterion,
  StepRule,
  TriggeredStepRule,
  VisualDiff,
} from '@/lib/db/schema';

export interface StepObservations {
  visualDiffs: VisualDiff[];
  consoleErrors: string[];
  assertionResults: AssertionResult[];
}

export interface EvaluationResult {
  overriddenStatus?: 'failed';
  triggeredRules: TriggeredStepRule[];
}

// Pure: evaluate rules for one step against its observations. Exported for
// unit testing — production callers should use `evaluateStepCriteria`.
export function evaluateRulesForStep(
  criterion: StepCriterion,
  observations: StepObservations,
): TriggeredStepRule[] {
  const triggered: TriggeredStepRule[] = [];

  for (const rule of criterion.rules) {
    const reason = ruleTrips(rule, observations);
    if (reason) {
      triggered.push({ stepLabel: criterion.stepLabel, rule, reason });
    }
  }
  return triggered;
}

// Pure: evaluate every criterion against a per-step observation map. The map
// keys are step labels; criteria with no matching observations get an empty
// observation set (rule kinds vary in how they treat that — most no-op).
export function evaluateRules(
  criteria: StepCriterion[],
  observationsByStep: Map<string, StepObservations>,
): EvaluationResult {
  const triggeredRules: TriggeredStepRule[] = [];
  for (const criterion of criteria) {
    const obs = observationsByStep.get(criterion.stepLabel) ?? {
      visualDiffs: [],
      consoleErrors: [],
      assertionResults: [],
    };
    triggeredRules.push(...evaluateRulesForStep(criterion, obs));
  }

  const overridden = triggeredRules.some(t => t.rule.severity === 'fail');
  return { triggeredRules, overriddenStatus: overridden ? 'failed' : undefined };
}

function ruleTrips(rule: StepRule, observations: StepObservations): string | null {
  switch (rule.kind) {
    case 'screenshot_changed': {
      const trippingDiff = observations.visualDiffs.find(
        d => d.classification === 'changed' && d.status !== 'approved' && d.status !== 'auto_approved',
      );
      return trippingDiff
        ? `Screenshot changed (diff ${trippingDiff.id}, status=${trippingDiff.status})`
        : null;
    }
    case 'focus_region_changed': {
      // Hooks Feature 2 (focus regions). Until that ships there's no
      // focus-region diff signal to read; treat as a no-op so toggling the
      // rule doesn't crash builds.
      return null;
    }
    case 'console_error': {
      return observations.consoleErrors.length > 0
        ? `Console error captured (${observations.consoleErrors.length})`
        : null;
    }
    case 'assertion_failed': {
      const failed = observations.assertionResults.find(a => a.status === 'failed');
      return failed
        ? `Assertion ${failed.assertionId} failed: ${failed.errorMessage ?? 'no message'}`
        : null;
    }
    default:
      return null;
  }
}

// Bucket diffs by their stepLabel. Diffs with no stepLabel get bucketed under
// the empty string so a criterion with stepLabel: '' can still match them.
function groupDiffsByStep(diffs: VisualDiff[]): Map<string, VisualDiff[]> {
  const map = new Map<string, VisualDiff[]>();
  for (const d of diffs) {
    const key = d.stepLabel ?? '';
    const arr = map.get(key) ?? [];
    arr.push(d);
    map.set(key, arr);
  }
  return map;
}

// Loads persisted state for a single test result, runs evaluation, and (when
// any rule with severity:'fail' fires) flips the test result's status to
// 'failed' and persists the EvaluationOutcome. Returns the result so the
// caller can re-tally build counts.
export async function evaluateStepCriteria(testResultId: string): Promise<EvaluationResult> {
  const testResult = await queries.getTestResultById(testResultId);
  if (!testResult || !testResult.testId) {
    return { triggeredRules: [] };
  }

  const criteria = await queries.getStepCriteria(testResult.testId);
  if (criteria.length === 0) {
    return { triggeredRules: [] };
  }

  const diffs = await queries.getVisualDiffsByTestResult(testResultId);
  const diffsByStep = groupDiffsByStep(diffs);
  const consoleErrors = testResult.consoleErrors ?? [];
  const assertionResults = testResult.assertionResults ?? [];

  const observationsByStep = new Map<string, StepObservations>();
  for (const criterion of criteria) {
    observationsByStep.set(criterion.stepLabel, {
      visualDiffs: diffsByStep.get(criterion.stepLabel) ?? [],
      // Console errors and assertion results aren't step-scoped today; expose
      // the test-level lists to every criterion until that wiring exists.
      consoleErrors,
      assertionResults,
    });
  }

  const evaluation = evaluateRules(criteria, observationsByStep);

  const outcome: EvaluationOutcome = {
    triggeredRules: evaluation.triggeredRules,
    evaluatedAt: new Date().toISOString(),
    overriddenStatus: evaluation.overriddenStatus,
  };

  const patch: Parameters<typeof queries.updateTestResult>[1] = {
    evaluationOutcome: outcome,
  };
  if (evaluation.overriddenStatus === 'failed' && testResult.status !== 'failed') {
    patch.status = 'failed';
  }
  await queries.updateTestResult(testResultId, patch);

  return evaluation;
}
