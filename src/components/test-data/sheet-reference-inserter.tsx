'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table2, Copy, Check } from 'lucide-react';
import type { GoogleSheetsDataSource } from '@/lib/db/schema';

interface SheetReferenceInserterProps {
  dataSources: GoogleSheetsDataSource[];
  onInsert: (reference: string) => void;
}

/**
 * Dialog that helps users build and insert {{sheet:...}} references.
 * Provides a visual builder with live preview of the resolved value.
 */
export function SheetReferenceInserter({ dataSources, onInsert }: SheetReferenceInserterProps) {
  const [open, setOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<GoogleSheetsDataSource | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [rowIndex, setRowIndex] = useState<string>('0');
  const [refType, setRefType] = useState<'cell' | 'row' | 'column'>('cell');
  const [copied, setCopied] = useState(false);

  if (dataSources.length === 0) return null;

  const headers = selectedSource?.cachedHeaders || [];
  const data = selectedSource?.cachedData || [];

  const buildReference = (): string => {
    if (!selectedSource) return '';
    const alias = selectedSource.alias;

    if (refType === 'row') {
      return `{{sheet:${alias}.row[${rowIndex}]}}`;
    }
    if (refType === 'column' && selectedColumn) {
      return `{{sheet:${alias}.${selectedColumn}}}`;
    }
    if (refType === 'cell' && selectedColumn) {
      return `{{sheet:${alias}.${selectedColumn}[${rowIndex}]}}`;
    }
    return '';
  };

  const getPreviewValue = (): string => {
    if (!selectedSource || !data.length) return '';
    const ri = parseInt(rowIndex, 10) || 0;

    if (refType === 'row') {
      if (ri >= data.length) return '(out of range)';
      const row = data[ri];
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return JSON.stringify(obj);
    }

    if (!selectedColumn) return '';
    const colIdx = headers.findIndex(h => h === selectedColumn);
    if (colIdx === -1) return '(column not found)';

    if (refType === 'column') {
      return JSON.stringify(data.slice(0, 5).map(r => r[colIdx] || ''));
    }

    if (ri >= data.length) return '(out of range)';
    return data[ri]?.[colIdx] || '';
  };

  const reference = buildReference();
  const preview = getPreviewValue();

  const handleInsert = () => {
    if (reference) {
      onInsert(reference);
      setOpen(false);
    }
  };

  const handleCopy = () => {
    if (reference) {
      navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <Table2 className="h-3 w-3" />
          Insert Data
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Table2 className="h-4 w-4" />
            Insert Sheet Data Reference
          </DialogTitle>
          <DialogDescription>
            Select a data source, column, and row to generate a reference
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Data Source Selection */}
          <div className="space-y-2">
            <Label className="text-xs">Data Source</Label>
            <div className="flex flex-wrap gap-1.5">
              {dataSources.map((ds) => (
                <button
                  key={ds.id}
                  onClick={() => {
                    setSelectedSource(ds);
                    setSelectedColumn(null);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                    selectedSource?.id === ds.id
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'hover:bg-muted'
                  }`}
                >
                  <span className="font-mono font-medium">{ds.alias}</span>
                  <span className="text-muted-foreground ml-1">({ds.sheetName})</span>
                </button>
              ))}
            </div>
          </div>

          {selectedSource && (
            <>
              {/* Reference Type */}
              <div className="space-y-2">
                <Label className="text-xs">Reference Type</Label>
                <div className="flex gap-1.5">
                  {[
                    { value: 'cell' as const, label: 'Single Cell', desc: 'One value from a column and row' },
                    { value: 'row' as const, label: 'Entire Row', desc: 'All columns from one row' },
                    { value: 'column' as const, label: 'All Column Values', desc: 'Array of all values' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setRefType(opt.value)}
                      className={`flex-1 px-2 py-1.5 rounded-md text-xs border transition-colors text-center ${
                        refType === opt.value
                          ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : 'hover:bg-muted'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Column Selection */}
              {refType !== 'row' && headers.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs">Column</Label>
                  <div className="flex flex-wrap gap-1">
                    {headers.map((h) => (
                      <button
                        key={h}
                        onClick={() => setSelectedColumn(h)}
                        className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                          selectedColumn === h
                            ? 'bg-green-50 border-green-300 text-green-700'
                            : 'hover:bg-muted'
                        }`}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Row Index */}
              {refType !== 'column' && (
                <div className="space-y-2">
                  <Label className="text-xs">Row Index (0-based, {data.length} rows available)</Label>
                  <Input
                    type="number"
                    min="0"
                    max={data.length - 1}
                    value={rowIndex}
                    onChange={(e) => setRowIndex(e.target.value)}
                    className="w-24 h-7 text-xs"
                  />
                </div>
              )}

              {/* Generated Reference + Preview */}
              {reference && (
                <div className="space-y-2 bg-muted/30 border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Generated Reference</Label>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={handleCopy}>
                      {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <code className="block font-mono text-sm text-blue-600 bg-muted px-2 py-1.5 rounded">
                    {reference}
                  </code>

                  {preview && (
                    <div className="mt-2">
                      <div className="text-[10px] text-muted-foreground mb-1">Resolves to:</div>
                      <div className="font-mono text-xs text-green-700 bg-green-50 px-2 py-1.5 rounded border border-green-100 break-all max-h-24 overflow-auto">
                        {preview.length > 200 ? `${preview.slice(0, 200)}...` : preview}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleInsert} disabled={!reference}>
            Insert Reference
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
