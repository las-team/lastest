'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Circle, ShieldAlert, ListOrdered } from 'lucide-react';
import type { TestAssertion, AssertionResult } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { extractTestBody, parseSteps, type DebugStep } from '@/lib/playwright/debug-parser';

interface TestStepsTabProps {
  assertions: TestAssertion[] | null;
  assertionResults: AssertionResult[] | null;
  softErrors: string[] | null;
  code: string;
  onParseNeeded?: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  element: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  page: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  generic: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  visual: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
};

const TYPE_COLORS: Record<string, string> = {
  action: 'text-blue-700 border-blue-200 dark:text-blue-300 dark:border-blue-800',
  navigation: 'text-purple-700 border-purple-200 dark:text-purple-300 dark:border-purple-800',
  assertion: 'text-amber-700 border-amber-200 dark:text-amber-300 dark:border-amber-800',
  screenshot: 'text-emerald-700 border-emerald-200 dark:text-emerald-300 dark:border-emerald-800',
  wait: 'text-gray-700 border-gray-200 dark:text-gray-300 dark:border-gray-700',
  variable: 'text-cyan-700 border-cyan-200 dark:text-cyan-300 dark:border-cyan-800',
  log: 'text-gray-500 border-gray-200 dark:text-gray-400 dark:border-gray-700',
  other: 'text-gray-500 border-gray-200 dark:text-gray-400 dark:border-gray-700',
};

function StatusIcon({ status }: { status: 'passed' | 'failed' | 'skipped' | 'not_run' }) {
  switch (status) {
    case 'passed':
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case 'skipped':
    case 'not_run':
      return <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />;
  }
}

/** Match an assertion to a step by overlapping code line ranges */
function matchAssertionToStep(assertion: TestAssertion, steps: DebugStep[]): DebugStep | null {
  if (!assertion.codeLineStart) return null;
  for (const step of steps) {
    if (assertion.codeLineStart >= step.lineStart && assertion.codeLineStart <= step.lineEnd) {
      return step;
    }
  }
  return null;
}

const ALL_TYPES = ['action', 'navigation', 'assertion', 'screenshot', 'wait', 'variable', 'log', 'other'] as const;
const DEFAULT_HIDDEN: Set<string> = new Set(['wait', 'other']);

export function TestStepsTab({
  assertions,
  assertionResults,
  softErrors,
  code,
  onParseNeeded,
}: TestStepsTabProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set(DEFAULT_HIDDEN));

  // If assertions is null, trigger parse
  useEffect(() => {
    if (!assertions && code && onParseNeeded) {
      onParseNeeded();
    }
  }, [assertions, code, onParseNeeded]);

  // Parse code into steps
  const steps = useMemo(() => {
    if (!code) return [];
    const body = extractTestBody(code);
    if (!body) return [];
    return parseSteps(body);
  }, [code]);

  const toggleType = (type: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // Build assertion result map
  const resultMap = new Map<string, AssertionResult>();
  if (assertions && assertionResults) {
    for (const r of assertionResults) {
      resultMap.set(r.assertionId, r);
    }
  }

  // Build step → assertion(s) map
  const stepAssertionMap = useMemo(() => {
    const map = new Map<number, TestAssertion[]>();
    if (!assertions || steps.length === 0) return map;
    for (const a of assertions) {
      const step = matchAssertionToStep(a, steps);
      if (step) {
        const existing = map.get(step.id) ?? [];
        existing.push(a);
        map.set(step.id, existing);
      }
    }
    return map;
  }, [assertions, steps]);

  const hasAssertions = assertions && assertions.length > 0;
  const passedCount = hasAssertions ? assertions.filter(a => resultMap.get(a.id)?.status === 'passed').length : 0;
  const failedCount = hasAssertions ? assertions.filter(a => resultMap.get(a.id)?.status === 'failed').length : 0;
  const hasResults = hasAssertions && assertionResults && assertionResults.length > 0;

  // Count steps by type for filter badges
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of steps) {
      counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    }
    return counts;
  }, [steps]);

  // Filter steps
  const filteredSteps = useMemo(() => {
    return steps.filter(s => !hiddenTypes.has(s.type));
  }, [steps, hiddenTypes]);


  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListOrdered className="h-4 w-4" />
            Test Steps
            {steps.length > 0 && (
              <span className="text-muted-foreground font-normal">
                {steps.length} step{steps.length !== 1 ? 's' : ''}
                {hasAssertions && <> &middot; {assertions.length} assertion{assertions.length !== 1 ? 's' : ''}</>}
              </span>
            )}
          </CardTitle>
          {hasResults && (
            <div className="flex items-center gap-3 text-sm">
              {passedCount > 0 && (
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {passedCount} passed
                </span>
              )}
              {failedCount > 0 && (
                <span className="flex items-center gap-1 text-red-600">
                  <XCircle className="h-4 w-4" />
                  {failedCount} failed
                </span>
              )}
              {assertions.length - passedCount - failedCount > 0 && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Circle className="h-4 w-4" />
                  {assertions.length - passedCount - failedCount} not run
                </span>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {steps.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            {!code
              ? 'No test code available.'
              : 'Could not parse steps from test code.'}
          </div>
        ) : (
          <>
            {/* Type filter bar */}
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              {ALL_TYPES.filter(t => typeCounts.has(t)).map(type => {
                const count = typeCounts.get(type) ?? 0;
                const isActive = !hiddenTypes.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors',
                      isActive
                        ? cn('bg-background', TYPE_COLORS[type] ?? TYPE_COLORS.other)
                        : 'bg-muted/40 text-muted-foreground/50 border-transparent',
                    )}
                  >
                    {type}
                    <span className="opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1">
              {filteredSteps.map((step) => {
                const globalIdx = steps.indexOf(step);
                const stepAssertions = stepAssertionMap.get(step.id) ?? [];
                const isAssertionStep = step.type === 'assertion' || stepAssertions.length > 0;
                const isExpanded = expanded.has(step.id);

                // Determine assertion-level status for this step
                const stepStatuses = stepAssertions.map(a => resultMap.get(a.id)?.status);
                const hasFailed = stepStatuses.includes('failed');
                const allPassed = stepStatuses.length > 0 && stepStatuses.every(s => s === 'passed');

                return (
                  <div
                    key={step.id}
                    className={cn(
                      'rounded-md border p-2.5 transition-colors',
                      isAssertionStep && 'cursor-pointer hover:bg-muted/30',
                      isAssertionStep && hasFailed && 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30',
                      isAssertionStep && allPassed && 'border-green-200 bg-green-50/30 dark:border-green-900 dark:bg-green-950/20',
                      isAssertionStep && !hasFailed && !allPassed && 'border-amber-200/60 bg-amber-50/20 dark:border-amber-900/40 dark:bg-amber-950/10',
                      !isAssertionStep && 'border-transparent bg-transparent hover:bg-muted/20',
                    )}
                    onClick={() => isAssertionStep && toggleExpand(step.id)}
                  >
                    <div className="flex items-center gap-2">
                      {/* Step number */}
                      <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
                        {globalIdx + 1}.
                      </span>

                      {/* Status icon for assertion steps */}
                      {isAssertionStep ? (
                        <StatusIcon
                          status={hasFailed ? 'failed' : allPassed ? 'passed' : 'not_run'}
                        />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground/20 shrink-0" />
                      )}

                      {/* Step label */}
                      <span className={cn(
                        'text-sm flex-1 min-w-0 truncate',
                        isAssertionStep && 'font-medium',
                      )}>
                        {step.label}
                      </span>

                      {/* Hard/Soft badges for assertion steps */}
                      {isAssertionStep && stepAssertions.length > 0 && (() => {
                        const hardCount = stepAssertions.filter(a => a.isSoft === false).length;
                        const softCount = stepAssertions.length - hardCount;
                        return (
                          <>
                            {hardCount > 0 && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">
                                <ShieldAlert className="h-3 w-3 mr-0.5" />
                                Hard{hardCount > 1 ? ` ×${hardCount}` : ''}
                              </Badge>
                            )}
                            {softCount > 0 && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 text-muted-foreground">
                                Soft{softCount > 1 ? ` ×${softCount}` : ''}
                              </Badge>
                            )}
                          </>
                        );
                      })()}

                      {/* Type badge */}
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] px-1.5 py-0 h-4 shrink-0',
                          TYPE_COLORS[step.type] ?? TYPE_COLORS.other,
                        )}
                      >
                        {step.type}
                      </Badge>
                    </div>

                    {/* Expanded assertion details */}
                    {isAssertionStep && isExpanded && stepAssertions.length > 0 && (
                      <div className="mt-2 ml-7 space-y-2 border-t pt-2">
                        {stepAssertions.map(assertion => {
                          const result = resultMap.get(assertion.id);
                          const status = result?.status ?? 'not_run';
                          const isHard = assertion.isSoft === false;

                          return (
                            <div key={assertion.id} className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <StatusIcon status={status} />
                                <span className="text-xs font-medium">
                                  {assertion.label ?? `${assertion.assertionType}()`}
                                </span>
                                <Badge variant="outline" className={cn('text-[10px] px-1 py-0 h-4', CATEGORY_COLORS[assertion.category])}>
                                  {assertion.category}
                                </Badge>
                                {assertion.negated && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">.not</Badge>
                                )}
                                {isHard ? (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">
                                    <ShieldAlert className="h-3 w-3 mr-0.5" />
                                    Hard
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-muted-foreground">
                                    Soft
                                  </Badge>
                                )}
                              </div>

                              {/* Expected / Actual values */}
                              {(assertion.expectedValue || result?.actualValue) && (
                                <div className="text-xs space-y-0.5 ml-6">
                                  {assertion.expectedValue && (
                                    <div className="text-muted-foreground">
                                      Expected: <span className="font-mono">{assertion.expectedValue}</span>
                                    </div>
                                  )}
                                  {result?.actualValue && (
                                    <div className={status === 'failed' ? 'text-red-600' : 'text-green-600'}>
                                      Actual: <span className="font-mono">{result.actualValue}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Error message */}
                              {result?.errorMessage && (
                                <div className="text-xs text-red-600 font-mono break-all ml-6">
                                  {result.errorMessage}
                                </div>
                              )}

                              {/* Extra details */}
                              <div className="text-xs text-muted-foreground space-y-0.5 ml-6">
                                {assertion.targetSelector && (
                                  <div>Selector: <span className="font-mono">{assertion.targetSelector}</span></div>
                                )}
                                {result?.durationMs != null && (
                                  <div>Duration: {result.durationMs}ms</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

          </>
        )}
      </CardContent>
    </Card>
  );
}

/** @deprecated Use TestStepsTab instead */
export const SuccessCriteriaTab = TestStepsTab;
