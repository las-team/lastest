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
  ListOrdered,
  FolderTree,
  Building2,
  Zap,
} from 'lucide-react';
import { RepoSelector, SyncReposButton } from './repo-selector';
import { QueueIndicator } from '@/components/queue/queue-indicator';
import { UserMenu } from '@/components/auth/user-menu';
import type { Repository, User, Team } from '@/lib/db/schema';

interface SidebarProps {
  repos?: Repository[];
  selectedRepo?: Repository | null;
  currentUser?: User | null;
  team?: Team | null;
}

const dashboardNav = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
];

const definitionNav = [
  { name: 'Areas', href: '/areas', icon: FolderTree },
  { name: 'Tests', href: '/tests', icon: FileCode },
  { name: 'Suites', href: '/suites', icon: ListOrdered },
  { name: 'Compose', href: '/compose', icon: Layers },
  { name: 'Env Setup', href: '/env', icon: Zap },
];

const executionNav = [
  { name: 'Runs', href: '/run', icon: Play },
  { name: 'Compare', href: '/compare', icon: GitCompare },
];

const settingsNav = [
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar({ repos, selectedRepo, currentUser, team }: SidebarProps) {
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
        {team && (
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3" />
            <span className="truncate">{team.name}</span>
          </div>
        )}
      </div>

      <div className="p-4 border-b space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <RepoSelector initialRepos={repos} initialSelected={selectedRepo} />
          </div>
          <SyncReposButton />
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-4">
        <ul className="space-y-1">
          {dashboardNav.map((item) => {
            const isActive = pathname === item.href;
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

        <div>
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">Definition</p>
          <ul className="space-y-1">
            {definitionNav.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href);
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
        </div>

        <div>
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">Execution</p>
          <ul className="space-y-1">
            {executionNav.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href);
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
        </div>

      </nav>

      <div className="px-4 pb-2">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
            pathname === '/settings' || pathname.startsWith('/settings')
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted'
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>

      <div className="p-4 border-t space-y-3">
        {currentUser && <UserMenu user={currentUser} />}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Visual Regression Testing</span>
          <QueueIndicator />
        </div>
      </div>
    </aside>
  );
}
