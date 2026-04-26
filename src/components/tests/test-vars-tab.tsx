'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
  TestVariable,
  GoogleSheetsDataSource,
  CsvDataSource,
} from '@/lib/db/schema';
import { VarEditDialog } from './var-edit-dialog';
import { CsvSourcesSettingsCard } from '@/components/settings/csv-sources-settings-card';

export interface TestVarsTabProps {
  testId: string;
  repositoryId?: string | null;
  variables: TestVariable[];
  sheetSources: GoogleSheetsDataSource[];
  csvSources: CsvDataSource[];
  onSaveVariables: (next: TestVariable[]) => Promise<void>;
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
}: TestVarsTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TestVariable | null>(null);

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
                    <th className="text-left py-2 pr-3">Assert</th>
                    <th className="py-2 w-[88px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {variables.map(v => (
                    <tr key={v.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 pr-3 font-mono">{v.name}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={v.mode === 'extract' ? 'secondary' : 'outline'}>
                          {v.mode}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{describeSource(v)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{v.expectedValue ?? ''}</td>
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
                        <Button size="icon" variant="ghost" onClick={() => openEdit(v)} aria-label="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(v)} aria-label="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
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
