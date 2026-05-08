import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the queries barrel before importing the evaluator — `evaluateStepCriteria`
// reads test results, persisted criteria, the test (for variable synthesis), and
// visual diffs from the DB, then writes an evaluation outcome back. Tests below
// stub each query with the precise shape evaluation.ts expects.
vi.mock('@/lib/db/queries', () => ({
  getTestResultById: vi.fn(),
  getStepCriteria: vi.fn(),
  getTest: vi.fn(),
  getVisualDiffsByTestResult: vi.fn(),
  updateTestResult: vi.fn(),
}));

import * as queries from '@/lib/db/queries';
import {
  evaluateRules,
  evaluateRulesForStep,
  evaluateStepCriteria,
  type StepObservations,
} from './evaluation';
import type {
  StepCriterion,
  TestResult,
  Test,
  TestVariable,
  VisualDiff,
} from '@/lib/db/schema';

function makeDiff(overrides: Partial<VisualDiff> = {}): VisualDiff {
  return {
    id: 'diff-1',
    buildId: 'b1',
    testResultId: 'tr1',
    testId: 't1',
    stepLabel: 'screenshot-1',
    baselineImagePath: null,
    currentImagePath: null,
    diffImagePath: null,
    status: 'pending',
    pixelDifference: 0,
    percentageDifference: '0',
    classification: 'changed',
    metadata: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: null,
    plannedImagePath: null,
    plannedDiffImagePath: null,
    plannedPixelDifference: null,
    plannedPercentageDifference: null,
    mainBaselineImagePath: null,
    mainDiffImagePath: null,
    mainPixelDifference: null,
    mainPercentageDifference: null,
    mainClassification: null,
    aiAnalysis: null,
    aiRecommendation: null,
    aiAnalysisStatus: null,
    browser: 'chromium',
    issueUrl: null,
    issueProvider: null,
    baselineTextPath: null,
    currentTextPath: null,
    textDiffStatus: null,
    ...overrides,
  };
}

const emptyObservations: StepObservations = {
  visualDiffs: [],
  consoleErrors: [],
  assertionResults: [],
};

describe('evaluateRulesForStep — screenshot_changed', () => {
  it('does not trip when there are no diffs', () => {
    const criterion: StepCriterion = {
      stepLabel: 'screenshot-1',
      rules: [{ kind: 'screenshot_changed', severity: 'fail' }],
    };
    expect(evaluateRulesForStep(criterion, emptyObservations)).toEqual([]);
  });

  it('trips when a changed diff is pending', () => {
    const criterion: StepCriterion = {
      stepLabel: 'screenshot-1',
      rules: [{ kind: 'screenshot_changed', severity: 'fail' }],
    };
    const triggered = evaluateRulesForStep(criterion, {
      ...emptyObservations,
      visualDiffs: [makeDiff({ classification: 'changed', status: 'pending' })],
    });
    expect(triggered).toHaveLength(1);
    expect(triggered[0].rule.kind).toBe('screenshot_changed');
    expect(triggered[0].stepLabel).toBe('screenshot-1');
  });

  it('does not trip when the changed diff is approved', () => {
    const criterion: StepCriterion = {
      stepLabel: 'screenshot-1',
      rules: [{ kind: 'screenshot_changed', severity: 'fail' }],
    };
    const triggered = evaluateRulesForStep(criterion, {
      ...emptyObservations,
      visualDiffs: [makeDiff({ classification: 'changed', status: 'approved' })],
    });
    expect(triggered).toEqual([]);
  });

  it('does not trip when the diff is unchanged', () => {
    const criterion: StepCriterion = {
      stepLabel: 'screenshot-1',
      rules: [{ kind: 'screenshot_changed', severity: 'fail' }],
    };
    const triggered = evaluateRulesForStep(criterion, {
      ...emptyObservations,
      visualDiffs: [makeDiff({ classification: 'unchanged', status: 'pending' })],
    });
    expect(triggered).toEqual([]);
  });
});

describe('evaluateRules', () => {
  it('returns no override when criteria list is empty', () => {
    const result = evaluateRules([], new Map());
    expect(result.triggeredRules).toEqual([]);
    expect(result.overriddenStatus).toBeUndefined();
  });

  it('returns no override when criterion targets a non-existent step (no observations)', () => {
    const criteria: StepCriterion[] = [
      {
        stepLabel: 'never-captured',
        rules: [{ kind: 'screenshot_changed', severity: 'fail' }],
      },
    ];
    // observationsByStep map empty for that label → handler defaults to empty obs
    const result = evaluateRules(criteria, new Map());
    expect(result.triggeredRules).toEqual([]);
    expect(result.overriddenStatus).toBeUndefined();
  });

  it('promotes status to failed when any fail-severity rule fires', () => {
    const criteria: StepCriterion[] = [
      {
        stepLabel: 'screenshot-1',
        rules: [{ kind: 'screenshot_changed', severity: 'fail' }],
      },
    ];
    const obs = new Map<string, StepObservations>([
      [
        'screenshot-1',
        {
          ...emptyObservations,
          visualDiffs: [makeDiff({ classification: 'changed', status: 'pending' })],
        },
      ],
    ]);
    const result = evaluateRules(criteria, obs);
    expect(result.overriddenStatus).toBe('failed');
    expect(result.triggeredRules).toHaveLength(1);
  });

  it('does not promote when only warn-severity rules fire', () => {
    const criteria: StepCriterion[] = [
      {
        stepLabel: 'screenshot-1',
        rules: [{ kind: 'screenshot_changed', severity: 'warn' }],
      },
    ];
    const obs = new Map<string, StepObservations>([
      [
        'screenshot-1',
        {
          ...emptyObservations,
          visualDiffs: [makeDiff({ classification: 'changed', status: 'pending' })],
        },
      ],
    ]);
    const result = evaluateRules(criteria, obs);
    expect(result.overriddenStatus).toBeUndefined();
    expect(result.triggeredRules).toHaveLength(1);
  });
});

describe('evaluateRulesForStep — other rule kinds', () => {
  it('console_error trips when there is at least one console error', () => {
    const criterion: StepCriterion = {
      stepLabel: 'screenshot-1',
      rules: [{ kind: 'console_error', severity: 'fail' }],
    };
    expect(
      evaluateRulesForStep(criterion, { ...emptyObservations, consoleErrors: ['boom'] }),
    ).toHaveLength(1);
    expect(evaluateRulesForStep(criterion, emptyObservations)).toEqual([]);
  });

  it('assertion_failed trips when an assertion result is failed', () => {
    const criterion: StepCriterion = {
      stepLabel: 'screenshot-1',
      rules: [{ kind: 'assertion_failed', severity: 'fail' }],
    };
    const triggered = evaluateRulesForStep(criterion, {
      ...emptyObservations,
      assertionResults: [{ assertionId: 'a1', status: 'failed', errorMessage: 'nope' }],
    });
    expect(triggered).toHaveLength(1);
  });

  it('scoped assertion_failed only trips for the targeted assertionId', () => {
    // Regression for the post-migration id format: rules pin to a specific
    // assertion (`params.assertionId`) and only that assertion's failure
    // should trip the rule. New ids are content+occurrence-hashed (12 hex
    // chars), but the evaluator just does string equality — covered here
    // so any future id-format change still passes through cleanly.
    const criterion: StepCriterion = {
      stepLabel: '__assertions__',
      rules: [
        { kind: 'assertion_failed', severity: 'fail', params: { assertionId: 'pinned-id-abc' } },
      ],
    };
    // Failure of an UNRELATED assertion should NOT trip the scoped rule
    expect(evaluateRulesForStep(criterion, {
      ...emptyObservations,
      assertionResults: [{ assertionId: 'someone-else', status: 'failed', errorMessage: 'x' }],
    })).toEqual([]);
    // Failure of the PINNED assertion DOES trip
    const triggered = evaluateRulesForStep(criterion, {
      ...emptyObservations,
      assertionResults: [
        { assertionId: 'someone-else', status: 'passed' },
        { assertionId: 'pinned-id-abc', status: 'failed', errorMessage: 'pinned fail' },
      ],
    });
    expect(triggered).toHaveLength(1);
    expect(triggered[0].reason).toContain('pinned-id-abc');
  });

  it('focus_region_changed is a no-op until the focus-region feature lands', () => {
    const criterion: StepCriterion = {
      stepLabel: 'screenshot-1',
      rules: [{ kind: 'focus_region_changed', severity: 'fail' }],
    };
    expect(
      evaluateRulesForStep(criterion, {
        ...emptyObservations,
        visualDiffs: [makeDiff({ classification: 'changed', status: 'pending' })],
      }),
    ).toEqual([]);
  });
});

describe('evaluateRulesForStep — all_steps_executed', () => {
  const criterion: StepCriterion = {
    stepLabel: '@all-steps-executed',
    rules: [{ kind: 'all_steps_executed', severity: 'fail' }],
  };

  it('trips when the runner stopped before the last step', () => {
    const triggered = evaluateRulesForStep(criterion, {
      ...emptyObservations,
      lastReachedStep: 6,
      totalSteps: 9,
    });
    expect(triggered).toHaveLength(1);
    expect(triggered[0].reason).toMatch(/step 7 of 9/);
  });

  it('does not trip when every step was reached', () => {
    expect(
      evaluateRulesForStep(criterion, {
        ...emptyObservations,
        lastReachedStep: 8,
        totalSteps: 9,
      }),
    ).toEqual([]);
  });

  it('does not trip when step counts are missing (no signal from older runners)', () => {
    expect(evaluateRulesForStep(criterion, emptyObservations)).toEqual([]);
  });

  it('does not trip when totalSteps is zero', () => {
    expect(
      evaluateRulesForStep(criterion, {
        ...emptyObservations,
        lastReachedStep: 0,
        totalSteps: 0,
      }),
    ).toEqual([]);
  });
});

// DB-backed entry point. Single-test runs (`runTestsAsync` in
// src/server/actions/runs.ts) and build runs (`executeBuildJob` in
// src/server/actions/builds.ts) both invoke this for every persisted result.
// Until 2026-04-28 only the build path called it, so single-test runs silently
// ignored every persisted criterion + every assertEnabled extract var. These
// tests pin the contract for both call sites.
describe('evaluateStepCriteria — DB-backed flow', () => {
  function makeResult(overrides: Partial<TestResult> = {}): TestResult {
    return {
      id: 'tr1',
      testRunId: 'run1',
      testId: 'test1',
      status: 'passed',
      errorMessage: null,
      consoleErrors: null,
      assertionResults: null,
      extractedVariables: null,
      lastReachedStep: null,
      totalSteps: null,
      // Drizzle inferred type has many columns we don't care about — cast
      // through unknown so the partial mock is acceptable.
      ...overrides,
    } as unknown as TestResult;
  }

  function makeTest(variables: TestVariable[] | null): Test {
    return {
      id: 'test1',
      variables,
    } as unknown as Test;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no persisted criteria, no variables, no diffs. Each test
    // overrides only what it needs.
    vi.mocked(queries.getStepCriteria).mockResolvedValue([]);
    vi.mocked(queries.getTest).mockResolvedValue(makeTest(null));
    vi.mocked(queries.getVisualDiffsByTestResult).mockResolvedValue([]);
    vi.mocked(queries.updateTestResult).mockResolvedValue(undefined as never);
  });

  it('flips passed → failed when an assertEnabled extract var mismatches', async () => {
    // Mirrors the user-reported flow: extract var bound to a page field, with
    // assertEnabled + expectedValue, but the page returned a different value.
    vi.mocked(queries.getTestResultById).mockResolvedValue(
      makeResult({
        status: 'passed',
        extractedVariables: { data: 'on' }, // page held "on"
      }),
    );
    vi.mocked(queries.getTest).mockResolvedValue(
      makeTest([
        {
          id: 'v1',
          name: 'data',
          mode: 'extract',
          targetSelector: '[data-testid="toolbar-diamond"]',
          attribute: 'value',
          assertEnabled: true,
          assertSeverity: 'fail',
          expectedValue: 'off',
        },
      ]),
    );

    const result = await evaluateStepCriteria('tr1');

    expect(result.overriddenStatus).toBe('failed');
    expect(result.triggeredRules).toHaveLength(1);
    expect(result.triggeredRules[0].rule.kind).toBe('variable_equals');

    expect(queries.updateTestResult).toHaveBeenCalledWith(
      'tr1',
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('"data"'),
        evaluationOutcome: expect.objectContaining({
          overriddenStatus: 'failed',
        }),
      }),
    );
  });

  it('does NOT flip status when an assertEnabled extract var matches expected', async () => {
    vi.mocked(queries.getTestResultById).mockResolvedValue(
      makeResult({
        status: 'passed',
        extractedVariables: { data: 'off' },
      }),
    );
    vi.mocked(queries.getTest).mockResolvedValue(
      makeTest([
        {
          id: 'v1',
          name: 'data',
          mode: 'extract',
          assertEnabled: true,
          assertSeverity: 'fail',
          expectedValue: 'off',
        },
      ]),
    );

    const result = await evaluateStepCriteria('tr1');

    expect(result.overriddenStatus).toBeUndefined();
    expect(result.triggeredRules).toEqual([]);
    // Outcome is still persisted (with no fail), but status patch is absent.
    const patch = vi.mocked(queries.updateTestResult).mock.calls[0]?.[1];
    expect(patch?.status).toBeUndefined();
  });

  it('flips passed → failed via persisted screenshot_changed criterion', async () => {
    vi.mocked(queries.getTestResultById).mockResolvedValue(
      makeResult({ status: 'passed' }),
    );
    vi.mocked(queries.getStepCriteria).mockResolvedValue([
      {
        stepLabel: 'screenshot-1',
        rules: [{ kind: 'screenshot_changed', severity: 'fail' }],
      },
    ]);
    vi.mocked(queries.getVisualDiffsByTestResult).mockResolvedValue([
      makeDiff({ stepLabel: 'screenshot-1', classification: 'changed', status: 'pending' }),
    ]);

    const result = await evaluateStepCriteria('tr1');
    expect(result.overriddenStatus).toBe('failed');
    expect(result.triggeredRules[0].rule.kind).toBe('screenshot_changed');
    expect(queries.updateTestResult).toHaveBeenCalledWith(
      'tr1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('flips passed → failed via persisted console_error criterion', async () => {
    vi.mocked(queries.getTestResultById).mockResolvedValue(
      makeResult({ status: 'passed', consoleErrors: ['boom'] }),
    );
    vi.mocked(queries.getStepCriteria).mockResolvedValue([
      {
        stepLabel: '__console__',
        rules: [{ kind: 'console_error', severity: 'fail' }],
      },
    ]);

    const result = await evaluateStepCriteria('tr1');
    expect(result.overriddenStatus).toBe('failed');
    expect(result.triggeredRules[0].rule.kind).toBe('console_error');
  });

  it('flips passed → failed via persisted assertion_failed criterion', async () => {
    vi.mocked(queries.getTestResultById).mockResolvedValue(
      makeResult({
        status: 'passed',
        assertionResults: [{ assertionId: 'a1', status: 'failed', errorMessage: 'mismatch' }],
      }),
    );
    vi.mocked(queries.getStepCriteria).mockResolvedValue([
      {
        stepLabel: '__assertions__',
        rules: [{ kind: 'assertion_failed', severity: 'fail' }],
      },
    ]);

    const result = await evaluateStepCriteria('tr1');
    expect(result.overriddenStatus).toBe('failed');
    expect(result.triggeredRules[0].rule.kind).toBe('assertion_failed');
  });

  it('synthesizes a default-on all_steps_executed rule that trips on partial runs', async () => {
    vi.mocked(queries.getTestResultById).mockResolvedValue(
      makeResult({
        status: 'passed',
        lastReachedStep: 5,
        totalSteps: 9,
      }),
    );
    // No persisted criteria — the default-ON synthesis path must still fire.
    const result = await evaluateStepCriteria('tr1');
    expect(result.overriddenStatus).toBe('failed');
    expect(result.triggeredRules.map(t => t.rule.kind)).toContain('all_steps_executed');
  });

  it('does not flip status when only a warn-severity rule fires', async () => {
    vi.mocked(queries.getTestResultById).mockResolvedValue(
      makeResult({
        status: 'passed',
        extractedVariables: { data: 'unexpected' },
      }),
    );
    vi.mocked(queries.getTest).mockResolvedValue(
      makeTest([
        {
          id: 'v1',
          name: 'data',
          mode: 'extract',
          assertEnabled: true,
          assertSeverity: 'warn',
          expectedValue: 'off',
        },
      ]),
    );

    const result = await evaluateStepCriteria('tr1');
    expect(result.overriddenStatus).toBeUndefined();
    expect(result.triggeredRules).toHaveLength(1);
    expect(result.triggeredRules[0].rule.severity).toBe('warn');
  });
});
