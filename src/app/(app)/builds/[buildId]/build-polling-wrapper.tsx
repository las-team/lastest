'use client';

import { useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { BuildDetailClient } from './build-detail-client';
import { BuildSummaryHero } from '@/components/dashboard/build-summary-hero';
import type { VisualDiffWithTestStatus, BuildStatus } from '@/lib/db/schema';

interface BuildData {
  id: string;
  overallStatus: BuildStatus;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  changesDetected: number;
  flakyCount: number;
  completedAt: Date | null;
  elapsedMs: number | null;
  codeChangeTestIds?: string[] | null;
  diffs: VisualDiffWithTestStatus[];
}

interface BuildPollingWrapperProps {
  initialBuild: BuildData;
  buildId: string;
  isMainBranch?: boolean;
  children?: ReactNode;
}

export function BuildPollingWrapper({ initialBuild, buildId, isMainBranch = false, children }: BuildPollingWrapperProps) {
  const [build, setBuild] = useState<BuildData>(initialBuild);
  const [isPolling, setIsPolling] = useState(!initialBuild.completedAt);

  // Mark "Check Results" setup guide step as complete on page visit
  useEffect(() => {
    try { localStorage.setItem('lastest2-results-viewed', 'true'); } catch {}
  }, []);
  const router = useRouter();

  useEffect(() => {
    if (!isPolling) return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/builds/${buildId}/status`);
        if (!res.ok) return;

        const data = await res.json();
        setBuild(data);

        if (data.completedAt) {
          setIsPolling(false);
          router.refresh();
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [buildId, isPolling, router]);

  const isRunning = !build.completedAt;
  const completedTests = build.passedCount + build.failedCount;
  const pendingDiffs = build.diffs.filter((d) => d.status === 'pending');

  return (
    <>
      {/* Top row: Hero + Quick Actions + Git Info */}
      <div className="flex items-center gap-3">
        <BuildSummaryHero
          status={build.overallStatus}
          changesDetected={build.changesDetected}
          isRunning={isRunning}
        />
        {children}
      </div>

      {/* Metrics Row and Diff List with Filter Support */}
      <BuildDetailClient
        buildId={buildId}
        diffs={build.diffs}
        metrics={{
          totalTests: build.totalTests,
          changesDetected: build.changesDetected,
          flakyCount: build.flakyCount ?? 0,
          failedCount: build.failedCount,
          passedCount: build.passedCount,
          errorsCount: build.diffs.filter(d => d.errorMessage).length,
          elapsedMs: build.elapsedMs,
        }}
        hasPendingDiffs={pendingDiffs.length > 0}
        isRunning={isRunning}
        completedTests={completedTests}
        codeChangeTestIds={build.codeChangeTestIds}
        isMainBranch={isMainBranch}
      />
    </>
  );
}
