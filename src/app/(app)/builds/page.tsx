import Link from 'next/link';
import { getBuildsByRepo } from '@/server/actions/builds';
import { getSelectedRepository } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { CheckCircle, AlertTriangle, XCircle, Clock, GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const statusIcons: Record<string, typeof CheckCircle> = {
  safe_to_merge: CheckCircle,
  review_required: AlertTriangle,
  blocked: XCircle,
};

const statusColors: Record<string, string> = {
  safe_to_merge: 'text-green-600 bg-green-50',
  review_required: 'text-yellow-600 bg-yellow-50',
  blocked: 'text-red-600 bg-red-50',
};

export default async function BuildsPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const selectedRepo = teamId ? await getSelectedRepository(teamId) : null;
  const activeBranch = selectedRepo?.selectedBranch || selectedRepo?.defaultBranch || 'main';
  const builds = selectedRepo
    ? await getBuildsByRepo(selectedRepo.id, 20)
    : [];

  const formatTime = (date: Date | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Builds</h1>
        <Button asChild>
          <Link href="/run">
            Run New Build
          </Link>
        </Button>
      </div>

      {builds.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No builds yet.</p>
          <p className="text-sm mt-2">Run your first build to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {builds.map((build) => {
            const StatusIcon = statusIcons[build.overallStatus];
            const statusColor = statusColors[build.overallStatus];
            const buildBranch = 'gitBranch' in build ? (build.gitBranch as string) : undefined;
            const buildCommit = 'gitCommit' in build ? (build.gitCommit as string) : undefined;
            const isActiveBranch = buildBranch === activeBranch;

            return (
              <Link
                key={build.id}
                href={`/builds/${build.id}`}
                className={cn(
                  "block p-4 border rounded-lg hover:border-primary/30 hover:bg-primary/5 transition-colors",
                  isActiveBranch && "ring-2 ring-primary/50"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded ${statusColor}`}>
                      <StatusIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        Build {build.id.slice(0, 8)}
                        {buildBranch && (
                          <Badge variant={isActiveBranch ? 'default' : 'secondary'} className="text-xs font-normal gap-1">
                            <GitBranch className="h-3 w-3" />
                            {buildBranch}
                          </Badge>
                        )}
                        {buildCommit && (
                          <Badge variant="outline" className="text-xs font-mono font-normal">
                            {buildCommit.slice(0, 7)}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {build.triggerType} · {formatTime(build.createdAt)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="font-medium">{build.totalTests}</div>
                      <div className="text-muted-foreground">Tests</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-yellow-600">
                        {build.changesDetected}
                      </div>
                      <div className="text-muted-foreground">Changed</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-red-600">
                        {build.failedCount}
                      </div>
                      <div className="text-muted-foreground">Failed</div>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      {build.elapsedMs ? `${(build.elapsedMs / 1000).toFixed(1)}s` : '-'}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
