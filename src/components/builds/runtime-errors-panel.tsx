'use client';

import { useState, useCallback } from 'react';
import { Terminal, Globe, Filter, ChevronDown, ChevronRight, Loader2, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { NetworkRequest, DownloadRecord } from '@/lib/db/schema';

interface RuntimeErrorsPanelProps {
  consoleErrors?: string[] | null;
  networkRequests?: NetworkRequest[] | null;
  networkBodiesPath?: string | null;
  downloads?: DownloadRecord[] | null;
}

/** Strip "Console errors detected: ..." and "Network failures detected: ..." from an errorMessage. */
export function stripRuntimeErrorsFromMessage(errorMessage: string | null | undefined): string | null {
  if (!errorMessage) return null;
  const cleaned = errorMessage
    .split(' | ')
    .filter(part => !part.startsWith('Console errors detected:') && !part.startsWith('Network failures detected:'))
    .join(' | ')
    .trim();
  return cleaned || null;
}

function getStatusTextColor(status: number, failed?: boolean) {
  if (failed) return 'text-red-500';
  if (status >= 400) return 'text-red-500';
  if (status >= 300) return 'text-yellow-500';
  if (status >= 200) return 'text-green-500';
  return 'text-muted-foreground';
}

function getMethodColor(method: string) {
  switch (method.toUpperCase()) {
    case 'GET': return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    case 'POST': return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300';
    case 'PUT': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    case 'PATCH': return 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300';
    case 'DELETE': return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
    default: return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }
}

function truncateUrl(url: string, maxLength = 80): string {
  if (url.length <= maxLength) return url;
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    if (path.length > maxLength - 3) return path.slice(0, maxLength - 3) + '…';
    return path;
  } catch {
    return url.slice(0, maxLength - 3) + '…';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Deduplicate console errors, preserving order and showing counts. */
function dedupeErrors(errors: string[]): { message: string; count: number }[] {
  const map = new Map<string, number>();
  const order: string[] = [];
  for (const err of errors) {
    const existing = map.get(err);
    if (existing !== undefined) {
      map.set(err, existing + 1);
    } else {
      map.set(err, 1);
      order.push(err);
    }
  }
  return order.map(msg => ({ message: msg, count: map.get(msg)! }));
}

function NetworkRequestDetail({ req, index, networkBodiesPath }: { req: NetworkRequest; index: number; networkBodiesPath?: string | null }) {
  // Lazy-load body data from file when bodies aren't inline
  const hasInlineBodies = !!(req.postData || req.responseBody || req.requestHeaders || req.responseHeaders);
  const [bodyData, setBodyData] = useState<NetworkRequest | null>(hasInlineBodies ? req : null);
  const [loadingBodies, setLoadingBodies] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadBodies = useCallback(() => {
    if (hasInlineBodies || !networkBodiesPath || bodyData || loadingBodies) return;
    setLoadingBodies(true);
    fetch(`/api/media${networkBodiesPath}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load')))
      .then((bodies: NetworkRequest[]) => {
        setBodyData(bodies[index] || null);
        setLoadingBodies(false);
      })
      .catch(() => {
        setLoadError(true);
        setLoadingBodies(false);
      });
  }, [hasInlineBodies, networkBodiesPath, bodyData, loadingBodies, index]);

  // Trigger load on first render (component only mounts when expanded)
  if (!hasInlineBodies && networkBodiesPath && !bodyData && !loadingBodies && !loadError) {
    loadBodies();
  }

  const detail = bodyData || req;

  return (
    <div className="px-3 py-2 border-t border-border/30 bg-muted/20 text-xs space-y-2">
      {/* Full URL */}
      <div>
        <span className="font-medium text-muted-foreground">URL</span>
        <p className="font-mono break-all mt-0.5">{req.url}</p>
      </div>

      {/* Error */}
      {req.errorText && (
        <div>
          <span className="font-medium text-red-500">Error</span>
          <p className="font-mono text-red-600 dark:text-red-400 mt-0.5">{req.errorText}</p>
        </div>
      )}

      {/* Timing & Size */}
      <div className="flex gap-6">
        {req.duration > 0 && (
          <div>
            <span className="font-medium text-muted-foreground">Duration</span>
            <p className="font-mono mt-0.5">{req.duration}ms</p>
          </div>
        )}
        {req.responseSize !== undefined && (
          <div>
            <span className="font-medium text-muted-foreground">Size</span>
            <p className="font-mono mt-0.5">{formatBytes(req.responseSize)}</p>
          </div>
        )}
        <div>
          <span className="font-medium text-muted-foreground">Type</span>
          <p className="font-mono mt-0.5">{req.resourceType}</p>
        </div>
      </div>

      {/* Loading indicator for lazy-loaded bodies */}
      {loadingBodies && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Loading request details...</span>
        </div>
      )}

      {loadError && (
        <div className="text-muted-foreground italic">Body data unavailable</div>
      )}

      {/* Post Data */}
      {detail.postData && (
        <div>
          <span className="font-medium text-muted-foreground">Request Body</span>
          <pre className="font-mono bg-muted/50 rounded p-1.5 mt-0.5 max-h-40 overflow-auto break-all whitespace-pre-wrap">
            {tryFormatJson(detail.postData)}
          </pre>
        </div>
      )}

      {/* Response Body */}
      {detail.responseBody && (
        <div>
          <span className="font-medium text-muted-foreground">Response Body</span>
          <pre className="font-mono bg-muted/50 rounded p-1.5 mt-0.5 max-h-48 overflow-auto break-all whitespace-pre-wrap text-[11px]">
            {tryFormatJson(detail.responseBody)}
          </pre>
        </div>
      )}

      {/* Request Headers */}
      {detail.requestHeaders && Object.keys(detail.requestHeaders).length > 0 && (
        <details>
          <summary className="font-medium text-muted-foreground cursor-pointer select-none">
            Request Headers ({Object.keys(detail.requestHeaders).length})
          </summary>
          <div className="font-mono bg-muted/50 rounded p-1.5 mt-0.5 max-h-32 overflow-auto">
            {Object.entries(detail.requestHeaders).map(([k, v]) => (
              <div key={k} className="break-all">
                <span className="text-muted-foreground">{k}:</span> {v}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Response Headers */}
      {detail.responseHeaders && Object.keys(detail.responseHeaders).length > 0 && (
        <details>
          <summary className="font-medium text-muted-foreground cursor-pointer select-none">
            Response Headers ({Object.keys(detail.responseHeaders).length})
          </summary>
          <div className="font-mono bg-muted/50 rounded p-1.5 mt-0.5 max-h-32 overflow-auto">
            {Object.entries(detail.responseHeaders).map(([k, v]) => (
              <div key={k} className="break-all">
                <span className="text-muted-foreground">{k}:</span> {v}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function tryFormatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function NetworkTraceTable({ requests, networkBodiesPath }: { requests: NetworkRequest[]; networkBodiesPath?: string | null }) {
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const errorCount = requests.filter(r => r.status >= 400 || r.failed).length;
  const filtered = errorsOnly ? requests.filter(r => r.status >= 400 || r.failed) : requests;
  const hasErrors = errorCount > 0;

  return (
    <div className="px-2.5 pb-2.5">
      {/* Filter bar */}
      {hasErrors && (
        <button
          onClick={() => { setErrorsOnly(!errorsOnly); setExpandedIdx(null); }}
          className={`flex items-center gap-1.5 text-[10px] px-2 py-1 mb-1 rounded-md transition-colors ${
            errorsOnly
              ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          }`}
        >
          <Filter className="w-3 h-3" />
          {errorsOnly ? `Showing ${errorCount} error${errorCount !== 1 ? 's' : ''}` : `Filter errors (${errorCount})`}
        </button>
      )}

      {/* Table */}
      <div className="max-h-80 overflow-y-auto relative">
        {/* Sticky header with solid background */}
        <div className="flex items-center gap-2 py-1 text-[10px] text-muted-foreground font-medium border-b border-border/50 sticky top-0 z-10 bg-white dark:bg-gray-950">
          <span className="w-3 shrink-0" />
          <span className="w-14 shrink-0">Method</span>
          <span className="w-12 shrink-0 text-right">Status</span>
          <span className="flex-1 min-w-0">URL</span>
          <span className="w-14 shrink-0 text-right">Time</span>
          <span className="w-16 shrink-0">Type</span>
        </div>
        {filtered.map((req, i) => {
          const isError = req.status >= 400 || req.failed;
          const isExpanded = expandedIdx === i;
          return (
            <div key={i}>
              <div
                className={`flex items-center gap-2 py-1 border-b border-border/30 text-xs cursor-pointer hover:bg-muted/40 ${isError ? 'bg-red-500/5' : ''}`}
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
              >
                <span className="w-3 shrink-0 text-muted-foreground">
                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </span>
                <Badge className={`${getMethodColor(req.method)} shrink-0 text-[10px] px-1.5 py-0 font-mono w-14 justify-center`}>
                  {req.method}
                </Badge>
                <span className={`w-12 shrink-0 text-right font-mono text-[11px] ${getStatusTextColor(req.status, req.failed)}`}>
                  {req.failed ? 'ERR' : req.status || '...'}
                </span>
                <span
                  className="flex-1 min-w-0 truncate font-mono text-muted-foreground text-[11px]"
                  title={req.url}
                >
                  {truncateUrl(req.url)}
                </span>
                <span className="w-14 shrink-0 text-right text-muted-foreground text-[10px]">
                  {req.duration > 0 ? `${req.duration}ms` : '—'}
                </span>
                <span className="w-16 shrink-0 truncate text-muted-foreground text-[10px]">
                  {req.resourceType}
                </span>
              </div>
              {isExpanded && <NetworkRequestDetail req={req} index={i} networkBodiesPath={networkBodiesPath} />}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-3 text-center text-xs text-muted-foreground">No matching requests</div>
        )}
      </div>
    </div>
  );
}

function DownloadTraceTable({ downloads }: { downloads: DownloadRecord[] }) {
  return (
    <div className="px-2.5 pb-2.5">
      <div className="max-h-80 overflow-y-auto relative">
        <div className="flex items-center gap-2 py-1 text-[10px] text-muted-foreground font-medium border-b border-border/50 sticky top-0 z-10 bg-white dark:bg-gray-950">
          <span className="flex-1 min-w-0">Filename</span>
          <span className="w-16 shrink-0 text-right">Size</span>
          <span className="w-14 shrink-0 text-right">Time</span>
          <span className="flex-1 min-w-0">URL</span>
        </div>
        {downloads.map((dl, i) => (
          <div key={i} className="flex items-center gap-2 py-1.5 border-b border-border/30 text-xs">
            <span className="flex-1 min-w-0 truncate font-mono text-foreground" title={dl.suggestedFilename}>
              {dl.suggestedFilename}
            </span>
            <span className="w-16 shrink-0 text-right text-muted-foreground text-[10px]">
              {dl.sizeBytes !== undefined ? formatBytes(dl.sizeBytes) : '—'}
            </span>
            <span className="w-14 shrink-0 text-right text-muted-foreground text-[10px]">
              {dl.durationMs ? `${dl.durationMs}ms` : '—'}
            </span>
            <span
              className="flex-1 min-w-0 truncate font-mono text-muted-foreground text-[11px]"
              title={dl.url}
            >
              {dl.url ? truncateUrl(dl.url) : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RuntimeErrorsPanel({ consoleErrors, networkRequests, networkBodiesPath, downloads }: RuntimeErrorsPanelProps) {
  const hasConsole = consoleErrors && consoleErrors.length > 0;
  const hasNetwork = networkRequests && networkRequests.length > 0;
  const hasDownloads = downloads && downloads.length > 0;

  if (!hasConsole && !hasNetwork && !hasDownloads) return null;

  const networkErrors = networkRequests?.filter(r => r.status >= 400 || r.failed) ?? [];
  const hasErrors = networkErrors.length > 0;
  const isFullTrace = hasNetwork && networkRequests!.some(r => r.startTime !== undefined || (r.status >= 200 && r.status < 400));

  return (
    <div className="mt-2 space-y-2">
      {hasConsole && (
        <details className="border border-amber-200 bg-amber-50 rounded-lg dark:border-amber-800 dark:bg-amber-950/30">
          <summary className="flex items-center gap-2 p-2.5 cursor-pointer select-none text-sm">
            <Terminal className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="font-medium text-amber-800 dark:text-amber-200">Console Errors</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              {consoleErrors.length}
            </Badge>
          </summary>
          <div className="px-2.5 pb-2.5 max-h-64 overflow-y-auto space-y-1">
            {dedupeErrors(consoleErrors).map((entry, i) => (
              <div
                key={i}
                className="flex items-start gap-2 p-1.5 rounded bg-amber-100/50 dark:bg-amber-900/30"
              >
                <pre className="font-mono text-xs text-amber-900 dark:text-amber-100 whitespace-pre-wrap break-all flex-1">
                  {entry.message}
                </pre>
                {entry.count > 1 && (
                  <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                    x{entry.count}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Network Errors section — old-format data (failures only) */}
      {hasNetwork && !isFullTrace && (
        <details className="border border-red-200 bg-red-50 rounded-lg dark:border-red-800 dark:bg-red-950/30">
          <summary className="flex items-center gap-2 p-2.5 cursor-pointer select-none text-sm">
            <Globe className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            <span className="font-medium text-red-800 dark:text-red-200">Network Errors</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              {networkRequests!.length}
            </Badge>
          </summary>
          <NetworkTraceTable requests={networkRequests!} networkBodiesPath={networkBodiesPath} />
        </details>
      )}

      {/* Full network trace — new format with all requests */}
      {hasNetwork && isFullTrace && (
        <details className={`border rounded-lg ${hasErrors ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30' : 'border-border bg-muted/30'}`}>
          <summary className="flex items-center gap-2 p-2.5 cursor-pointer select-none text-sm">
            <Globe className={`w-4 h-4 shrink-0 ${hasErrors ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`} />
            <span className={`font-medium ${hasErrors ? 'text-red-800 dark:text-red-200' : 'text-foreground'}`}>
              Network Requests
            </span>
            {hasErrors && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                {networkErrors.length} error{networkErrors.length !== 1 ? 's' : ''}
              </Badge>
            )}
            <Badge variant="secondary" className="ml-auto text-xs">
              {networkRequests!.length}
            </Badge>
          </summary>
          <NetworkTraceTable requests={networkRequests!} networkBodiesPath={networkBodiesPath} />
        </details>
      )}

      {hasDownloads && (
        <details className="border border-blue-200 bg-blue-50 rounded-lg dark:border-blue-800 dark:bg-blue-950/30">
          <summary className="flex items-center gap-2 p-2.5 cursor-pointer select-none text-sm">
            <Download className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="font-medium text-blue-800 dark:text-blue-200">Downloads</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              {downloads!.length}
            </Badge>
          </summary>
          <DownloadTraceTable downloads={downloads!} />
        </details>
      )}
    </div>
  );
}
