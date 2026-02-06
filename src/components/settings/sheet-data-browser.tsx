'use client';

import { useState, useEffect } from 'react';
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
import { Loader2, FileSpreadsheet, ChevronRight, ArrowLeft, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  listAvailableSpreadsheets,
  getSpreadsheetDetails,
  previewSheetData,
  importSheetDataSource,
} from '@/server/actions/google-sheets';

type Step = 'list' | 'sheets' | 'preview' | 'import';

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

interface SheetTab {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

interface SheetData {
  headers: string[];
  rows: string[][];
}

interface SheetDataBrowserProps {
  repositoryId: string;
  open: boolean;
  onClose: () => void;
}

export function SheetDataBrowser({ repositoryId, open, onClose }: SheetDataBrowserProps) {
  const [step, setStep] = useState<Step>('list');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  // Data
  const [spreadsheets, setSpreadsheets] = useState<DriveFile[]>([]);
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<DriveFile | null>(null);
  const [sheets, setSheets] = useState<SheetTab[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<SheetTab | null>(null);
  const [previewData, setPreviewData] = useState<SheetData | null>(null);
  const [alias, setAlias] = useState('');

  useEffect(() => {
    if (open) {
      loadSpreadsheets();
    }
  }, [open]);

  const loadSpreadsheets = async () => {
    setLoading(true);
    try {
      const result = await listAvailableSpreadsheets();
      if (result.success && result.spreadsheets) {
        setSpreadsheets(result.spreadsheets);
      } else {
        toast.error(result.error || 'Failed to load spreadsheets');
      }
    } catch {
      toast.error('Failed to load spreadsheets');
    } finally {
      setLoading(false);
    }
  };

  const selectSpreadsheet = async (file: DriveFile) => {
    setSelectedSpreadsheet(file);
    setLoading(true);
    try {
      const result = await getSpreadsheetDetails(file.id);
      if (result.success && result.info) {
        setSheets(result.info.sheets);
        setStep('sheets');
      } else {
        toast.error(result.error || 'Failed to load sheets');
      }
    } catch {
      toast.error('Failed to load sheet details');
    } finally {
      setLoading(false);
    }
  };

  const selectSheet = async (sheet: SheetTab) => {
    setSelectedSheet(sheet);
    setLoading(true);
    try {
      const result = await previewSheetData(selectedSpreadsheet!.id, sheet.title, 10);
      if (result.success && result.data) {
        setPreviewData(result.data);
        // Auto-generate alias from sheet name
        const autoAlias = sheet.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');
        setAlias(autoAlias);
        setStep('preview');
      } else {
        toast.error(result.error || 'Failed to preview data');
      }
    } catch {
      toast.error('Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!alias.trim()) {
      toast.error('Please enter an alias');
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(alias)) {
      toast.error('Alias must start with a letter and contain only lowercase letters, numbers, and underscores');
      return;
    }

    setImporting(true);
    try {
      const result = await importSheetDataSource({
        repositoryId,
        spreadsheetId: selectedSpreadsheet!.id,
        spreadsheetName: selectedSpreadsheet!.name,
        sheetName: selectedSheet!.title,
        sheetGid: selectedSheet!.sheetId,
        alias: alias.trim(),
      });

      if (result.success) {
        toast.success('Sheet imported successfully');
        onClose();
      } else {
        toast.error(result.error || 'Failed to import');
      }
    } catch {
      toast.error('Failed to import sheet');
    } finally {
      setImporting(false);
    }
  };

  const goBack = () => {
    if (step === 'sheets') {
      setStep('list');
      setSelectedSpreadsheet(null);
    } else if (step === 'preview') {
      setStep('sheets');
      setSelectedSheet(null);
      setPreviewData(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step !== 'list' && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={goBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Table2 className="w-5 h-5" />
            {step === 'list' && 'Select a Spreadsheet'}
            {step === 'sheets' && `${selectedSpreadsheet?.name} — Select Sheet`}
            {step === 'preview' && `Preview: ${selectedSheet?.title}`}
          </DialogTitle>
          <DialogDescription>
            {step === 'list' && 'Choose a Google Sheets spreadsheet to import data from'}
            {step === 'sheets' && 'Select which sheet/tab contains your test data'}
            {step === 'preview' && 'Review the data and set an alias for use in test scripts'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Step 1: Spreadsheet List */}
              {step === 'list' && (
                <div className="space-y-1">
                  {spreadsheets.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p>No spreadsheets found in your Google Drive</p>
                    </div>
                  ) : (
                    spreadsheets.map((file) => (
                      <button
                        key={file.id}
                        onClick={() => selectSpreadsheet(file)}
                        className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <FileSpreadsheet className="h-5 w-5 text-green-600 flex-shrink-0" />
                          <div>
                            <div className="text-sm font-medium">{file.name}</div>
                            <div className="text-xs text-muted-foreground">
                              Modified {new Date(file.modifiedTime).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Step 2: Sheet/Tab Selection */}
              {step === 'sheets' && (
                <div className="space-y-1">
                  {sheets.map((sheet) => (
                    <button
                      key={sheet.sheetId}
                      onClick={() => selectSheet(sheet)}
                      className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <Table2 className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-medium">{sheet.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {sheet.rowCount} rows &times; {sheet.columnCount} columns
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}

              {/* Step 3: Preview + Import */}
              {step === 'preview' && previewData && (
                <div className="space-y-4">
                  {/* Alias Input */}
                  <div className="space-y-2">
                    <Label htmlFor="alias">Data Source Alias</Label>
                    <Input
                      id="alias"
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                      placeholder="e.g. users, products, test_data"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use this alias in test code: <code className="bg-muted px-1 rounded">{'{{'}sheet:{alias || 'alias'}.columnName[0]{'}}'}</code>
                    </p>
                  </div>

                  {/* Data Preview Table */}
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b">
                      Preview ({previewData.rows.length} rows shown)
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="px-2 py-1.5 text-left text-muted-foreground font-medium w-8">#</th>
                            {previewData.headers.map((h, i) => (
                              <th key={i} className="px-2 py-1.5 text-left font-medium">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.rows.slice(0, 8).map((row, ri) => (
                            <tr key={ri} className="border-b last:border-b-0 hover:bg-muted/20">
                              <td className="px-2 py-1.5 text-muted-foreground">{ri}</td>
                              {previewData.headers.map((_, ci) => (
                                <td key={ci} className="px-2 py-1.5 max-w-[200px] truncate">
                                  {row[ci] || ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Reference Examples */}
                  <div className="bg-muted/30 border rounded-lg p-3 space-y-2">
                    <div className="text-xs font-medium">Usage examples in test code:</div>
                    <div className="space-y-1 font-mono text-xs">
                      {previewData.headers.slice(0, 3).map((h, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <code className="bg-muted px-1.5 py-0.5 rounded text-blue-600">
                            {'{{'}sheet:{alias || 'alias'}.{h}[0]{'}}'}
                          </code>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-green-600">
                            &quot;{previewData.rows[0]?.[i] || ''}&quot;
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-1.5 py-0.5 rounded text-blue-600">
                          {'{{'}sheet:{alias || 'alias'}.row[0]{'}}'}
                        </code>
                        <span className="text-muted-foreground">→ entire row as JSON</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {step === 'preview' && (
          <DialogFooter>
            <Button variant="outline" onClick={goBack}>
              Back
            </Button>
            <Button onClick={handleImport} disabled={importing || !alias.trim()}>
              {importing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Import Data Source
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
