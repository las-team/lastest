'use client';

import { useEffect, useState } from 'react';
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
  Building2,
  TrendingDown,
  Trophy,
  SplitSquareHorizontal,
  ShieldCheck,
  GitCommit,
} from 'lucide-react';
import Image from 'next/image';
import { RepoSelector, CreateLocalRepoButton, type RepositoryWithTestCount } from './repo-selector';
import { QueueIndicator } from '@/components/queue/queue-indicator';
import { ActivityFeedIndicator } from '@/components/activity-feed/activity-feed-indicator-client';
import { UserMenu } from '@/components/auth/user-menu';
import { InlineScore } from '@/components/gamification/user-score-chip';
import { SidebarQuickActions } from './sidebar-quick-actions';
import { DiscordIcon } from '@/components/icons/discord-icon';
import { DISCORD_INVITE_URL } from '@/lib/brand';
import type { Repository, User, Team, EmbeddedSession } from '@/lib/db/schema';

interface SidebarProps {
  repos?: RepositoryWithTestCount[];
  selectedRepo?: Repository | null;
  currentUser?: User | null;
  team?: Team | null;
  baseUrl?: string;
  repositoryId?: string;
  activeBranch?: string;
  ebSessions?: EmbeddedSession[];
  /** Untriaged (Unsorted) cases on the active branch's latest build. */
  verifyPendingCount?: number;
  /** When pending=0 but the active branch has a newer commit since the last
   *  build, surface a small icon hinting that there's something new to verify. */
  verifyHasNewerCommit?: boolean;
}

const dashboardNav = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
];

const gamificationNav = [
  { name: 'Leaderboard', href: '/leaderboard', icon: Trophy },
];

const EARLY_ADOPTER_ITEMS = new Set(['Compose', 'Compare', 'Impact', 'URL Diff']);

const definitionNav = [
  { name: 'Tests', href: '/tests', icon: FileCode },
  { name: 'Compose', href: '/compose', icon: Layers },
];

const executionNav = [
  { name: 'Runs', href: '/run', icon: Play },
  { name: 'Compare', href: '/compare', icon: GitCompare },
  { name: 'URL Diff', href: '/url-diff', icon: SplitSquareHorizontal },
  { name: 'Impact', href: '/analytics/impact', icon: TrendingDown },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const settingsNav = [
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar({ repos, selectedRepo, currentUser, team, baseUrl, repositoryId, activeBranch, ebSessions, verifyPendingCount = 0, verifyHasNewerCommit = false }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const justConnected = mounted && (searchParams.get('success') === 'github_connected' || searchParams.get('success') === 'gitlab_connected');
  const earlyAdopter = team?.earlyAdopterMode ?? false;
  const gamificationEnabled = team?.gamificationEnabled ?? false;
  const verifyPhaseEnabled = team?.verifyPhaseEnabled ?? false;

  const filteredDefinitionNav = earlyAdopter
    ? definitionNav
    : definitionNav.filter((item) => !EARLY_ADOPTER_ITEMS.has(item.name));

  // Verify lives in the Execution section. When the flag is on it sits at
  // the top of that group; legacy /run, /review etc remain accessible so
  // reviewers can compare the new and old flows side-by-side.
  const verifyEntry = { name: 'Verify', href: '/verify', icon: ShieldCheck } as const;
  const filteredExecutionNav = earlyAdopter
    ? executionNav
    : executionNav.filter((item) => !EARLY_ADOPTER_ITEMS.has(item.name));
  const finalExecutionNav = verifyPhaseEnabled
    ? [verifyEntry, ...filteredExecutionNav]
    : filteredExecutionNav;

  return (
    <aside className="w-64 border-r bg-muted/30 flex flex-col">
      <div className="p-4 border-b">
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-lg"
          style={{ height: 36 }}
        >
          <Image src="/icon-light.svg" alt="" width={28} height={28} className="dark:hidden" />
          <Image src="/icon-dark.svg" alt="" width={28} height={28} className="hidden dark:block" />
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
            {mounted ? (
              <RepoSelector initialRepos={repos} initialSelected={selectedRepo} />
            ) : (
              <div className="flex items-center gap-2 h-9 px-3 border rounded-md text-sm">
                <Layers className="h-4 w-4 shrink-0" />
                <span className="truncate">{selectedRepo?.fullName || 'Select repository'}</span>
              </div>
            )}
          </div>
          {mounted && <CreateLocalRepoButton />}
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
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">Tests</p>
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
            {finalExecutionNav.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href);
              const isVerify = item.name === 'Verify';
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
                    <span className="flex-1">{item.name}</span>
                    {isVerify && verifyPendingCount > 0 && (
                      <span
                        className={cn(
                          'inline-flex items-center justify-center rounded-full text-[10px] font-mono font-semibold leading-none px-1.5 min-w-[18px] h-[18px] ring-1',
                          isActive
                            ? 'bg-white text-primary ring-white/40'
                            // Inactive: amber ("attention" — pending verification),
                            // not red ("destructive" — blocking error).
                            : 'bg-[#E09836] text-white ring-[#E09836]/30',
                        )}
                        aria-label={`${verifyPendingCount} unsorted ${verifyPendingCount === 1 ? 'case' : 'cases'}`}
                        title={`${verifyPendingCount} unsorted ${verifyPendingCount === 1 ? 'case' : 'cases'} to triage`}
                      >
                        {verifyPendingCount > 99 ? '99+' : verifyPendingCount}
                      </span>
                    )}
                    {isVerify && verifyPendingCount === 0 && verifyHasNewerCommit && (
                      <span
                        className={cn(
                          'inline-flex items-center justify-center rounded-full leading-none w-[18px] h-[18px] ring-1',
                          isActive
                            ? 'bg-white text-primary ring-white/40'
                            : 'bg-[#3674A8] text-white ring-[#3674A8]/30',
                        )}
                        aria-label="Newer commit on this branch hasn't been verified yet"
                        title="Newer commit on this branch hasn't been verified yet"
                      >
                        <GitCommit className="h-3 w-3" />
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {gamificationEnabled && (
          <div>
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">Arcade</p>
            <ul className="space-y-1">
              {gamificationNav.map((item) => {
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
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 truncate">{item.name}</span>
                      <InlineScore className="ml-auto shrink-0" active={isActive} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

      </nav>

      <div className="px-4 pb-3 space-y-1">
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
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors hover:bg-muted"
        >
          <DiscordIcon className="h-4 w-4" />
          Discord
        </a>
      </div>

      <div className="border-t pt-3">
        <SidebarQuickActions baseUrl={baseUrl} repositoryId={repositoryId} activeBranch={activeBranch} ebSessions={ebSessions} />
      </div>

      <div className="p-4 border-t space-y-3">
        {mounted && currentUser && <UserMenu user={currentUser} />}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Visual Regression Testing</span>
          <div className="flex items-center gap-0.5">
            <ActivityFeedIndicator />
            <QueueIndicator />
          </div>
        </div>
      </div>
    </aside>
  );
}
