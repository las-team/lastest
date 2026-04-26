'use client';

import { useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Crosshair, CheckCircle2, ShieldCheck, Variable } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CapturedScreenshot, StepCriterion, StepRule, TestAssertion, TestVariable } from '@/lib/db/schema';

interface StepCriteriaTabProps {
  testId: string;
  screenshots: CapturedScreenshot[] | null;
  stepCriteria: StepCriterion[] | null;
  assertions: TestAssertion[] | null;
  variables?: TestVariable[] | null;
  onSaveVariables?: (next: TestVariable[]) => Promise<void>;
}

// Assertion criteria are test-level (not tied to a screenshot step), so they
// share a single sentinel stepLabel. Keep it in one place to avoid drift.
const ASSERTION_STEP_LABEL = '__assertions__';

// Build the union of step labels we know about: persisted criteria stepLabels +
// labels of screenshots captured by the latest run. Falls back to a single
// '' (default screenshot) when neither source has any.
function collectStepLabels(
  screenshots: CapturedScreenshot[] | null,
  stepCriteria: StepCriterion[] | null,
): string[] {
  const labels = new Set<string>();
  for (const s of screenshots ?? []) labels.add(s.label ?? '');
  for (const c of stepCriteria ?? []) labels.add(c.stepLabel);
  if (labels.size === 0) labels.add('');
  return Array.from(labels);
}

export function StepCriteriaTab({ testId, screenshots, stepCriteria, assertions, variables, onSaveVariables }: StepCriteriaTabProps) {
  const [criteria, setCriteria] = useState<StepCriterion[]>(stepCriteria ?? []);
  const [pending, startTransition] = useTransition();
  const [varDraft, setVarDraft] = useState<TestVariable[]>(variables ?? []);
  const [varSaving, setVarSaving] = useState(false);

  // Sync local draft when external variables change
  useEffect(() => {
    setVarDraft(variables ?? []);
  }, [variables]);

  const extractVars = varDraft.filter(v => v.mode === 'extract');

  const updateVar = (id: string, patch: Partial<TestVariable>) => {
    setVarDraft(prev => prev.map(v => (v.id === id ? { ...v, ...patch } : v)));
  };

  const saveVarChanges = async () => {
    if (!onSaveVariables) return;
    setVarSaving(true);
    try {
      await onSaveVariables(varDraft);
      toast.success('Variable assertions saved');
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setVarSaving(false);
    }
  };

  const hasUnsavedVarChanges = JSON.stringify(varDraft) !== JSON.stringify(variables ?? []);
  const [focusByStep, setFocusByStep] = useState<Record<string, number>>({});
  // Screenshot step rows only — exclude the assertion sentinel so it doesn't
  // render as a ghost screenshot.
  const labels = collectStepLabels(screenshots, criteria).filter(l => l !== ASSERTION_STEP_LABEL);
  const sortedAssertions = [...(assertions ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { listFocusRegionsByTest } = await import('@/server/actions/diffs');
        const rows = await listFocusRegionsByTest(testId);
        if (cancelled) return;
        const counts: Record<string, number> = {};
        for (const r of rows) {
          const key = r.stepLabel ?? '';
          counts[key] = (counts[key] ?? 0) + 1;
        }
        setFocusByStep(counts);
      } catch {
        // Focus-region badge is decorative — silent failure is fine.
      }
    })();
    return () => { cancelled = true; };
  }, [testId]);

  const hasRule = (stepLabel: string, kind: StepRule['kind']) => {
    const c = criteria.find(c => c.stepLabel === stepLabel);
    return !!c?.rules.some(r => r.kind === kind);
  };

  const setRule = (stepLabel: string, kind: StepRule['kind'], on: boolean) => {
    const current = criteria.find(c => c.stepLabel === stepLabel)?.rules ?? [];
    const next: StepRule[] = on
      ? current.some(r => r.kind === kind)
        ? current
        : [...current, { kind, severity: 'fail' }]
      : current.filter(r => r.kind !== kind);

    // Optimistic UI
    setCriteria(prev => {
      const others = prev.filter(c => c.stepLabel !== stepLabel);
      return next.length === 0 ? others : [...others, { stepLabel, rules: next }];
    });

    startTransition(async () => {
      try {
        const { saveStepCriteria } = await import('@/server/actions/tests');
        await saveStepCriteria(testId, stepLabel, next);
      } catch (err) {
        toast.error(`Failed to save criteria: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step Criteria</CardTitle>
        <CardDescription>
          Promote a per-step diff to a hard test failure. Without these rules a
          changed screenshot only flags the build for review.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {labels.map(label => {
          const focusCount = focusByStep[label] ?? 0;
          return (
            <div key={label || '(default)'} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">
                  {label || <span className="text-muted-foreground">(default screenshot)</span>}
                </span>
                {focusCount > 0 && (
                  <Badge variant="outline" className="gap-1 border-green-300 text-green-700 bg-green-50 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800">
                    <Crosshair className="h-3 w-3" />
                    {focusCount === 1 ? 'Focus region — diff restricted to 1 area' : `Focus regions — diff restricted to ${focusCount} areas`}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`screenshot-changed-${label}`}
                  checked={hasRule(label, 'screenshot_changed')}
                  disabled={pending}
                  onCheckedChange={checked => setRule(label, 'screenshot_changed', !!checked)}
                />
                <Label htmlFor={`screenshot-changed-${label}`} className="text-sm font-normal">
                  Fail if screenshot changed
                  {focusCount > 0 && <span className="text-muted-foreground"> (inside focus region)</span>}
                </Label>
              </div>
            </div>
          );
        })}

        <div className="border rounded-md p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <ShieldCheck className="h-4 w-4 text-teal-600" />
            <span className="text-sm font-medium">Assertions</span>
            <Badge variant="outline" className="text-xs">
              {sortedAssertions.length} in test code
            </Badge>
          </div>
          {sortedAssertions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No assertions parsed from this test. Hard assertions (e.g. <code>expect(...)</code>) fail the test automatically; soft assertions do not.
            </p>
          ) : (
            <ul className="text-xs space-y-1">
              {sortedAssertions.map(a => (
                <li key={a.id} className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className={`h-3 w-3 shrink-0 ${a.isSoft ? 'text-amber-500' : 'text-teal-500'}`} />
                  <span className="truncate">
                    {a.label || `${a.category}/${a.assertionType}`}
                  </span>
                  <span className="ml-auto uppercase text-[10px] tracking-wide shrink-0">
                    {a.isSoft ? 'soft' : 'hard'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-start gap-2 pt-1 border-t">
            <Checkbox
              id="assertion-failed-rule"
              className="mt-0.5"
              checked={hasRule(ASSERTION_STEP_LABEL, 'assertion_failed')}
              disabled={pending}
              onCheckedChange={checked => setRule(ASSERTION_STEP_LABEL, 'assertion_failed', !!checked)}
            />
            <Label htmlFor="assertion-failed-rule" className="text-sm font-normal leading-snug">
              Fail the test if <em>any</em> assertion fails
              <span className="block text-xs text-muted-foreground">
                Hard assertions already fail the test. Enable this to also fail on soft-assertion failures.
              </span>
            </Label>
          </div>
        </div>

        {/* End-of-test variable assertions — duplicate of the Vars tab inputs.
            Both surfaces edit the same `tests.variables` record. */}
        {onSaveVariables && (
          <div className="border rounded-md p-3 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Variable className="h-4 w-4 text-cyan-600" />
              <span className="text-sm font-medium">End-of-test variable assertions</span>
              <Badge variant="outline" className="text-xs">{extractVars.length} extract var{extractVars.length === 1 ? '' : 's'}</Badge>
              <span className="text-[11px] text-muted-foreground">These also appear in the Vars tab. Edits sync.</span>
            </div>

            {extractVars.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No extract-mode variables yet. Add one on the Vars tab to assert a page field&apos;s value at end of test.
              </p>
            ) : (
              <div className="space-y-2">
                {extractVars.map(v => (
                  <div key={v.id} className="grid grid-cols-12 gap-2 items-center text-xs">
                    <div className="col-span-3 font-mono truncate" title={v.name}>{v.name}</div>
                    <div className="col-span-3 truncate text-muted-foreground" title={v.targetSelector}>
                      {v.targetSelector}
                    </div>
                    <Input
                      className="col-span-3 h-7 text-xs"
                      placeholder="Expected value"
                      value={v.expectedValue ?? ''}
                      onChange={e => updateVar(v.id, { expectedValue: e.target.value })}
                    />
                    <div className="col-span-2">
                      <Select
                        value={v.assertSeverity ?? 'fail'}
                        onValueChange={val => updateVar(v.id, { assertSeverity: val as 'fail' | 'warn' })}
                        disabled={!v.assertEnabled}
                      >
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fail">fail</SelectItem>
                          <SelectItem value="warn">warn</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Switch
                        checked={!!v.assertEnabled}
                        onCheckedChange={enabled => updateVar(v.id, { assertEnabled: enabled })}
                      />
                    </div>
                  </div>
                ))}
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={saveVarChanges}
                    disabled={varSaving || !hasUnsavedVarChanges}
                    className="text-xs px-3 py-1 rounded border bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {varSaving ? 'Saving...' : hasUnsavedVarChanges ? 'Save changes' : 'Saved'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
