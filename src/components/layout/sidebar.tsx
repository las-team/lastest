'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  FileCode,
  Play,
  GitCompare,
  Settings,
  Circle,
  FolderGit2,
} from 'lucide-react';
import { RepoSelector, SyncReposButton } from './repo-selector';
import { ActiveBranchBadge } from './active-branch-badge';

interface SidebarProps {
  activeBranch?: string;
}

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Repo', href: '/repo', icon: FolderGit2 },
  { name: 'Tests', href: '/tests', icon: FileCode },
  { name: 'Runs', href: '/run', icon: Play },
  { name: 'Compare', href: '/compare', icon: GitCompare },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar({ activeBranch }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-muted/30 flex flex-col">
      <div className="p-4 border-b">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <Circle className="h-6 w-6 fill-primary text-primary" />
          LASTEST2
        </Link>
      </div>

      <div className="p-4 border-b space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <RepoSelector />
          </div>
          <SyncReposButton />
        </div>
        {activeBranch && activeBranch !== 'unknown' && (
          <ActiveBranchBadge branch={activeBranch} />
        )}
      </div>

      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t text-xs text-muted-foreground">
        Visual Regression Testing
      </div>
    </aside>
  );
}
