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
  Layers,
  FolderTree,
} from 'lucide-react';
import { RepoSelector, SyncReposButton } from './repo-selector';
import { QueueIndicator } from '@/components/queue/queue-indicator';
import type { Repository } from '@/lib/db/schema';

interface SidebarProps {
  repos?: Repository[];
  selectedRepo?: Repository | null;
}

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Areas', href: '/areas', icon: FolderTree },
  { name: 'Tests', href: '/tests', icon: FileCode },
  { name: 'Suites', href: '/suites', icon: Layers },
  { name: 'Runs', href: '/run', icon: Play },
  { name: 'Compare', href: '/compare', icon: GitCompare },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar({ repos, selectedRepo }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-muted/30 flex flex-col">
      <div className="p-4 border-b">
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-lg"
          style={{ height: 36 }}
        >
          <Circle className="h-6 w-6 fill-primary text-primary" />
          LASTEST2
        </Link>
      </div>

      <div className="p-4 border-b space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <RepoSelector initialRepos={repos} initialSelected={selectedRepo} />
          </div>
          <SyncReposButton />
        </div>
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

      <div className="p-4 border-t flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Visual Regression Testing</span>
        <QueueIndicator />
      </div>
    </aside>
  );
}
