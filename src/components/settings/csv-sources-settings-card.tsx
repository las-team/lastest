'use client';

import { useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet, RefreshCw, Trash2, Plus, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { CsvDataBrowser } from './csv-data-browser';
import { cn } from '@/lib/utils';
import type { CsvDataSource } from '@/lib/db/schema';

interface CsvSourcesSettingsCardProps {
  dataSources: CsvDataSource[];
  repositoryId?: string | null;
  /** When provided, called instead of `router.refresh()` after upload / sync /
   *  delete. The test-detail panel hydrates from a client server-action, so a
   *  hard `router.refresh()` won't update its cached `csvDataSources` — the
   *  caller must refetch through this hook. Falls back to `router.refresh()`. */
  onRefresh?: () => Promise<void> | void;
}

export function CsvSourcesSettingsCard({ dataSources, repositoryId, onRefresh }: CsvSourcesSettingsCardProps) {
  const router = useRouter();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePickedFile = (f: File | null | undefined) => {
    if (!f) return;
    setPendingFile(f);
    setBrowserOpen(true);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (!repositoryId) return;
    handlePickedFile(e.dataTransfer.files?.[0]);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!repositoryId) return;
    if (!dragActive) setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const refresh = async () => {
    if (onRefresh) await onRefresh();
    else router.refresh();
  };

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      const { syncCsvSource } = await import('@/server/actions/csv-sources');
      const res = await syncCsvSource(id);
      if (res.success) {
        toast.success('CSV reloaded from disk');
        await refresh();
      } else {
        toast.error(res.error || 'Sync failed');
      }
    } finally {
      setSyncingId(null);
    }
  };

  const handleDelete = async (id: string, alias: string) => {
    if (!confirm(`Delete CSV source "${alias}"? Test references that use it will start failing.`)) return;
    setDeletingId(id);
    try {
      const { deleteCsvSource } = await import('@/server/actions/csv-sources');
      await deleteCsvSource(id);
      toast.success('CSV source deleted');
      await refresh();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4" />
              CSV data sources
            </CardTitle>
            <CardDescription>
              Upload CSV files for data-driven tests. Reference columns from test code via <code>{'{{csv:alias.column[row]}}'}</code> or bind them to variables on the Vars tab.
            </CardDescription>
          </div>
          {repositoryId && (
            <Button size="sm" onClick={() => fileInputRef.current?.click()}>
              <Plus className="h-4 w-4 mr-1.5" />
              Upload CSV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!repositoryId ? (
          <p className="text-sm text-muted-foreground">Select a repository to manage CSV sources.</p>
        ) : (
          <>
            <div
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                'flex flex-col items-center justify-center gap-1.5 px-4 py-6 rounded-md border-2 border-dashed transition-colors text-center',
                dragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-muted/20',
              )}
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-medium">
                {dragActive ? 'Drop CSV here' : 'Drag & drop a CSV file here'}
              </p>
              <p className="text-xs text-muted-foreground">
                Up to 10 MB, must include a header row
              </p>
            </div>

            {dataSources.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center">No CSV sources yet.</p>
            ) : (
              <div className="space-y-2">
                {dataSources.map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-2 border rounded-md px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{s.alias}</span>
                        <Badge variant="outline" className="text-xs">{s.rowCount} rows</Badge>
                        <Badge variant="outline" className="text-xs">{(s.cachedHeaders ?? []).length} cols</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {s.filename}
                        {s.lastSyncedAt && ` • synced ${new Date(s.lastSyncedAt).toLocaleString()}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleSync(s.id)}
                        disabled={syncingId === s.id}
                        aria-label="Resync"
                      >
                        {syncingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(s.id, s.alias)}
                        disabled={deletingId === s.id}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>

      {repositoryId && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              handlePickedFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <CsvDataBrowser
            open={browserOpen}
            onOpenChange={(o) => {
              setBrowserOpen(o);
              if (!o) setPendingFile(null);
            }}
            repositoryId={repositoryId}
            initialFile={pendingFile}
            onUploaded={() => { void refresh(); }}
          />
        </>
      )}
    </Card>
  );
}
