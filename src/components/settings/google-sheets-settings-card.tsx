'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, RefreshCw, Trash2, Plus, Table2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { disconnectGoogleSheets, deleteDataSource, syncDataSource } from '@/server/actions/google-sheets';
import { useRouter } from 'next/navigation';
import { SheetDataBrowser } from './sheet-data-browser';

interface DataSource {
  id: string;
  spreadsheetName: string;
  sheetName: string;
  alias: string;
  cachedHeaders: string[] | null;
  cachedData: string[][] | null;
  lastSyncedAt: Date | null;
}

interface GoogleSheetsSettingsCardProps {
  account: {
    id: string;
    googleEmail: string;
    googleName: string | null;
  } | null;
  dataSources: DataSource[];
  repositoryId?: string | null;
}

export function GoogleSheetsSettingsCard({
  account,
  dataSources,
  repositoryId,
}: GoogleSheetsSettingsCardProps) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Google Sheets? All imported data sources will be removed.')) return;
    setIsDisconnecting(true);
    try {
      await disconnectGoogleSheets();
      toast.success('Google Sheets disconnected');
      router.refresh();
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      const result = await syncDataSource(id);
      if (result.success) {
        toast.success('Data refreshed');
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to sync');
      }
    } catch {
      toast.error('Failed to sync');
    } finally {
      setSyncingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this data source?')) return;
    setDeletingId(id);
    try {
      await deleteDataSource(id);
      toast.success('Data source removed');
      router.refresh();
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Table2 className="w-5 h-5" />
            Google Sheets Test Data
          </CardTitle>
          <CardDescription>
            Import spreadsheet data to use as test data references in your tests
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Connection Status */}
          {account ? (
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-200 flex items-center justify-center">
                  <Sheet className="w-4 h-4 text-green-700" />
                </div>
                <div>
                  <div className="font-medium text-sm">{account.googleEmail}</div>
                  <div className="text-xs text-muted-foreground">Google Sheets connected</div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Connect your Google account to import spreadsheet data for test scripts.
                This allows you to reference cells, columns, and rows from Google Sheets
                directly in your test code.
              </p>
              <a
                href="/api/auth/google-sheets"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                <Sheet className="w-4 h-4" />
                Connect Google Sheets
              </a>
            </div>
          )}

          {/* Data Sources List */}
          {account && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Imported Data Sources</h4>
                {repositoryId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowBrowser(true)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Import Sheet
                  </Button>
                )}
              </div>

              {dataSources.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground border rounded-lg border-dashed">
                  <Table2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No data sources imported yet</p>
                  <p className="text-xs mt-1">
                    Import a Google Sheet to use its data in test scripts
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {dataSources.map((ds) => (
                    <div
                      key={ds.id}
                      className="border rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="font-mono text-xs">
                            {ds.alias}
                          </Badge>
                          <span className="text-sm">{ds.spreadsheetName}</span>
                          <span className="text-xs text-muted-foreground">
                            / {ds.sheetName}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleSync(ds.id)}
                            disabled={syncingId === ds.id}
                          >
                            {syncingId === ds.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                            onClick={() => handleDelete(ds.id)}
                            disabled={deletingId === ds.id}
                          >
                            {deletingId === ds.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Preview headers and row count */}
                      {ds.cachedHeaders && ds.cachedHeaders.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium">Columns:</span>{' '}
                          {ds.cachedHeaders.slice(0, 6).join(', ')}
                          {ds.cachedHeaders.length > 6 && ` +${ds.cachedHeaders.length - 6} more`}
                          {' '}&middot;{' '}
                          {ds.cachedData?.length || 0} rows
                        </div>
                      )}

                      {/* Usage hint */}
                      <div className="text-xs bg-muted/50 px-2 py-1 rounded font-mono">
                        {'{{'}sheet:{ds.alias}.{ds.cachedHeaders?.[0] || 'column'}[0]{'}}'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sheet Browser Dialog */}
      {showBrowser && repositoryId && (
        <SheetDataBrowser
          repositoryId={repositoryId}
          open={showBrowser}
          onClose={() => {
            setShowBrowser(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
