'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Github, HardDrive, Plus, Check, ChevronsUpDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { selectRepo, createLocalRepo } from '@/server/actions/repos';
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRepos(initialRepos);
  }, [initialRepos]);

  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return repos;
    const q = search.toLowerCase();
    return repos.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos, search]);

  const handleSelect = (repoId: string) => {
    setOpen(false);
    startTransition(async () => {
      await selectRepo(repoId);
      const repo = repos.find((r) => r.id === repoId) || null;
      setSelected(repo);
      router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={isPending || repos.length === 0}
          className="w-full justify-between font-normal"
        >
          <span className="flex items-center gap-2 truncate">
            <Layers className="h-4 w-4 shrink-0" />
            <span className="truncate">{selected?.fullName || 'Select repository'}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="flex items-center border-b px-3">
          <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
          <Input
            ref={inputRef}
            placeholder="Search repos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filtered.map((repo) => (
            <button
              key={repo.id}
              onClick={() => handleSelect(repo.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer',
                'hover:bg-accent hover:text-accent-foreground',
                selected?.id === repo.id && 'bg-accent'
              )}
            >
              <Check className={cn('h-3.5 w-3.5 shrink-0', selected?.id === repo.id ? 'opacity-100' : 'opacity-0')} />
              <RepoIcon provider={repo.provider} className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{repo.fullName}</span>
            </button>
          ))}
          {filtered.length === 0 && repos.length > 0 && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              No repos match &ldquo;{search}&rdquo;
            </div>
          )}
          {repos.length === 0 && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              No repos yet. Create a local repo or sync from GitHub/GitLab.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
