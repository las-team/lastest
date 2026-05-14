'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PlayCircle } from 'lucide-react';

interface RunUsageCardProps {
  runsThisMonth: number;
  monthlyRunQuota: number;
  runMinutesThisMonth: number;
  usageMonth: string;
  lastCalculatedAt: string | null;
  enforcementEnabled: boolean;
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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return yyyymm;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function formatNumber(n: number): string {
  // Deterministic (no locale-dependent toLocaleString) to avoid SSR/CSR mismatch.
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function RunUsageCard({
  runsThisMonth,
  monthlyRunQuota,
  runMinutesThisMonth,
  usageMonth,
  lastCalculatedAt,
  enforcementEnabled,
}: RunUsageCardProps) {
  const percentUsed =
    monthlyRunQuota > 0
      ? Math.min(100, Math.round((runsThisMonth / monthlyRunQuota) * 100))
      : 0;

  const progressColor =
    percentUsed >= 90 ? 'bg-red-500' : percentUsed >= 70 ? 'bg-yellow-500' : 'bg-green-500';

  const minutesDisplay =
    runMinutesThisMonth >= 60
      ? `${(runMinutesThisMonth / 60).toFixed(1)} h`
      : `${runMinutesThisMonth.toFixed(1)} min`;

  // Defer relative-time formatting to after mount; `new Date()` inside
  // formatRelativeTime would otherwise produce different "Xm ago" strings on
  // SSR vs CSR and trip the hydration check.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  return (
    <Card id="run-usage">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <PlayCircle className="w-5 h-5" />
            Monthly Run Usage
          </CardTitle>
          <Badge variant={enforcementEnabled ? 'default' : 'secondary'}>
            {enforcementEnabled ? 'Enforced' : 'Display only'}
          </Badge>
        </div>
        <CardDescription>
          Test runs and run-minutes used this month ({formatMonth(usageMonth)}). Counters reset on the 1st (UTC).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {formatNumber(runsThisMonth)} of {formatNumber(monthlyRunQuota)} runs used
            </span>
            <span className="text-muted-foreground">{percentUsed}%</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20">
            <div
              className={`h-full ${progressColor} transition-all rounded-full`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{minutesDisplay} of run time (measured, not capped)</span>
            {mounted && lastCalculatedAt && <span>Last updated: {formatRelativeTime(lastCalculatedAt)}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
