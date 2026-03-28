'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Circle, AlertTriangle } from 'lucide-react';
import type { TestAssertion, AssertionResult } from '@/lib/db/schema';
import { cn } from '@/lib/utils';

interface SuccessCriteriaTabProps {
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

function StatusIcon({ status }: { status: 'passed' | 'failed' | 'skipped' | 'not_run' }) {
  switch (status) {
    case 'passed':
      return <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />;
    case 'failed':
      return <XCircle className="h-5 w-5 text-red-500 shrink-0" />;
    case 'skipped':
    case 'not_run':
      return <Circle className="h-5 w-5 text-muted-foreground shrink-0" />;
  }
}

export function SuccessCriteriaTab({
  assertions,
  assertionResults,
  softErrors,
  code,
  onParseNeeded,
}: SuccessCriteriaTabProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // If assertions is null, trigger parse
  useEffect(() => {
    if (!assertions && code && onParseNeeded) {
      onParseNeeded();
    }
  }, [assertions, code, onParseNeeded]);

  if (!assertions || assertions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {!assertions
          ? 'Analyzing test code for assertions...'
          : 'No assertions found in this test. Add assertions during recording using Shift+right-click on elements.'}
      </div>
    );
  }

  // Build a map of results by assertion ID
  const resultMap = new Map<string, AssertionResult>();
  if (assertionResults) {
    for (const r of assertionResults) {
      resultMap.set(r.assertionId, r);
    }
  }

  const passedCount = assertions.filter(a => resultMap.get(a.id)?.status === 'passed').length;
  const failedCount = assertions.filter(a => resultMap.get(a.id)?.status === 'failed').length;
  const hasResults = assertionResults && assertionResults.length > 0;

  // Find soft errors not matched to any assertion result
  const matchedErrors = new Set(
    assertionResults?.filter(r => r.errorMessage).map(r => r.errorMessage) ?? []
  );
  const unmatchedErrors = softErrors?.filter(e => !matchedErrors.has(e)) ?? [];

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between rounded-md border p-3 bg-muted/30">
        <div className="flex items-center gap-3">
          <span className="font-medium text-sm">Success Criteria</span>
          <span className="text-sm text-muted-foreground">
            {assertions.length} assertion{assertions.length !== 1 ? 's' : ''}
          </span>
        </div>
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

      {/* Assertions list */}
      <div className="space-y-1">
        {assertions.map(assertion => {
          const result = resultMap.get(assertion.id);
          const status = result?.status ?? 'not_run';
          const isExpanded = expanded.has(assertion.id);

          return (
            <div
              key={assertion.id}
              className={cn(
                'rounded-md border p-3 cursor-pointer transition-colors hover:bg-muted/30',
                status === 'failed' && 'border-red-200 dark:border-red-900',
              )}
              onClick={() => toggleExpand(assertion.id)}
            >
              <div className="flex items-start gap-3">
                <StatusIcon status={status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {assertion.label ?? `${assertion.assertionType}()`}
                    </span>
                    <Badge variant="outline" className={cn('text-xs', CATEGORY_COLORS[assertion.category])}>
                      {assertion.category}
                    </Badge>
                    {assertion.negated && (
                      <Badge variant="outline" className="text-xs">.not</Badge>
                    )}
                  </div>

                  {/* Expected / Actual values */}
                  {(assertion.expectedValue || result?.actualValue) && (
                    <div className="mt-1 text-xs space-y-0.5">
                      {assertion.expectedValue && (
                        <div className="text-muted-foreground">
                          Expected: <span className="font-mono">{assertion.expectedValue}</span>
                        </div>
                      )}
                      {result?.actualValue && (
                        <div className={status === 'failed' ? 'text-red-600' : 'text-muted-foreground'}>
                          Actual: <span className="font-mono">{result.actualValue}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error message on failure */}
                  {result?.errorMessage && (
                    <div className="mt-1 text-xs text-red-600 font-mono break-all">
                      {result.errorMessage}
                    </div>
                  )}

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-2 text-xs text-muted-foreground space-y-1 border-t pt-2">
                      {assertion.targetSelector && (
                        <div>Selector: <span className="font-mono">{assertion.targetSelector}</span></div>
                      )}
                      {assertion.codeLineStart && (
                        <div>Code line: {assertion.codeLineStart}{assertion.codeLineEnd && assertion.codeLineEnd !== assertion.codeLineStart ? `–${assertion.codeLineEnd}` : ''}</div>
                      )}
                      {result?.durationMs != null && (
                        <div>Duration: {result.durationMs}ms</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Unmatched soft errors */}
      {unmatchedErrors.length > 0 && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950 p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Unmatched Soft Errors ({unmatchedErrors.length})
            </span>
          </div>
          <div className="space-y-1">
            {unmatchedErrors.map((error, i) => (
              <div key={i} className="text-xs font-mono text-yellow-700 dark:text-yellow-300 break-all">
                {error}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
