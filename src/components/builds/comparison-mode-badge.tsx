import { Badge } from '@/components/ui/badge';
import { GitBranch, GitMerge, ArrowLeftRight, SkipBack, Palette } from 'lucide-react';

const modeConfig: Record<string, { label: string; icon: typeof GitBranch; className: string }> = {
  vs_main: { label: 'vs Main', icon: GitMerge, className: 'bg-blue-50 text-blue-700 border-blue-200' },
  vs_branch: { label: 'vs Branch', icon: GitBranch, className: 'bg-green-50 text-green-700 border-green-200' },
  vs_both: { label: 'vs Both', icon: ArrowLeftRight, className: 'bg-purple-50 text-purple-700 border-purple-200' },
  vs_previous: { label: 'vs Previous', icon: SkipBack, className: 'bg-orange-50 text-orange-700 border-orange-200' },
  vs_planned: { label: 'vs Design', icon: Palette, className: 'bg-pink-50 text-pink-700 border-pink-200' },
};

export function ComparisonModeBadge({ mode }: { mode: string | null }) {
  const config = mode ? modeConfig[mode] : null;
  if (!config) return null;

  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`text-[10px] gap-1 px-1.5 py-0 ${config.className}`}>
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </Badge>
  );
}
