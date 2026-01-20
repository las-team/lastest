'use client';

import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface CoverageBarProps {
  covered: number;
  total: number;
  isScanning?: boolean;
  scanProgress?: number;
  className?: string;
}

export function CoverageBar({
  covered,
  total,
  isScanning,
  scanProgress,
  className,
}: CoverageBarProps) {
  const coveragePercent = total > 0 ? Math.round((covered / total) * 100) : 0;

  if (isScanning) {
    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Scanning routes...</span>
          <span className="font-medium">{scanProgress ?? 0}%</span>
        </div>
        <Progress value={scanProgress ?? 0} className="h-2" />
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className={cn('text-sm text-muted-foreground', className)}>
        No routes discovered. Scan to detect routes.
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Route coverage</span>
        <span className="font-medium">
          {covered}/{total} routes ({coveragePercent}%)
        </span>
      </div>
      <Progress
        value={coveragePercent}
        className={cn(
          'h-2',
          coveragePercent === 100 && 'bg-green-500/20',
          coveragePercent < 50 && 'bg-red-500/20'
        )}
      />
    </div>
  );
}
