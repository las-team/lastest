'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  FileCode,
  Play,
  GitCompare,
  Settings,
  Layers,
  ListOrdered,
  Building2,
  Zap,
  ClipboardCheck,
  TrendingDown,
} from 'lucide-react';
import Image from 'next/image';
import { RepoSelector, CreateLocalRepoButton } from './repo-selector';
import { QueueIndicator } from '@/components/queue/queue-indicator';
import { ActivityFeedIndicator } from '@/components/activity-feed/activity-feed-indicator-client';
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

const EARLY_ADOPTER_ITEMS = new Set(['Compose', 'Suites', 'Compare', 'Impact']);

const definitionNav = [
  { name: 'Definition', href: '/definition', icon: FileCode },
  { name: 'Compose', href: '/compose', icon: Layers },
  { name: 'Seed', href: '/env', icon: Zap },
];

const executionNav = [
  { name: 'Runs', href: '/run', icon: Play },
  { name: 'Compare', href: '/compare', icon: GitCompare },
  { name: 'Suites', href: '/suites', icon: ListOrdered },
  { name: 'Review', href: '/review', icon: ClipboardCheck },
  { name: 'Impact', href: '/analytics/impact', icon: TrendingDown },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const settingsNav = [
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar({ repos, selectedRepo, currentUser, team }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const justConnected = searchParams.get('success') === 'github_connected' || searchParams.get('success') === 'gitlab_connected';
  const earlyAdopter = team?.earlyAdopterMode ?? false;

  const filteredDefinitionNav = earlyAdopter
    ? definitionNav
    : definitionNav.filter((item) => !EARLY_ADOPTER_ITEMS.has(item.name));
  const filteredExecutionNav = earlyAdopter
    ? executionNav
    : executionNav.filter((item) => !EARLY_ADOPTER_ITEMS.has(item.name));

  return (
    <aside className="w-64 border-r bg-muted/30 flex flex-col">
      <div className="p-4 border-b">
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-lg"
          style={{ height: 36 }}
        >
          <Image src="/icon-light.svg" alt="" width={28} height={28} className="rounded-full dark:hidden" />
          <Image src="/icon-dark.svg" alt="" width={28} height={28} className="rounded-full hidden dark:block" />
          LASTEST
        </Link>
        {team && (
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3" />
            <span className="truncate">{team.name}</span>
          </div>
        )}
      </div>

      <div className={cn(
        'p-4 border-b space-y-3 transition-all duration-500',
        justConnected && 'ring-2 ring-primary/60 bg-primary/5 rounded-md'
      )}>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <RepoSelector initialRepos={repos} initialSelected={selectedRepo} />
          </div>
          <CreateLocalRepoButton />
        </div>
        {justConnected && repos && repos.length > 0 && !selectedRepo && (
          <p className="text-xs text-primary font-medium animate-pulse">
            {repos.length} repo{repos.length !== 1 ? 's' : ''} synced — select one to get started
          </p>
        )}
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
            {filteredDefinitionNav.map((item) => {
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
            {filteredExecutionNav.map((item) => {
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

      <div className="px-4 pb-2 space-y-1">
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
          <div className="flex items-center gap-0.5">
            {earlyAdopter && <ActivityFeedIndicator />}
            <QueueIndicator />
          </div>
        </div>
      </div>
    </aside>
  );
}
