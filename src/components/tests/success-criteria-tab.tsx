'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Circle, ListOrdered, Code2 } from 'lucide-react';
import type {
  TestAssertion,
  AssertionResult,
  CapturedScreenshot,
  TestVariable,
  GoogleSheetsDataSource,
  CsvDataSource,
} from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { extractTestBody, parseSteps, extractEditableValue, type DebugStep } from '@/lib/playwright/debug-parser';
import { parseAssertions } from '@/lib/playwright/assertion-parser';
import { parseExtractableSelector } from '@/lib/playwright/extractable-selector';
import { Variable } from 'lucide-react';
import { VarEditDialog } from './var-edit-dialog';

interface TestStepsTabProps {
  assertions: TestAssertion[] | null;
  assertionResults: AssertionResult[] | null;
  softErrors: string[] | null;
  code: string;
  testStatus?: string | null;
  errorMessage?: string | null;
  screenshots?: CapturedScreenshot[] | null;
  envBaseUrl?: string | null;
  lastReachedStep?: number | null;
  totalSteps?: number | null;
  variables?: TestVariable[] | null;
  sheetSources?: GoogleSheetsDataSource[];
  csvSources?: CsvDataSource[];
  onSaveVariables?: (next: TestVariable[]) => Promise<void>;
  onParseNeeded?: () => void;
  onStepValueChange?: (stepLineStart: number, stepLineEnd: number, oldValue: string, newValue: string) => Promise<void>;
  onGoToCode?: (line: number) => void;
  /** Called after the user creates an extract-mode Var from a step, so the
   *  parent can switch to the Vars tab and show the refreshed list. */
  onNavigateToVars?: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  element: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  page: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  generic: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  visual: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  download: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
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

// Actionable chip styles for the per-step Bind / Extract / Var controls.
// Pill-shaped, cyan-tinted (matches the `variable` type color), with clear hover/focus states
// so they read as clickable affordances rather than passive badges.
const VAR_CHIP_BASE =
  'inline-flex items-center gap-1 rounded-full h-5 px-2 text-[10px] font-medium border shrink-0 ' +
  'transition-colors cursor-pointer ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40';
const VAR_CHIP_OUTLINE =
  'bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border-cyan-200 ' +
  'dark:bg-cyan-950/40 dark:hover:bg-cyan-900/60 dark:text-cyan-300 dark:border-cyan-800';
const VAR_CHIP_SOLID =
  'bg-cyan-600 hover:bg-cyan-700 text-white border-cyan-600 ' +
  'dark:bg-cyan-500 dark:hover:bg-cyan-400 dark:text-cyan-50 dark:border-cyan-500';

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

/** Match an assertion to a step by overlapping code line ranges.
 *  Prefer assertion-type steps to avoid grouping under screenshots/actions.
 *  bodyLineOffset adjusts assertion line numbers (full source) to body-relative lines. */
function matchAssertionToStep(assertion: TestAssertion, steps: DebugStep[], bodyLineOffset: number): DebugStep | null {
  if (!assertion.codeLineStart) return null;
  const adjustedLine = assertion.codeLineStart - bodyLineOffset;
  // First pass: only match assertion-type steps
  for (const step of steps) {
    if (step.type === 'assertion' && adjustedLine >= step.lineStart && adjustedLine <= step.lineEnd) {
      return step;
    }
  }
  // Second pass: match wait steps (waitForLoadState etc. can be assertion targets)
  for (const step of steps) {
    if (step.type === 'wait' && adjustedLine >= step.lineStart && adjustedLine <= step.lineEnd) {
      return step;
    }
  }
  return null;
}

/** Resolve variable references in step labels with actual values */
function resolveStepLabel(label: string, code: string, baseUrl: string | null | undefined): string {
  if (!baseUrl) return label;
  let resolved = label;

  // Resolve buildUrl(baseUrl, '/path') patterns in both label and code
  const buildUrlMatch = code.match(/buildUrl\s*\(\s*baseUrl\s*,\s*['"`]([^'"`]+)['"`]\s*\)/);
  if (buildUrlMatch) {
    const path = buildUrlMatch[1];
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    const fullUrl = cleanBase + cleanPath;
    // Replace the buildUrl(...) portion in the label
    resolved = resolved.replace(/buildUrl\(baseUrl,\s*/, '');
    // If the label is "Navigate to buildUrl(baseUrl," try to make it "Navigate to <url>"
    if (resolved.startsWith('Navigate to ')) {
      resolved = `Navigate to ${fullUrl}`;
    }
  }

  // Resolve template literal ${baseUrl} references
  resolved = resolved.replace(/\$\{baseUrl\}/g, baseUrl);

  // Resolve bare `baseUrl` when it appears as a standalone goto target
  if (resolved === 'Navigate to baseUrl') {
    resolved = `Navigate to ${baseUrl}`;
  }

  // Resolve new Date().toISOString() references
  resolved = resolved.replace(/new Date\(\)\.toISOString\(\)/, 'current timestamp');

  return resolved;
}

const ALL_TYPES = ['action', 'navigation', 'assertion', 'screenshot', 'wait', 'variable', 'log', 'other'] as const;
const DEFAULT_HIDDEN: Set<string> = new Set(['wait', 'other']);

export function TestStepsTab({
  assertions: dbAssertions,
  assertionResults,
  softErrors,
  code,
  testStatus,
  errorMessage,
  screenshots,
  envBaseUrl,
  lastReachedStep: serverLastReachedStep,
  totalSteps: serverTotalSteps,
  variables,
  sheetSources = [],
  csvSources = [],
  onSaveVariables,
  onParseNeeded,
  onStepValueChange,
  onGoToCode,
  onNavigateToVars,
}: TestStepsTabProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set(DEFAULT_HIDDEN));
  const [editingValues, setEditingValues] = useState<Map<number, string>>(new Map());
  const [savingSteps, setSavingSteps] = useState<Set<number>>(new Set());
  const debounceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Bind-to-Var (assign) and Extract-to-Var dialog state — keyed by step id while open.
  // `mode === 'assign'` is fired by the inline value-input "Bind" button and rewrites the literal in code.
  // `mode === 'extract'` is fired by the per-step "Extract" button and only persists a Var; nothing in code changes.
  const [bindStep, setBindStep] = useState<
    | { mode: 'assign'; step: DebugStep; originalValue: string; selectorHint?: string }
    | { mode: 'extract'; step: DebugStep; selectorHint: string }
    | null
  >(null);

  // Always parse assertions fresh from code — DB assertions can have stale line numbers
  const { steps, bodyLineOffset, freshAssertions } = useMemo(() => {
    if (!code) return { steps: [] as DebugStep[], bodyLineOffset: 0, freshAssertions: [] as TestAssertion[] };
    const body = extractTestBody(code);
    if (!body) return { steps: [] as DebugStep[], bodyLineOffset: 0, freshAssertions: [] as TestAssertion[] };
    const bodyIdx = code.indexOf(body);
    const offset = bodyIdx >= 0 ? code.slice(0, bodyIdx).split('\n').length - 1 : 0;
    return {
      steps: parseSteps(body),
      bodyLineOffset: offset,
      freshAssertions: parseAssertions(code),
    };
  }, [code]);

  // Use fresh-parsed assertions when available; otherwise fall back to DB.
  // All assertions are soft — the Criteria tab decides what fails the test.
  const assertions = useMemo(() => {
    if (freshAssertions.length === 0) return dbAssertions ?? [];
    return freshAssertions;
  }, [freshAssertions, dbAssertions]);

  // Sync DB if assertions are stale
  useMemo(() => {
    if (!dbAssertions || !code || !onParseNeeded) return;
    if (freshAssertions.length === 0) return;
    // Check if DB assertions have different IDs than fresh ones
    const dbIds = new Set(dbAssertions.map(a => a.id));
    const freshIds = new Set(freshAssertions.map(a => a.id));
    const needsSync = freshAssertions.some(a => !dbIds.has(a.id)) || dbAssertions.some(a => !freshIds.has(a.id));
    if (needsSync) {
      // Fire async — best effort DB sync
      Promise.resolve().then(() => onParseNeeded());
    }
  }, [dbAssertions, freshAssertions, code, onParseNeeded]);

  const toggleType = (type: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleValueChange = useCallback((step: DebugStep, originalValue: string, newValue: string) => {
    setEditingValues(prev => new Map(prev).set(step.id, newValue));
    // Debounce the save
    const existing = debounceTimers.current.get(step.id);
    if (existing) clearTimeout(existing);
    debounceTimers.current.set(step.id, setTimeout(async () => {
      debounceTimers.current.delete(step.id);
      if (!onStepValueChange || newValue === originalValue) return;
      setSavingSteps(prev => new Set(prev).add(step.id));
      try {
        await onStepValueChange(step.lineStart + bodyLineOffset, step.lineEnd + bodyLineOffset, originalValue, newValue);
        // Don't clear editingValues here — props update from router.refresh() races
        // the React state flush, and clearing too early flashes the stale prop value
        // back into the input. The prop-sync effect below clears it once the
        // re-parsed code reflects the new value.
      } finally {
        setSavingSteps(prev => { const next = new Set(prev); next.delete(step.id); return next; });
      }
    }, 500));
  }, [onStepValueChange, bodyLineOffset]);

  // Drop editingValues entries once the underlying parsed step value has caught up
  // with what the user typed — avoids the flicker described above.
  useEffect(() => {
    if (editingValues.size === 0) return;
    let changed = false;
    const next = new Map(editingValues);
    for (const step of steps) {
      const editing = next.get(step.id);
      if (editing === undefined) continue;
      const current = extractEditableValue(step);
      if (current !== null && current === editing) {
        next.delete(step.id);
        changed = true;
      }
    }
    if (changed) setEditingValues(next);
  }, [steps, editingValues]);

  // Build assertion result map
  const resultMap = new Map<string, AssertionResult>();
  if (assertionResults) {
    for (const r of assertionResults) {
      resultMap.set(r.assertionId, r);
    }
  }

  // Build step → assertion(s) map using fresh-parsed assertions (always correct line numbers)
  const stepAssertionMap = useMemo(() => {
    const map = new Map<number, TestAssertion[]>();
    if (assertions.length === 0 || steps.length === 0) return map;
    for (const a of assertions) {
      const step = matchAssertionToStep(a, steps, bodyLineOffset);
      if (step) {
        const existing = map.get(step.id) ?? [];
        existing.push(a);
        map.set(step.id, existing);
      }
    }
    return map;
  }, [assertions, steps, bodyLineOffset]);

  const hasAssertions = assertions.length > 0;
  const passedCount = hasAssertions ? assertions.filter(a => resultMap.get(a.id)?.status === 'passed').length : 0;
  const failedCount = hasAssertions ? assertions.filter(a => resultMap.get(a.id)?.status === 'failed').length : 0;
  const hasResults = hasAssertions && assertionResults && assertionResults.length > 0;
  // A failed assertion is the most likely culprit for a stopped test, regardless
  // of whether the user wired it as a hard criterion. Treat any failure as
  // "this explains the stop point" so we don't double-flag the next non-assertion
  // step as the failure point.
  const hasFailedAssertion = hasAssertions && assertions.some(a => resultMap.get(a.id)?.status === 'failed');

  // Count steps by type for filter badges
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of steps) {
      counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    }
    return counts;
  }, [steps]);

  // Compute execution watermark: the index of the last step that was reached.
  // Primary source: server-side __stepReached() instrumentation (precise).
  // Fallback: client-side heuristics for old results without server data.
  const executionWatermark = useMemo(() => {
    if (!testStatus || steps.length === 0) return -1;
    if (testStatus === 'passed') return steps.length - 1;

    // Use server-provided step tracking when available (robust)
    if (typeof serverLastReachedStep === 'number' && serverLastReachedStep >= 0 && typeof serverTotalSteps === 'number' && serverTotalSteps > 0) {
      // Server parsed the transformed body (after type stripping etc.) which may
      // have a different step count than the client's parse of the original code.
      // Map using ratio to handle count differences.
      if (serverTotalSteps === steps.length) {
        return serverLastReachedStep; // perfect match
      }
      return Math.min(
        Math.round((serverLastReachedStep / serverTotalSteps) * steps.length),
        steps.length - 1,
      );
    }

    // Fallback: client-side heuristics for old results
    let maxReached = -1;

    const hasExecutionEvidence = (assertionResults && assertionResults.length > 0)
      || (softErrors && softErrors.length > 0)
      || !!errorMessage;
    if (screenshots && screenshots.length > 0 && hasExecutionEvidence) {
      let screenshotStepIdx = 0;
      for (let i = 0; i < steps.length; i++) {
        if (steps[i].type === 'screenshot') {
          if (screenshotStepIdx < screenshots.length) {
            maxReached = Math.max(maxReached, i);
          }
          screenshotStepIdx++;
        }
      }
    }

    if (assertionResults && assertionResults.length > 0) {
      const ranIds = new Set(assertionResults.map(r => r.assertionId));
      for (let i = 0; i < steps.length; i++) {
        const sa = stepAssertionMap.get(steps[i].id) ?? [];
        if (sa.some(a => ranIds.has(a.id))) {
          maxReached = Math.max(maxReached, i);
        }
      }
    }

    if (errorMessage && maxReached < steps.length - 1) {
      const lineMatch = errorMessage.match(/at\s+(?:<anonymous>|eval)[^:]*:(\d+):/);
      if (lineMatch) {
        const errorLine = parseInt(lineMatch[1], 10);
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].lineStart <= errorLine && steps[i].lineEnd >= errorLine) {
            maxReached = Math.max(maxReached, i);
            break;
          }
        }
      }
    }

    if (errorMessage && maxReached < steps.length - 1) {
      const selectorMatch = errorMessage.match(/(?:selector|locator)\s+['"`]([^'"`]+)['"`]/i)
        || errorMessage.match(/waiting for\s+['"`]([^'"`]+)['"`]/i)
        || errorMessage.match(/No selector matched:\s*\[.*?"value"\s*:\s*"([^"]+)"/);
      if (selectorMatch) {
        const needle = selectorMatch[1];
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].code.includes(needle)) {
            maxReached = Math.max(maxReached, i);
            break;
          }
        }
      }
    }

    return maxReached;
  }, [testStatus, steps, screenshots, assertionResults, softErrors, stepAssertionMap, errorMessage, serverLastReachedStep, serverTotalSteps]);

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
                const isAssertionStep = step.type === 'assertion' || step.type === 'wait' || stepAssertions.length > 0;
                const isExpandable = isAssertionStep && stepAssertions.length > 0;
                const isExpanded = expanded.has(step.id);

                // Determine assertion-level status for this step
                const stepStatuses = stepAssertions.map(a => resultMap.get(a.id)?.status);
                const hasFailed = stepStatuses.includes('failed');
                const allPassed = stepStatuses.length > 0 && stepStatuses.every(s => s === 'passed');

                // Execution progress: was this step reached?
                const wasReached = executionWatermark >= 0 && globalIdx <= executionWatermark;
                // Only flag non-assertion steps as failure point when no assertion already explains the failure
                const isFailurePoint = testStatus === 'failed' && globalIdx === executionWatermark && !isAssertionStep && !hasFailedAssertion;

                return (
                  <div
                    key={step.id}
                    className={cn(
                      'rounded-md border p-2.5 transition-colors',
                      isExpandable && 'cursor-pointer hover:bg-muted/30',
                      isExpandable && hasFailed && 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30',
                      isExpandable && allPassed && 'border-green-200 bg-green-50/30 dark:border-green-900 dark:bg-green-950/20',
                      isExpandable && !hasFailed && !allPassed && 'border-amber-200/60 bg-amber-50/20 dark:border-amber-900/40 dark:bg-amber-950/10',
                      !isExpandable && 'border-transparent bg-transparent hover:bg-muted/20',
                    )}
                    onClick={() => isExpandable && toggleExpand(step.id)}
                  >
                    <div className="flex items-center gap-2">
                      {/* Step number */}
                      <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
                        {globalIdx + 1}.
                      </span>

                      {/* Status icon */}
                      {isExpandable ? (
                        <StatusIcon
                          status={hasFailed ? 'failed' : allPassed ? 'passed' : wasReached ? 'passed' : 'not_run'}
                        />
                      ) : isFailurePoint ? (
                        <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                      ) : wasReached ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500/50 shrink-0" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground/20 shrink-0" />
                      )}

                      {/* Step label — with inline editable value for fill/type steps */}
                      {(() => {
                        const originalValue = extractEditableValue(step);
                        const editValue = editingValues.get(step.id);
                        const isSaving = savingSteps.has(step.id);
                        const label = resolveStepLabel(step.label, step.code, envBaseUrl);

                        if (originalValue !== null && onStepValueChange) {
                          // Split label into prefix (before value) and show value as input
                          const valueInLabel = originalValue.length > 20 ? originalValue.slice(0, 20) : originalValue;
                          const labelPrefix = label.includes(`"${valueInLabel}`)
                            ? label.slice(0, label.indexOf(`"${valueInLabel}`))
                            : label.replace(/\s*"[^"]*"?\s*$/, '');

                          const isVarRef = /^\{\{var:[a-zA-Z_][a-zA-Z0-9_-]*\}\}$/.test(originalValue);
                          // Best-effort selector hint parsed from step.code (e.g. page.locator('#email'))
                          const selectorMatch = step.code.match(/locator\(['"`]([^'"`]+)['"`]\)/);
                          const selectorHint = selectorMatch?.[1];
                          return (
                            <span className={cn('text-sm flex-1 min-w-0 flex items-center gap-1', isExpandable && 'font-medium')}>
                              <span className="truncate shrink-0">{labelPrefix}</span>
                              <input
                                type="text"
                                value={editValue ?? originalValue}
                                onChange={(e) => handleValueChange(step, originalValue, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className={cn(
                                  'text-sm font-mono bg-muted/50 border border-border/50 rounded px-1.5 py-0 h-5 min-w-[60px] max-w-[200px] flex-1',
                                  'focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring',
                                  isSaving && 'opacity-50',
                                )}
                              />
                              {onSaveVariables && (
                                <button
                                  type="button"
                                  className={cn(VAR_CHIP_BASE, isVarRef ? VAR_CHIP_SOLID : VAR_CHIP_OUTLINE)}
                                  title={isVarRef ? 'Already bound to a variable — click to edit' : 'Bind this value to a variable'}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBindStep({ mode: 'assign', step, originalValue, selectorHint });
                                  }}
                                >
                                  <Variable className="h-3 w-3" />
                                  {isVarRef ? 'Var' : 'Bind'}
                                </button>
                              )}
                            </span>
                          );
                        }

                        return (
                          <span className={cn(
                            'text-sm flex-1 min-w-0 truncate',
                            isExpandable && 'font-medium',
                          )}>
                            {label}
                          </span>
                        );
                      })()}

                      {/* Extract-to-Var chip — shows on any step where we can parse a selector
                          (locator, getByRole/Text/TestId/Label/Placeholder/AltText/Title, locateWithFallback). */}
                      {onSaveVariables && (() => {
                        const sel = parseExtractableSelector(step.code);
                        if (!sel) return null;
                        // If any extract-mode var already targets this selector, show the solid state.
                        const alreadyExtracted = (variables ?? []).some(
                          v => v.mode === 'extract' && v.targetSelector === sel,
                        );
                        return (
                          <button
                            type="button"
                            className={cn(VAR_CHIP_BASE, alreadyExtracted ? VAR_CHIP_SOLID : VAR_CHIP_OUTLINE)}
                            title={alreadyExtracted
                              ? `A variable already extracts from this selector — click to add another\nselector: ${sel}`
                              : `Extract value from this element to a variable\nselector: ${sel}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setBindStep({ mode: 'extract', step, selectorHint: sel });
                            }}
                          >
                            <Variable className="h-3 w-3" />
                            Extract
                          </button>
                        );
                      })()}

                      {/* Go to code line */}
                      {onGoToCode && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onGoToCode(step.lineStart + bodyLineOffset); }}
                          className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                          title={`Go to line ${step.lineStart + bodyLineOffset}`}
                        >
                          <Code2 className="h-3.5 w-3.5" />
                        </button>
                      )}

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
                    {isExpandable && isExpanded && (
                      <div className="mt-2 ml-7 space-y-2 border-t pt-2">
                        {stepAssertions.map(assertion => {
                          const result = resultMap.get(assertion.id);
                          const status = result?.status ?? 'not_run';
                          return (
                            <div key={assertion.id} className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-medium">
                                  {assertion.label ?? `${assertion.assertionType}()`}
                                </span>
                                <Badge variant="outline" className={cn('text-[10px] px-1 py-0 h-4', CATEGORY_COLORS[assertion.category])}>
                                  {assertion.category}
                                </Badge>
                                {assertion.negated && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">.not</Badge>
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
      {bindStep && onSaveVariables && (
        <VarEditDialog
          open={!!bindStep}
          onOpenChange={(o) => { if (!o) setBindStep(null); }}
          forcedMode={bindStep.mode}
          initial={
            bindStep.mode === 'assign'
              ? {
                  name: '',
                  mode: 'assign',
                  sourceType: 'static',
                  staticValue: bindStep.originalValue,
                  description: bindStep.selectorHint ? `Bound from step at ${bindStep.selectorHint}` : undefined,
                }
              : {
                  name: '',
                  mode: 'extract',
                  targetSelector: bindStep.selectorHint,
                  attribute: 'value',
                  description: `Extracted from step "${bindStep.step.label}"`,
                }
          }
          takenNames={(variables ?? []).map(v => v.name)}
          sheetSources={sheetSources}
          csvSources={csvSources}
          onSave={async (newVar) => {
            const next = [...(variables ?? []).filter(v => v.id !== newVar.id), newVar];
            await onSaveVariables(next);
            // For assign mode, also rewrite the literal value in code with {{var:name}}.
            // For extract mode, the var alone is enough — extraction happens at run time.
            const wasExtract = bindStep.mode === 'extract';
            if (bindStep.mode === 'assign' && onStepValueChange) {
              await onStepValueChange(
                bindStep.step.lineStart + bodyLineOffset,
                bindStep.step.lineEnd + bodyLineOffset,
                bindStep.originalValue,
                `{{var:${newVar.name}}}`,
              );
            }
            setBindStep(null);
            // For extract mode, jump to the Vars tab so the user sees the new
            // var listed alongside the rest.
            if (wasExtract) onNavigateToVars?.();
          }}
        />
      )}
    </Card>
  );
}

/** @deprecated Use TestStepsTab instead */
export const SuccessCriteriaTab = TestStepsTab;
