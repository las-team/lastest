'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Table2, AlertCircle, ArrowRight } from 'lucide-react';
import { previewSheetReferences } from '@/lib/google-sheets/resolver';
import type { GoogleSheetsDataSource } from '@/lib/db/schema';

interface SheetDataPreviewProps {
  code: string;
  dataSources: GoogleSheetsDataSource[];
}

/**
 * Visual component that shows exactly what sample data will be resolved
 * when {{sheet:...}} references appear in test code.
 * Renders inline below the code editor.
 */
export function SheetDataPreview({ code, dataSources }: SheetDataPreviewProps) {
  const previews = useMemo(() => {
    if (!code || dataSources.length === 0) return [];
    return previewSheetReferences(code, dataSources);
  }, [code, dataSources]);

  if (previews.length === 0) return null;

  // Group by alias for cleaner display
  const byAlias = new Map<string, typeof previews>();
  for (const p of previews) {
    const list = byAlias.get(p.alias) || [];
    list.push(p);
    byAlias.set(p.alias, list);
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      <div className="bg-muted/50 px-3 py-1.5 border-b flex items-center gap-2">
        <Table2 className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-medium">Sheet Data References</span>
        <Badge variant="secondary" className="text-[10px] h-4">
          {previews.length} ref{previews.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      <div className="divide-y">
        {[...byAlias.entries()].map(([alias, refs]) => {
          const source = refs[0]?.source;
          return (
            <div key={alias} className="p-3 space-y-2">
              {/* Data source header */}
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {alias}
                </Badge>
                {source && (
                  <span className="text-[10px] text-muted-foreground">
                    {source.spreadsheetName} / {source.sheetName}
                  </span>
                )}
              </div>

              {/* Reference resolutions */}
              <div className="space-y-1.5">
                {refs.map((ref, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${
                      ref.error
                        ? 'bg-red-50 border border-red-100'
                        : 'bg-muted/30'
                    }`}
                  >
                    {/* Reference expression */}
                    <code className="font-mono text-blue-600 flex-shrink-0 whitespace-nowrap">
                      {ref.fullMatch}
                    </code>

                    <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />

                    {/* Resolved value or error */}
                    {ref.error ? (
                      <div className="flex items-center gap-1 text-red-600">
                        <AlertCircle className="h-3 w-3 flex-shrink-0" />
                        <span>{ref.error}</span>
                      </div>
                    ) : (
                      <span className="text-green-700 font-mono break-all">
                        {ref.previewValue && ref.previewValue.length > 80
                          ? `${ref.previewValue.slice(0, 80)}...`
                          : ref.previewValue}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Sample data table for this source */}
              {source && source.sampleData.length > 0 && (
                <details className="group">
                  <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                    Show sample data ({source.headers.length} columns, {source.sampleData.length} rows)
                  </summary>
                  <div className="mt-1.5 overflow-x-auto border rounded">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="bg-muted/40 border-b">
                          <th className="px-1.5 py-1 text-left text-muted-foreground w-6">#</th>
                          {source.headers.map((h, hi) => (
                            <th key={hi} className="px-1.5 py-1 text-left font-medium">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {source.sampleData.map((row, ri) => (
                          <tr key={ri} className="border-b last:border-b-0">
                            <td className="px-1.5 py-0.5 text-muted-foreground">{ri}</td>
                            {source.headers.map((_, ci) => (
                              <td key={ci} className="px-1.5 py-0.5 max-w-[120px] truncate font-mono">
                                {row[ci] || ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
