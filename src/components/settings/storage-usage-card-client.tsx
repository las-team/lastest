'use client';

import { useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { recalculateStorageAction, triggerStorageCleanupAction } from '@/server/actions/storage';

interface StorageUsageCardProps {
  usedBytes: number;
  quotaBytes: number;
  lastCalculatedAt: string | null;
  isAdmin: boolean;
  enforcementEnabled: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i >= 2 ? 2 : 0)} ${units[i]}`;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function StorageUsageCard({
  usedBytes,
  quotaBytes,
  lastCalculatedAt,
  isAdmin,
  enforcementEnabled,
}: StorageUsageCardProps) {
  const [isRecalculating, startRecalculate] = useTransition();
  const [isCleaning, startCleanup] = useTransition();

  const percentUsed = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;

  function handleRecalculate() {
    startRecalculate(async () => {
      try {
        await recalculateStorageAction();
        toast.success('Storage usage recalculated');
      } catch {
        toast.error('Failed to recalculate storage');
      }
    });
  }

  function handleCleanup() {
    if (!confirm('This will delete the oldest test runs and their data to free up space. Continue?')) {
      return;
    }
    startCleanup(async () => {
      try {
        await triggerStorageCleanupAction();
        toast.success('Storage cleanup started');
      } catch {
        toast.error('Failed to start cleanup');
      }
    });
  }

  const progressColor =
    percentUsed >= 90 ? 'bg-red-500' :
    percentUsed >= 70 ? 'bg-yellow-500' :
    'bg-green-500';

  return (
    <Card id="storage">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="w-5 h-5" />
              Storage Usage
            </CardTitle>
          </div>
          <Badge variant={enforcementEnabled ? 'default' : 'secondary'}>
            {enforcementEnabled ? 'Enforced' : 'Display only'}
          </Badge>
        </div>
        <CardDescription>
          Disk storage used by screenshots, videos, diffs, and other test artifacts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
            </span>
            <span className="text-muted-foreground">{percentUsed}%</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20">
            <div
              className={`h-full ${progressColor} transition-all rounded-full`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          {lastCalculatedAt && (
            <p className="text-xs text-muted-foreground">
              Last calculated: {formatRelativeTime(lastCalculatedAt)}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecalculate}
            disabled={isRecalculating || isCleaning}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isRecalculating ? 'animate-spin' : ''}`} />
            Recalculate
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCleanup}
              disabled={isCleaning || isRecalculating}
            >
              <Trash2 className={`w-4 h-4 mr-1.5`} />
              {isCleaning ? 'Cleaning up...' : 'Clean Up'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
