'use client';

import { useState, useTransition, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { clearPromptLogs } from '@/server/actions/ai-logs';
import type { AIPromptLog } from '@/lib/db/schema';
import {
  Loader2,
  Trash2,
  Download,
  FileText,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';

interface AILogsCardProps {
  logs: AIPromptLog[];
  repositoryId?: string | null;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  create_test: 'Create Test',
  fix_test: 'Fix Test',
  enhance_test: 'Enhance Test',
  scan_routes: 'Scan Routes',
  test_connection: 'Test Connection',
};

function formatTimeAgo(date: Date | null): string {
  if (!date) return '-';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

const PAGE_SIZE = 10;

export function AILogsCard({ logs, repositoryId }: AILogsCardProps) {
  const [isPending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => { queueMicrotask(() => setCurrentPage(0)); }, [logs.length]);

  const totalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  const paginatedLogs = logs.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleClear = () => {
    startTransition(async () => {
      await clearPromptLogs(repositoryId);
      toast.success('AI logs cleared');
    });
  };

  const handleExport = () => {
    const data = JSON.stringify(logs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-logs-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Logs exported');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          AI Prompt Logs
        </CardTitle>
        <CardDescription>
          View prompts and responses from AI operations for debugging
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={logs.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={isPending || logs.length === 0}
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-2" />
            )}
            Clear Logs
          </Button>
        </div>

        {logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No AI logs yet. Logs will appear here when you use AI features.
          </div>
        ) : (
          <>
          <div className="border rounded-lg overflow-hidden divide-y">
            {paginatedLogs.map((log) => (
              <div key={log.id}>
                {/* Row Header */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleExpand(log.id)}
                >
                  <div className="flex-shrink-0">
                    {expandedId === log.id ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>

                  <Badge variant="outline" className="flex-shrink-0">
                    {ACTION_TYPE_LABELS[log.actionType] || log.actionType}
                  </Badge>

                  <span className="text-sm text-muted-foreground flex-shrink-0">
                    {log.provider}
                    {log.model && (
                      <span className="text-xs ml-1">({log.model.split('/').pop()})</span>
                    )}
                  </span>

                  <div className="flex-1" />

                  {log.status === 'success' ? (
                    <Badge variant="default" className="bg-green-600 flex-shrink-0">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Success
                    </Badge>
                  ) : log.status === 'pending' ? (
                    <Badge variant="secondary" className="flex-shrink-0">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Pending
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="flex-shrink-0">
                      <XCircle className="w-3 h-3 mr-1" />
                      Error
                    </Badge>
                  )}

                  {log.durationMs && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground flex-shrink-0">
                      <Clock className="w-3 h-3" />
                      {(log.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}

                  <span className="text-sm text-muted-foreground flex-shrink-0">
                    {formatTimeAgo(log.createdAt)}
                  </span>
                </div>

                {/* Expanded Content */}
                {expandedId === log.id && (
                  <div className="p-4 bg-muted/30 border-t space-y-4">
                    {log.systemPrompt && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                          System Prompt
                        </h4>
                        <pre className="text-xs bg-background p-2 rounded border overflow-auto max-h-32 whitespace-pre-wrap">
                          {log.systemPrompt}
                        </pre>
                      </div>
                    )}
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                        User Prompt
                      </h4>
                      <pre className="text-xs bg-background p-2 rounded border overflow-auto max-h-48 whitespace-pre-wrap">
                        {log.userPrompt}
                      </pre>
                    </div>
                    {log.response && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                          Response
                        </h4>
                        <pre className="text-xs bg-background p-2 rounded border overflow-auto max-h-48 whitespace-pre-wrap">
                          {log.response.substring(0, 2000)}
                          {log.response.length > 2000 && '...'}
                        </pre>
                      </div>
                    )}
                    {log.errorMessage && (
                      <div>
                        <h4 className="text-xs font-semibold text-red-600 mb-1">
                          Error
                        </h4>
                        <pre className="text-xs bg-red-50 text-red-600 p-2 rounded border border-red-200 overflow-auto max-h-32 whitespace-pre-wrap">
                          {log.errorMessage}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-muted-foreground">
                {currentPage * PAGE_SIZE + 1}-{Math.min((currentPage + 1) * PAGE_SIZE, logs.length)} of {logs.length}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setCurrentPage((p) => p - 1); setExpandedId(null); }}
                  disabled={currentPage === 0}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm px-2">
                  {currentPage + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setCurrentPage((p) => p + 1); setExpandedId(null); }}
                  disabled={currentPage >= totalPages - 1}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
