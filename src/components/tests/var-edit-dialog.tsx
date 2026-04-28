'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  TestVariable,
  TestVariableSourceRowMode,
  GoogleSheetsDataSource,
  CsvDataSource,
} from '@/lib/db/schema';

export interface VarEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<TestVariable> | null;
  takenNames?: string[];
  sheetSources: GoogleSheetsDataSource[];
  csvSources: CsvDataSource[];
  onSave: (variable: TestVariable) => Promise<void> | void;
  /** Forces extract or assign mode (hides the toggle when set). */
  forcedMode?: 'extract' | 'assign';
}

function genId() {
  return `var_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Sanitize an alias+column pair into a valid TestVariable.name. Must satisfy
// /^[a-zA-Z_][a-zA-Z0-9_-]*$/ — matches the regex enforced below.
function suggestName(alias: string, column: string): string {
  const raw = `${alias}_${column}`.toLowerCase();
  let cleaned = raw.replace(/[^a-z0-9_-]+/g, '_').replace(/_+/g, '_');
  cleaned = cleaned.replace(/^_+|_+$/g, '');
  if (!/^[a-zA-Z_]/.test(cleaned)) cleaned = `v_${cleaned}`;
  return cleaned;
}

export function VarEditDialog({
  open,
  onOpenChange,
  initial,
  takenNames = [],
  sheetSources,
  csvSources,
  onSave,
  forcedMode,
}: VarEditDialogProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [mode, setMode] = useState<'extract' | 'assign'>(forcedMode ?? initial?.mode ?? 'extract');
  const [targetSelector, setTargetSelector] = useState(initial?.targetSelector ?? '');
  const [attribute, setAttribute] = useState<TestVariable['attribute']>(initial?.attribute ?? 'value');
  const [sourceType, setSourceType] = useState<TestVariable['sourceType']>(initial?.sourceType ?? 'static');
  const [sourceAlias, setSourceAlias] = useState(initial?.sourceAlias ?? '');
  const [sourceColumn, setSourceColumn] = useState(initial?.sourceColumn ?? '');
  const [sourceRow, setSourceRow] = useState(String(initial?.sourceRow ?? 0));
  const [sourceRowMode, setSourceRowMode] = useState<TestVariableSourceRowMode>(initial?.sourceRowMode ?? 'fixed');
  const [staticValue, setStaticValue] = useState(initial?.staticValue ?? '');
  const [expectedValue, setExpectedValue] = useState(initial?.expectedValue ?? '');
  const [assertEnabled, setAssertEnabled] = useState(initial?.assertEnabled ?? false);
  const [assertSeverity, setAssertSeverity] = useState<'fail' | 'warn'>(initial?.assertSeverity ?? 'fail');
  const [submitting, setSubmitting] = useState(false);
  // Stop auto-suggesting a name once the user types one. Reset on dialog
  // re-open so a new variable starts auto-filling again from alias+column.
  const nameTouchedRef = useRef<boolean>(!!initial?.name);

  // Reset form when re-opened with a different `initial`
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setMode(forcedMode ?? initial?.mode ?? 'extract');
    setTargetSelector(initial?.targetSelector ?? '');
    setAttribute(initial?.attribute ?? 'value');
    setSourceType(initial?.sourceType ?? 'static');
    setSourceAlias(initial?.sourceAlias ?? '');
    setSourceColumn(initial?.sourceColumn ?? '');
    setSourceRow(String(initial?.sourceRow ?? 0));
    setSourceRowMode(initial?.sourceRowMode ?? 'fixed');
    setStaticValue(initial?.staticValue ?? '');
    setExpectedValue(initial?.expectedValue ?? '');
    setAssertEnabled(initial?.assertEnabled ?? false);
    setAssertSeverity(initial?.assertSeverity ?? 'fail');
    nameTouchedRef.current = !!initial?.name;
  }, [open, initial, forcedMode]);

  const aliasOptions = useMemo(() => {
    if (sourceType === 'gsheet') return sheetSources.map(s => ({ alias: s.alias, label: `${s.alias} — ${s.spreadsheetName}` }));
    if (sourceType === 'csv') return csvSources.map(s => ({ alias: s.alias, label: `${s.alias} — ${s.filename}` }));
    return [];
  }, [sourceType, sheetSources, csvSources]);

  const columnOptions = useMemo(() => {
    if (sourceType === 'gsheet') return sheetSources.find(s => s.alias === sourceAlias)?.cachedHeaders ?? [];
    if (sourceType === 'csv') return csvSources.find(s => s.alias === sourceAlias)?.cachedHeaders ?? [];
    return [];
  }, [sourceType, sourceAlias, sheetSources, csvSources]);

  // Auto-suggest a name from alias+column for CSV/Sheet assign vars, until
  // the user starts typing one themselves.
  useEffect(() => {
    if (mode !== 'assign') return;
    if (sourceType !== 'csv' && sourceType !== 'gsheet') return;
    if (nameTouchedRef.current) return;
    if (!sourceAlias || !sourceColumn) return;
    setName(suggestName(sourceAlias, sourceColumn));
  }, [mode, sourceType, sourceAlias, sourceColumn]);

  const nameError = (() => {
    if (!name) return 'Name required';
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) return 'Letters, digits, underscore, hyphen — must start with a letter';
    if (takenNames.filter(n => n !== initial?.name).includes(name)) return 'Name already taken';
    return null;
  })();

  const formError = (() => {
    if (nameError) return nameError;
    if (mode === 'extract' && !targetSelector) return 'targetSelector is required for extract mode';
    if (mode === 'assign') {
      if (sourceType === 'static' && staticValue === '') return 'Static value is required';
      if ((sourceType === 'gsheet' || sourceType === 'csv') && (!sourceAlias || !sourceColumn)) {
        return 'Source alias and column are required';
      }
    }
    return null;
  })();

  const handleSave = async () => {
    if (formError) return;
    const id = initial?.id || genId();
    const v: TestVariable = {
      id,
      name,
      mode,
      ...(mode === 'extract'
        ? {
            targetSelector,
            attribute,
            expectedValue: expectedValue || undefined,
            assertEnabled,
            assertSeverity,
          }
        : {
            sourceType,
            ...(sourceType === 'static' ? { staticValue } : {}),
            ...((sourceType === 'gsheet' || sourceType === 'csv')
              ? {
                  sourceAlias,
                  sourceColumn,
                  sourceRowMode,
                  // Only persist sourceRow when 'fixed' — for increment/random
                  // the value is picked at run time and stored on the test.
                  ...(sourceRowMode === 'fixed' ? { sourceRow: parseInt(sourceRow, 10) || 0 } : {}),
                  staticValue: staticValue || undefined,
                }
              : {}),
          }),
    };
    setSubmitting(true);
    try {
      await onSave(v);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const renderNameField = () => (
    <div className="space-y-1.5">
      <Label htmlFor="var-name">Name</Label>
      <Input
        id="var-name"
        value={name}
        onChange={e => {
          nameTouchedRef.current = true;
          setName(e.target.value);
        }}
        placeholder={mode === 'assign' && (sourceType === 'csv' || sourceType === 'gsheet')
          ? 'Auto-fills from alias + column'
          : 'email'}
      />
      {nameError && <p className="text-xs text-destructive">{nameError}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Edit variable' : 'New variable'}</DialogTitle>
          <DialogDescription>
            Variables bind values to page fields. Reference assign-mode vars in test code as <code>{'{{var:name}}'}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!forcedMode && (
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={v => setMode(v as 'extract' | 'assign')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="assign">Assign — push value into a field via {'{{var:name}}'}</SelectItem>
                  <SelectItem value="extract">Extract — read value from a field after the test runs</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === 'assign' && (
            <>
              <div className="space-y-1.5">
                <Label>Source</Label>
                <Select value={sourceType} onValueChange={v => setSourceType(v as 'gsheet' | 'csv' | 'static')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="static">Static value</SelectItem>
                    <SelectItem value="gsheet" disabled={sheetSources.length === 0}>
                      Google Sheet column {sheetSources.length === 0 && '(no sources connected)'}
                    </SelectItem>
                    <SelectItem value="csv" disabled={csvSources.length === 0}>
                      CSV column {csvSources.length === 0 && '(no CSVs uploaded)'}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {sourceType === 'static' && (
                <div className="space-y-1.5">
                  <Label htmlFor="var-static">Value</Label>
                  <Input id="var-static" value={staticValue} onChange={e => setStaticValue(e.target.value)} />
                </div>
              )}

              {(sourceType === 'gsheet' || sourceType === 'csv') && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label>Alias</Label>
                      <Select value={sourceAlias} onValueChange={setSourceAlias}>
                        <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                        <SelectContent>
                          {aliasOptions.map(o => <SelectItem key={o.alias} value={o.alias}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Column</Label>
                      <Select value={sourceColumn} onValueChange={setSourceColumn} disabled={!sourceAlias}>
                        <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                        <SelectContent>
                          {columnOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label>Row strategy</Label>
                      <Select
                        value={sourceRowMode}
                        onValueChange={v => setSourceRowMode(v as TestVariableSourceRowMode)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">Fixed row</SelectItem>
                          <SelectItem value="increment">Increment per run</SelectItem>
                          <SelectItem value="random">Random per run</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {sourceRowMode === 'fixed' ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="var-row">Row</Label>
                        <Input
                          id="var-row"
                          type="number"
                          min={0}
                          value={sourceRow}
                          onChange={e => setSourceRow(e.target.value)}
                        />
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground">Row</Label>
                        <p className="text-xs text-muted-foreground pt-2">
                          {sourceRowMode === 'random'
                            ? 'Picked at random each run.'
                            : 'Walks forward across runs; wraps to row 2 after the last row.'}
                        </p>
                      </div>
                    )}
                  </div>

                  {renderNameField()}
                </>
              )}

              {sourceType === 'static' && renderNameField()}
            </>
          )}

          {mode === 'extract' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="var-selector">Target selector</Label>
                <Input
                  id="var-selector"
                  value={targetSelector}
                  onChange={e => setTargetSelector(e.target.value)}
                  placeholder="#email or h1.welcome"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Attribute to read</Label>
                <Select value={attribute} onValueChange={v => setAttribute(v as TestVariable['attribute'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="value">value (form fields)</SelectItem>
                    <SelectItem value="textContent">textContent</SelectItem>
                    <SelectItem value="innerText">innerText</SelectItem>
                    <SelectItem value="innerHTML">innerHTML</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {renderNameField()}

              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="var-assert" className="cursor-pointer">Eotest assertion</Label>
                  <Switch id="var-assert" checked={assertEnabled} onCheckedChange={setAssertEnabled} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Compare the extracted value to an expected value after the test runs.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="var-expected">Expected value</Label>
                    <Input
                      id="var-expected"
                      value={expectedValue}
                      onChange={e => setExpectedValue(e.target.value)}
                      disabled={!assertEnabled}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Severity</Label>
                    <Select
                      value={assertSeverity}
                      onValueChange={v => setAssertSeverity(v as 'fail' | 'warn')}
                      disabled={!assertEnabled}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fail">fail</SelectItem>
                        <SelectItem value="warn">warn</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </>
          )}

          {formError && !nameError && (
            <p className="text-xs text-destructive">{formError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!!formError || submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
