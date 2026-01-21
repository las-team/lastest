import { GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ActiveBranchBadgeProps {
  branch: string;
}

export function ActiveBranchBadge({ branch }: ActiveBranchBadgeProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 rounded-md">
      <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
      <Badge variant="secondary" className="font-mono text-xs">
        {branch}
      </Badge>
    </div>
  );
}
