'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, RefreshCw, Github, HardDrive, Plus } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { fetchAndSyncRepos, fetchAndSyncGitlabRepos, selectRepo, createLocalRepo } from '@/server/actions/repos';
import type { Repository } from '@/lib/db/schema';

// GitLab icon SVG component
function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.845.904c-.435 0-.82.28-.955.692C2.639 5.449 1.246 9.728.07 13.335a1.437 1.437 0 00.522 1.607l11.071 8.045c.2.145.472.144.67-.004l11.073-8.04a1.436 1.436 0 00.522-1.61c-1.285-3.942-2.683-8.256-3.817-11.746a1.004 1.004 0 00-.957-.684.987.987 0 00-.949.69l-2.405 7.408H8.203l-2.41-7.408a.987.987 0 00-.942-.69h-.006z" />
    </svg>
  );
}

function RepoIcon({ provider, className }: { provider: string; className?: string }) {
  if (provider === 'gitlab') return <GitLabIcon className={className} />;
  if (provider === 'local') return <HardDrive className={className} />;
  return <Github className={className} />;
}

// Separate sync button component that can be positioned independently
export function SyncReposButton() {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      // Sync from both GitHub and GitLab in parallel
      const [githubResult, gitlabResult] = await Promise.all([
        fetchAndSyncRepos(),
        fetchAndSyncGitlabRepos(),
      ]);
      if (githubResult.success || gitlabResult.success) {
        // Refresh the page to update RepoSelector with new repos
        router.refresh();
      }
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleSync}
      disabled={isSyncing}
      title="Sync repositories from GitHub and GitLab"
    >
      <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
    </Button>
  );
}

export function CreateLocalRepoButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      await createLocalRepo(name.trim());
      setName('');
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title="Create local repository">
          <Plus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-2">
          <p className="text-sm font-medium">New local repository</p>
          <Input
            placeholder="Repository name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <Button
            size="sm"
            className="w-full"
            onClick={handleCreate}
            disabled={!name.trim() || isPending}
          >
            {isPending ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface RepoSelectorProps {
  initialRepos?: Repository[];
  initialSelected?: Repository | null;
}

export function RepoSelector({ initialRepos = [], initialSelected = null }: RepoSelectorProps) {
  const router = useRouter();
  const [repos, setRepos] = useState<Repository[]>(initialRepos);
  const [selected, setSelected] = useState<Repository | null>(initialSelected);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRepos(initialRepos);
  }, [initialRepos]);

  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);

  const handleSelect = (repoId: string) => {
    startTransition(async () => {
      await selectRepo(repoId);
      const repo = repos.find((r) => r.id === repoId) || null;
      setSelected(repo);
      router.refresh();
    });
  };

  return (
    <Select
      value={selected?.id || ''}
      onValueChange={handleSelect}
      disabled={isPending || repos.length === 0}
    >
      <SelectTrigger className="w-full">
        <Layers className="h-4 w-4 mr-2 shrink-0" />
        <SelectValue placeholder="Select repository">
          {selected?.fullName || 'Select repository'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {repos.map((repo) => (
          <SelectItem key={repo.id} value={repo.id}>
            <div className="flex items-center gap-2">
              <RepoIcon provider={repo.provider} className="h-3.5 w-3.5 shrink-0" />
              {repo.fullName}
            </div>
          </SelectItem>
        ))}
        {repos.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            No repos yet. Create a local repo or sync from GitHub/GitLab.
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
