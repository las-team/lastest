'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { GitBranch, RefreshCw } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { fetchAndSyncRepos, getRepos, selectRepo, getSelectedRepo } from '@/server/actions/repos';
import type { Repository } from '@/lib/db/schema';

interface RepoSelectorProps {
  initialRepos?: Repository[];
  initialSelected?: Repository | null;
}

export function RepoSelector({ initialRepos = [], initialSelected = null }: RepoSelectorProps) {
  const router = useRouter();
  const [repos, setRepos] = useState<Repository[]>(initialRepos);
  const [selected, setSelected] = useState<Repository | null>(initialSelected);
  const [isPending, startTransition] = useTransition();
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Load repos on mount if not provided
    if (initialRepos.length === 0) {
      getRepos().then(setRepos);
    }
    if (!initialSelected) {
      getSelectedRepo().then(setSelected);
    }
  }, [initialRepos.length, initialSelected]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await fetchAndSyncRepos();
      if (result.success) {
        const updated = await getRepos();
        setRepos(updated);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSelect = (repoId: string) => {
    startTransition(async () => {
      await selectRepo(repoId);
      const repo = repos.find((r) => r.id === repoId) || null;
      setSelected(repo);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selected?.id || ''}
        onValueChange={handleSelect}
        disabled={isPending || repos.length === 0}
      >
        <SelectTrigger className="w-full">
          <GitBranch className="h-4 w-4 mr-2 shrink-0" />
          <SelectValue placeholder="Select repository">
            {selected?.fullName || 'Select repository'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {repos.map((repo) => (
            <SelectItem key={repo.id} value={repo.id}>
              {repo.fullName}
            </SelectItem>
          ))}
          {repos.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No repos synced. Click sync to fetch.
            </div>
          )}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleSync}
        disabled={isSyncing}
        title="Sync repositories from GitHub"
      >
        <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  );
}
