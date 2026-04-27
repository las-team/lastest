'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type {
  TestVariable,
  GoogleSheetsDataSource,
  CsvDataSource,
} from '@/lib/db/schema';
import { VarEditDialog } from './var-edit-dialog';
import { CsvSourcesSettingsCard } from '@/components/settings/csv-sources-settings-card';
import { extractTestBody, parseSteps } from '@/lib/playwright/debug-parser';
import { collectExtractableSelectors } from '@/lib/playwright/extractable-selector';
import { cn } from '@/lib/utils';

export interface TestVarsTabProps {
  testId: string;
  repositoryId?: string | null;
  variables: TestVariable[];
  sheetSources: GoogleSheetsDataSource[];
  csvSources: CsvDataSource[];
  onSaveVariables: (next: TestVariable[]) => Promise<void>;
  /** Values pulled by extract-mode vars during the most recent run, keyed by
   *  variable name. Surfaced in the table as the "Last run" column. */
  extractedValues?: Record<string, string> | null;
  /** Current test code — used to detect extract-mode vars whose targetSelector
   *  no longer appears in any step (orphaned vars). When omitted, no orphan
   *  detection runs. */
  code?: string | null;
}

function describeSource(v: TestVariable): string {
  if (v.mode === 'extract') return v.targetSelector ? `${v.attribute || 'value'} of ${v.targetSelector}` : '—';
  if (v.sourceType === 'static') return `static: ${v.staticValue ?? ''}`;
  if (v.sourceType === 'gsheet') return `gsheet:${v.sourceAlias}.${v.sourceColumn}[${v.sourceRow ?? 0}]`;
  if (v.sourceType === 'csv') return `csv:${v.sourceAlias}.${v.sourceColumn}[${v.sourceRow ?? 0}]`;
  return '—';
}

export function TestVarsTab({
  testId: _testId,
  repositoryId,
  variables,
  sheetSources,
  csvSources,
  onSaveVariables,
  extractedValues,
  code,
}: TestVarsTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TestVariable | null>(null);

  // Build the set of selectors a user could currently extract from the test
  // code. Any extract-mode var whose targetSelector isn't in this set is
  // considered orphaned (test was edited and the field is gone).
  // When code isn't supplied we skip the check — null means "don't know".
  const availableSelectors = useMemo<Set<string> | null>(() => {
    if (!code) return null;
    const body = extractTestBody(code);
    if (!body) return null;
    return collectExtractableSelectors(parseSteps(body));
  }, [code]);

  const isOrphan = (v: TestVariable): boolean => {
    if (v.mode !== 'extract') return false;
    if (!availableSelectors) return false;
    if (!v.targetSelector) return false;
    return !availableSelectors.has(v.targetSelector);
  };

  const orphanCount = variables.filter(isOrphan).length;

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (v: TestVariable) => {
    setEditing(v);
    setDialogOpen(true);
  };

  const handleSave = async (v: TestVariable) => {
    const next = editing
      ? variables.map(x => (x.id === editing.id ? v : x))
      : [...variables, v];
    try {
      await onSaveVariables(next);
      toast.success(editing ? 'Variable updated' : 'Variable created');
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  };

  const handleDelete = async (v: TestVariable) => {
    if (!confirm(`Delete variable "${v.name}"?`)) return;
    const next = variables.filter(x => x.id !== v.id);
    try {
      await onSaveVariables(next);
      toast.success('Variable deleted');
    } catch (err) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Test variables</CardTitle>
            <CardDescription>
              Bind named values to page fields. Use <code>{'{{var:name}}'}</code> in test code for assign-mode vars; extract-mode vars read from the page after the test runs.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" /> New variable
          </Button>
        </CardHeader>
        {orphanCount > 0 && (
          <div className="mx-6 -mt-1 mb-3 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              {orphanCount === 1 ? '1 variable references' : `${orphanCount} variables reference`} a selector that&apos;s no longer in the test.
            </span>
          </div>
        )}
        <CardContent>
          {variables.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No variables yet. Add one to bind a CSV/Sheet column to a page field, or to assert a field&apos;s value at end of test.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="text-left py-2 pr-3">Name</th>
                    <th className="text-left py-2 pr-3">Mode</th>
                    <th className="text-left py-2 pr-3">Source / Selector</th>
                    <th className="text-left py-2 pr-3">Expected</th>
                    <th className="text-left py-2 pr-3">Last run</th>
                    <th className="text-left py-2 pr-3">Assert</th>
                    <th className="py-2 w-[88px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {variables.map(v => {
                    const lastRun = extractedValues?.[v.name];
                    const orphan = isOrphan(v);
                    return (
                      <tr
                        key={v.id}
                        className={cn(
                          'border-b last:border-0 hover:bg-muted/40',
                          orphan && 'opacity-60 bg-muted/30',
                        )}
                      >
                        <td className="py-2 pr-3 font-mono">
                          <span className="inline-flex items-center gap-1.5">
                            {orphan && (
                              <AlertTriangle
                                className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0"
                                aria-label="Selector no longer in test"
                              />
                            )}
                            <span className={cn(orphan && 'line-through decoration-muted-foreground/40')}>
                              {v.name}
                            </span>
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant={v.mode === 'extract' ? 'secondary' : 'outline'}>
                            {v.mode}
                          </Badge>
                        </td>
                        <td
                          className="py-2 pr-3 font-mono text-xs"
                          title={orphan ? 'This selector no longer appears in any step of the test.' : undefined}
                        >
                          {describeSource(v)}
                          {orphan && (
                            <span className="block text-[10px] text-amber-700 dark:text-amber-400 not-italic">
                              not in test anymore
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">{v.expectedValue ?? ''}</td>
                        <td className="py-2 pr-3 font-mono text-xs max-w-[220px] truncate" title={lastRun ?? ''}>
                          {lastRun != null && lastRun !== '' ? (
                            <span className={
                              v.mode === 'extract' && v.assertEnabled && v.expectedValue != null
                                ? lastRun === v.expectedValue
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-red-600 dark:text-red-400'
                                : ''
                            }>
                              {lastRun}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {v.assertEnabled ? (
                            <Badge variant={v.assertSeverity === 'warn' ? 'secondary' : 'destructive'}>
                              {v.assertSeverity ?? 'fail'}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(v)}
                            aria-label="Edit"
                            disabled={orphan}
                            title={orphan ? 'Selector no longer in test — delete or recreate from a step' : 'Edit'}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant={orphan ? 'destructive' : 'ghost'}
                            onClick={() => handleDelete(v)}
                            aria-label={orphan ? 'Delete orphaned variable' : 'Delete'}
                            title={orphan ? 'Delete orphaned variable' : 'Delete'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CsvSourcesSettingsCard
        dataSources={csvSources}
        repositoryId={repositoryId}
      />

      <VarEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing ?? undefined}
        takenNames={variables.map(v => v.name)}
        sheetSources={sheetSources}
        csvSources={csvSources}
        onSave={handleSave}
      />
    </div>
  );
}
