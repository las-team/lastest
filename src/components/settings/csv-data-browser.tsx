'use client';

import { useEffect, useState } from 'react';
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
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { parseCsv } from '@/lib/csv/api';

export interface CsvDataBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId: string;
  initialFile?: File | null;
  onUploaded?: () => void;
}

const MAX_PREVIEW_ROWS = 10;
const MAX_SIZE = 10 * 1024 * 1024;

export function CsvDataBrowser({ open, onOpenChange, repositoryId, initialFile, onUploaded }: CsvDataBrowserProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][]; total: number } | null>(null);
  const [alias, setAlias] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setAlias('');
    setLoading(false);
  };

  const loadFile = async (f: File) => {
    setLoading(true);
    try {
      const looksCsv = /\.csv$/i.test(f.name) || f.type === 'text/csv' || f.type === 'application/vnd.ms-excel';
      if (!looksCsv) {
        toast.error('Only .csv files are supported');
        onOpenChange(false);
        return;
      }
      if (f.size > MAX_SIZE) {
        toast.error('File exceeds 10MB limit');
        onOpenChange(false);
        return;
      }
      const text = await f.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0) {
        toast.error('CSV has no header row');
        onOpenChange(false);
        return;
      }
      setFile(f);
      setPreview({ headers: parsed.headers, rows: parsed.rows.slice(0, MAX_PREVIEW_ROWS), total: parsed.rowCount });
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      setAlias(base.replace(/^[^a-zA-Z]+/, ''));
    } catch (e) {
      toast.error(`Failed to read CSV: ${e instanceof Error ? e.message : String(e)}`);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && initialFile && initialFile !== file) {
      void loadFile(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  const handleUpload = async () => {
    if (!file || !alias) return;
    setSubmitting(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { uploadCsvSource } = await import('@/server/actions/csv-sources');
      const res = await uploadCsvSource(repositoryId, alias, buf, file.name);
      if (!res.success) {
        toast.error(res.error || 'Upload failed');
        return;
      }
      toast.success(`CSV "${alias}" imported`);
      reset();
      onUploaded?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-3xl lg:max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to use as a test data source. Reference columns from test code via <code>{'{{csv:alias.column[row]}}'}</code> or bind them to variables on the Vars tab.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 flex-1 min-h-0 overflow-auto">
          {file && (
            <div className="flex items-center gap-2 text-sm border rounded-md px-3 py-2 bg-muted/40">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate" title={file.name}>{file.name}</span>
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                {(file.size / 1024).toFixed(1)} KB
              </span>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading CSV…
            </div>
          )}

          {preview && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="csv-alias">Alias</Label>
                <Input
                  id="csv-alias"
                  value={alias}
                  onChange={e => setAlias(e.target.value)}
                  placeholder="users, products, ..."
                />
                <p className="text-xs text-muted-foreground">
                  Letters, digits, underscore, hyphen — must start with a letter. Used as the key in test references.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Preview ({preview.total} row{preview.total === 1 ? '' : 's'} total, showing first {preview.rows.length})</Label>
                <div className="border rounded-md overflow-auto max-h-[55vh]">
                  <table className="text-xs">
                    <thead className="bg-muted sticky top-0 z-10">
                      <tr>
                        {preview.headers.map(h => (
                          <th key={h} className="text-left px-2 py-1 font-medium whitespace-nowrap border-b">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i} className="border-t">
                          {row.map((cell, j) => (
                            <td key={j} className="px-2 py-1 whitespace-nowrap" title={cell}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={!file || !alias || submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Uploading...</> : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
