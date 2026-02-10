'use client';

import { useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { updateRepoDefaultComparisonMode } from '@/server/actions/repos';
import { toast } from 'sonner';

interface ComparisonModeCardProps {
  repositoryId: string;
  currentMode: string;
}

export function ComparisonModeCard({ repositoryId, currentMode }: ComparisonModeCardProps) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (value: string) => {
    startTransition(async () => {
      await updateRepoDefaultComparisonMode(repositoryId, value);
      toast.success('Default comparison mode updated');
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Default Comparison Mode</CardTitle>
          {isPending && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </div>
        <CardDescription className="text-xs">
          How new builds compare screenshots against baselines
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Select value={currentMode} onValueChange={handleChange} disabled={isPending}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vs_both">vs Both &mdash; Branch + Main comparison</SelectItem>
            <SelectItem value="vs_main">vs Main &mdash; Compare against main baseline only</SelectItem>
            <SelectItem value="vs_branch">vs Branch &mdash; Compare against branch baseline only</SelectItem>
            <SelectItem value="vs_previous">vs Previous &mdash; Compare against previous run</SelectItem>
            <SelectItem value="vs_planned">vs Design &mdash; Compare against design screenshots</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
