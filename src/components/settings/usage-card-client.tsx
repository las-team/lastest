'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Activity, AlertTriangle, Clock } from 'lucide-react';
import type { UsageVsQuota } from '@/lib/auth';

interface UsageCardProps {
  usage: UsageVsQuota;
  monthLabel: string;
  storageUsedBytes?: number | null;
  storageQuotaBytes?: number | null;
}

function formatMs(ms: number): string {
  if (ms <= 0) return '0m';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 2 : 0)} ${units[i]}`;
}

export function UsageCard({ usage, monthLabel, storageUsedBytes, storageQuotaBytes }: UsageCardProps) {
  const unlimited = usage.quotaMs < 0;
  const quotaLabel = unlimited
    ? 'Unlimited'
    : `${formatMs(usage.quotaMs)} (${usage.quotaMinutes.toLocaleString()} min)`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Usage this month
        </CardTitle>
        <CardDescription>
          {monthLabel} · {usage.testRunCount.toLocaleString()} test results recorded
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5 text-sm">
            <span className="font-medium flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Test runtime
            </span>
            <span className="text-muted-foreground">
              <span className="font-mono">{formatMs(usage.usedMs)}</span>
              <span> / </span>
              <span className="font-mono">{quotaLabel}</span>
            </span>
          </div>
          {!unlimited && (
            <Progress
              value={usage.percent}
              className={usage.exceeded ? '[&>div]:bg-destructive' : undefined}
            />
          )}
          {usage.exceeded && (
            <div className="mt-2 flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
              You&apos;ve exceeded your plan&apos;s monthly runtime — overage rates apply, or
              upgrade for more bundled minutes.
            </div>
          )}
          {!unlimited && !usage.exceeded && usage.percent >= 80 && (
            <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
              You&apos;ve used {usage.percent}% of your monthly runtime.
            </div>
          )}
          {unlimited && (
            <Badge variant="outline" className="text-xs">
              Unlimited on this plan
            </Badge>
          )}
        </div>

        {typeof storageUsedBytes === 'number' && typeof storageQuotaBytes === 'number' && (
          <div>
            <div className="flex items-center justify-between mb-1.5 text-sm">
              <span className="font-medium">Storage</span>
              <span className="text-muted-foreground font-mono">
                {formatBytes(storageUsedBytes)} / {formatBytes(storageQuotaBytes)}
              </span>
            </div>
            <Progress
              value={
                storageQuotaBytes > 0
                  ? Math.min(100, Math.round((storageUsedBytes / storageQuotaBytes) * 100))
                  : 0
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
