import Link from 'next/link';
import { CheckCircle, AlertTriangle, XCircle, Clock, GitBranch, Globe, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Build, BuildStatus } from '@/lib/db/schema';

interface BuildSummaryCardProps {
  build: Build;
  gitBranch?: string;
  isActiveBranch?: boolean;
  baseUrl?: string;
  isBaseline?: boolean;
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
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    textColor: 'text-green-700',
    iconColor: 'text-green-500',
  },
  review_required: {
    icon: AlertTriangle,
    label: 'Review Required',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    textColor: 'text-yellow-700',
    iconColor: 'text-yellow-500',
  },
  blocked: {
    icon: XCircle,
    label: 'Blocked',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-700',
    iconColor: 'text-red-500',
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

export function BuildSummaryCard({ build, gitBranch, isActiveBranch, baseUrl, isBaseline }: BuildSummaryCardProps) {
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
            {isBaseline && (
              <Badge variant="outline" className="text-xs font-normal gap-1 shrink-0 border-green-300 text-green-700 bg-green-50">
                <Shield className="h-3 w-3" />
                Baseline
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
          <span className="font-medium text-yellow-600">{build.changesDetected ?? 0}</span>
          <span className="text-muted-foreground">changed</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-medium text-red-600">{build.failedCount ?? 0}</span>
          <span className="text-muted-foreground">failed</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground ml-auto">
          <Clock className="w-3 h-3" />
          {formatDuration(build.elapsedMs)}
        </div>
      </div>
    </Link>
  );
}
