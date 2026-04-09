'use client';

import { Terminal, Globe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { NetworkRequest } from '@/lib/db/schema';

interface RuntimeErrorsPanelProps {
  consoleErrors?: string[] | null;
  networkRequests?: NetworkRequest[] | null;
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

function getStatusColor(status: number) {
  if (status >= 500) return 'bg-red-500 text-white';
  if (status >= 400) return 'bg-orange-500 text-white';
  return 'bg-gray-500 text-white';
}

function getMethodColor(method: string) {
  switch (method.toUpperCase()) {
    case 'GET': return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    case 'POST': return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300';
    case 'PUT': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
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

export function RuntimeErrorsPanel({ consoleErrors, networkRequests }: RuntimeErrorsPanelProps) {
  const hasConsole = consoleErrors && consoleErrors.length > 0;
  const hasNetwork = networkRequests && networkRequests.length > 0;

  if (!hasConsole && !hasNetwork) return null;

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
                    ×{entry.count}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {hasNetwork && (
        <details className="border border-red-200 bg-red-50 rounded-lg dark:border-red-800 dark:bg-red-950/30">
          <summary className="flex items-center gap-2 p-2.5 cursor-pointer select-none text-sm">
            <Globe className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            <span className="font-medium text-red-800 dark:text-red-200">Network Errors</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              {networkRequests.length}
            </Badge>
          </summary>
          <div className="px-2.5 pb-2.5 max-h-64 overflow-y-auto space-y-1">
            {networkRequests.map((req, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-1.5 rounded bg-red-100/50 dark:bg-red-900/30 text-xs"
              >
                <Badge className={`${getMethodColor(req.method)} shrink-0 text-[10px] px-1.5 py-0 font-mono`}>
                  {req.method}
                </Badge>
                <Badge className={`${getStatusColor(req.status)} shrink-0 text-[10px] px-1.5 py-0 font-mono`}>
                  {req.status}
                </Badge>
                <span
                  className="font-mono text-red-800 dark:text-red-200 truncate flex-1"
                  title={req.url}
                >
                  {truncateUrl(req.url)}
                </span>
                <span className="text-red-500 dark:text-red-400 shrink-0 text-[10px]">
                  {req.resourceType}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
