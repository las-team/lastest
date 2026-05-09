'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChevronDown, ChevronRight, RefreshCw, ShieldCheck, AlertTriangle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { runSmartBuild } from '@/server/actions/smart-run';
import type { ChangeMap } from '@/lib/db/schema';

interface BuildRow {
  id: string;
  overallStatus: string;
  gitBranch: string;
  gitCommit: string;
  completedAt: Date | null;
  createdAt?: Date | null;
}

interface BuildLaneItem {
  build: BuildRow;
  verdictCounts: { green: number; yellow: number; red: number };
  changeMap: ChangeMap | null;
}

interface BuildLanes {
  awaiting: BuildLaneItem[];
  inProgress: BuildLaneItem[];
  verified: BuildLaneItem[];
}

interface VerifyDashboardClientProps {
  repositoryId: string | null;
  activeBranch: string | null;
  buildLanes: BuildLanes | null;
  baselineBuild: BuildRow | null;
}

export function VerifyDashboardClient({
  repositoryId,
  activeBranch,
  buildLanes,
  baselineBuild,
}: VerifyDashboardClientProps) {
  const router = useRouter();
  const [refreshing, startRefreshing] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = () => {
    if (!repositoryId) return;
    setError(null);
    startRefreshing(async () => {
      const result = await runSmartBuild(repositoryId);
      if ('error' in result) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  if (!repositoryId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border bg-card p-8 text-center">
          <h1 className="text-2xl font-semibold mb-2">Verify</h1>
          <p className="text-muted-foreground">Select a repository to start verifying changes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Verify</h1>
            <p className="text-sm text-muted-foreground">
              Branch <span className="font-medium">{activeBranch}</span> — every change clears two gates: regression and intent.
            </p>
          </div>
        </header>

        <BaselinePanel
          baselineBuild={baselineBuild}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          error={error}
        />

        {buildLanes && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Lane
              title="Awaiting verification"
              icon={<Clock className="h-4 w-4 text-amber-500" />}
              items={buildLanes.awaiting}
            />
            <Lane
              title="In progress"
              icon={<AlertTriangle className="h-4 w-4 text-rose-500" />}
              items={buildLanes.inProgress}
            />
            <Lane
              title="Verified"
              icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
              items={buildLanes.verified}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BaselinePanel({
  baselineBuild,
  onRefresh,
  refreshing,
  error,
}: {
  baselineBuild: BuildRow | null;
  onRefresh: () => void;
  refreshing: boolean;
  error: string | null;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Baseline</p>
          {baselineBuild ? (
            <p className="text-sm">
              Build <Link className="font-medium underline" href={`/verify/${baselineBuild.id}`}>#{baselineBuild.id.slice(0, 8)}</Link>
              {' · '}
              <span className="text-muted-foreground">{baselineBuild.gitBranch}</span>
              {' · '}
              <span className="text-muted-foreground">
                {baselineBuild.completedAt ? new Date(baselineBuild.completedAt).toLocaleString() : 'pending'}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No baseline yet — run a build to capture one.</p>
          )}
          {error && <p className="text-sm text-rose-600 mt-1">{error}</p>}
        </div>
        <Button onClick={onRefresh} disabled={refreshing} variant="default">
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh data'}
        </Button>
      </CardContent>
    </Card>
  );
}

function Lane({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: BuildLaneItem[];
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-sm font-medium mb-3">
        {icon}
        {title}
        <span className="text-muted-foreground">({items.length})</span>
      </h2>
      <ul className="space-y-2">
        {items.length === 0 && (
          <li className="text-sm text-muted-foreground border border-dashed rounded-md p-3">No builds.</li>
        )}
        {items.map((item) => (
          <li key={item.build.id}>
            <BuildCard item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BuildCard({ item }: { item: BuildLaneItem }) {
  const [expanded, setExpanded] = useState(false);
  const { build, verdictCounts, changeMap } = item;

  const sourceChips = useMemo(() => {
    if (!changeMap) return [] as string[];
    const all = new Set<string>();
    changeMap.areas.forEach((a) => a.sources.forEach((s) => all.add(s)));
    return Array.from(all);
  }, [changeMap]);

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            #{build.id.slice(0, 8)}
            <span className="text-muted-foreground font-normal">· {build.gitBranch}</span>
          </button>
          <Link
            href={`/verify/${build.id}`}
            className="inline-flex items-center text-xs text-primary"
          >
            Verify <ArrowRight className="h-3 w-3 ml-1" />
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <VerdictDots counts={verdictCounts} />
          {changeMap && (
            <span className="text-xs text-muted-foreground">
              +{changeMap.files.length} files · {changeMap.areas.length} areas · {changeMap.tests.length} tests · {changeMap.steps.length} steps
            </span>
          )}
          {sourceChips.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">
              {s}
            </Badge>
          ))}
        </div>
        {expanded && changeMap && (
          <div className="border-t pt-2 mt-1 text-xs space-y-1">
            {changeMap.intentSummary && (
              <p><span className="text-muted-foreground">Intent:</span> {changeMap.intentSummary}</p>
            )}
            {changeMap.riskSummary && (
              <p><span className="text-muted-foreground">Risk:</span> {changeMap.riskSummary}</p>
            )}
            {changeMap.aiSkipped && (
              <p className="text-muted-foreground italic">AI summary skipped: {changeMap.aiSkippedReason}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VerdictDots({ counts }: { counts: { green: number; yellow: number; red: number } }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <Dot color="bg-emerald-500" />{counts.green}
      <Dot color="bg-amber-500" />{counts.yellow}
      <Dot color="bg-rose-500" />{counts.red}
    </span>
  );
}

function Dot({ color }: { color: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}
