import Link from 'next/link';
import { CheckCircle, AlertTriangle, XCircle, ListTodo, Clock, GitBranch, Globe, Shield, ServerCrash } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Build, BuildStatus } from '@/lib/db/schema';

interface BuildSummaryCardProps {
  build: Build;
  gitBranch?: string;
  gitCommit?: string;
  isActiveBranch?: boolean;
  baseUrl?: string;
  isBaseline?: boolean;
  isMainBaseline?: boolean;
  isBranchBaseline?: boolean;
}

function isRemoteUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '0.0.0.0';
  } catch {
    return false;
  }
}

function getHostname(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const statusConfig: Record<BuildStatus, {
  icon: typeof CheckCircle;
  label: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  iconColor: string;
}> = {
  safe_to_merge: {
    icon: CheckCircle,
    label: 'Safe to Merge',
    bgColor: 'bg-success/10',
    borderColor: 'border-success/30',
    textColor: 'text-success',
    iconColor: 'text-success',
  },
  review_required: {
    icon: AlertTriangle,
    label: 'Review Required',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
    textColor: 'text-warning',
    iconColor: 'text-warning',
  },
  blocked: {
    icon: XCircle,
    label: 'Blocked',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/30',
    textColor: 'text-destructive',
    iconColor: 'text-destructive',
  },
  has_todos: {
    icon: ListTodo,
    label: 'Has Todos',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
    textColor: 'text-warning',
    iconColor: 'text-warning',
  },
  executor_failed: {
    icon: ServerCrash,
    label: 'Executor Failed',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/40',
    textColor: 'text-destructive',
    iconColor: 'text-destructive',
  },
};

function formatTime(date: Date | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleString();
}

function formatDuration(elapsedMs: number | null): string {
  if (!elapsedMs) return '-';
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

export function BuildSummaryCard({ build, gitBranch, gitCommit, isActiveBranch, baseUrl, isBaseline, isMainBaseline, isBranchBaseline }: BuildSummaryCardProps) {
  const status = build.overallStatus as BuildStatus;
  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <Link
      href={`/builds/${build.id}`}
      className={cn(
        `block p-3 rounded-lg border ${config.borderColor} ${config.bgColor} hover:border-primary/30 hover:bg-primary/5 transition-colors`,
        isActiveBranch && 'ring-2 ring-primary/50'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded ${config.bgColor}`}>
          <StatusIcon className={`w-5 h-5 ${config.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 font-medium">
            <span className="truncate">Build {build.id.slice(0, 8)}</span>
            {isRemoteUrl(baseUrl) ? (
              <Badge variant="outline" className="text-xs font-normal gap-1 shrink-0">
                <Globe className="h-3 w-3" />
                {getHostname(baseUrl!)}
              </Badge>
            ) : gitBranch ? (
              <Badge variant={isActiveBranch ? 'default' : 'secondary'} className="text-xs font-normal gap-1 shrink-0">
                <GitBranch className="h-3 w-3" />
                {gitBranch}
              </Badge>
            ) : null}
            {gitCommit && (
              <Badge variant="outline" className="text-xs font-mono font-normal shrink-0">
                {gitCommit.slice(0, 7)}
              </Badge>
            )}
            {isBaseline && !isMainBaseline && !isBranchBaseline && (
              <Badge variant="outline" className="text-xs font-normal gap-1 shrink-0 border-success/30 text-success bg-success/10">
                <Shield className="h-3 w-3" />
                Baseline
              </Badge>
            )}
            {isMainBaseline && (
              <Badge variant="outline" className="text-xs font-normal gap-1 shrink-0 border-foreground/20 text-foreground bg-foreground/5">
                <Shield className="h-3 w-3" />
                Main Baseline
              </Badge>
            )}
            {isBranchBaseline && (
              <Badge variant="outline" className="text-xs font-normal gap-1 shrink-0 border-info/30 text-info bg-info/10">
                <Shield className="h-3 w-3" />
                Branch Baseline
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {build.triggerType} · {formatTime(build.createdAt)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border/50 text-xs">
        <div className="flex items-center gap-1">
          <span className="font-medium">{build.totalTests ?? 0}</span>
          <span className="text-muted-foreground">tests</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-medium text-warning">{build.changesDetected ?? 0}</span>
          <span className="text-muted-foreground">changed</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-medium text-destructive">{build.failedCount ?? 0}</span>
          <span className="text-muted-foreground">failed</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground ml-auto">
          <Clock className="w-3 h-3" />
          {formatDuration(build.elapsedMs)}
        </div>
      </div>
      {status === 'executor_failed' && build.executorError && (
        <div className="mt-2 pt-2 border-t border-destructive/20 text-xs">
          <div className="flex items-start gap-2 text-destructive">
            <ServerCrash className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Executor crashed before any test ran</div>
              <pre className="mt-1 text-[11px] text-destructive/80 whitespace-pre-wrap break-all line-clamp-3">{build.executorError.split('\n').slice(0, 3).join('\n')}</pre>
            </div>
          </div>
        </div>
      )}
    </Link>
  );
}
