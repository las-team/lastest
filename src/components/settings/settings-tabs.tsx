'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Settings as SettingsIcon,
  Plug,
  GitBranch,
  Image as ImageIcon,
  TestTube,
  Bot,
  Bell,
  Users,
  AlertTriangle,
} from 'lucide-react';

export type SettingsTabKey =
  | 'general'
  | 'integrations'
  | 'cicd'
  | 'diff'
  | 'playwright'
  | 'ai'
  | 'notifications'
  | 'team'
  | 'account';

export interface SettingsTabsProps {
  tabs: Array<{
    value: SettingsTabKey;
    label: string;
    /** Optional: hide the tab entirely (e.g., team tab for non-admins) */
    hidden?: boolean;
    content: ReactNode;
  }>;
  defaultValue?: SettingsTabKey;
}

// Maps the legacy section/highlight ids to the tab they now live in.
const SECTION_TO_TAB: Record<string, SettingsTabKey> = {
  github: 'integrations',
  gitlab: 'integrations',
  'google-sheets': 'integrations',
  repository: 'general',
  features: 'general',
  storage: 'general',
  about: 'general',
  environment: 'general',
  schedules: 'cicd',
  'github-actions': 'cicd',
  'gitlab-pipelines': 'cicd',
  'diff-sensitivity': 'diff',
  playwright: 'playwright',
  'ai-settings': 'ai',
  ai: 'ai',
  'ai-logs': 'ai',
  'email-preferences': 'notifications',
  notifications: 'notifications',
  team: 'team',
  runners: 'team',
  'api-tokens': 'team',
  'test-migration': 'team',
  'danger-zone': 'account',
};

const TAB_ICONS: Record<SettingsTabKey, typeof SettingsIcon> = {
  general: SettingsIcon,
  integrations: Plug,
  cicd: GitBranch,
  diff: ImageIcon,
  playwright: TestTube,
  ai: Bot,
  notifications: Bell,
  team: Users,
  account: AlertTriangle,
};

function readInitialTab(defaultValue: SettingsTabKey): SettingsTabKey {
  if (typeof window === 'undefined') return defaultValue;
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('tab');
  const fromHash = url.hash.replace(/^#/, '');
  const fromHighlight = url.searchParams.get('highlight')?.split(',')[0];
  const candidate = fromQuery ?? fromHash ?? fromHighlight ?? '';
  if (isTabKey(candidate)) return candidate;
  if (candidate && SECTION_TO_TAB[candidate]) return SECTION_TO_TAB[candidate];
  return defaultValue;
}

function isTabKey(value: string): value is SettingsTabKey {
  return [
    'general',
    'integrations',
    'cicd',
    'diff',
    'playwright',
    'ai',
    'notifications',
    'team',
    'account',
  ].includes(value);
}

export function SettingsTabs({ tabs, defaultValue = 'general' }: SettingsTabsProps) {
  const router = useRouter();
  const visible = tabs.filter((t) => !t.hidden);
  const [active, setActive] = useState<SettingsTabKey>(() => {
    const initial = readInitialTab(defaultValue);
    return visible.some((t) => t.value === initial) ? initial : (visible[0]?.value ?? defaultValue);
  });

  // Sync the URL hash so the active tab survives reloads and is shareable.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.hash.replace(/^#/, '') !== active) {
      url.hash = active;
      router.replace(url.pathname + url.search + url.hash, { scroll: false });
    }
  }, [active, router]);

  // Listen for cross-component requests to switch tabs (used by highlighter).
  useEffect(() => {
    function onSwitch(e: Event) {
      const detail = (e as CustomEvent<{ tab: SettingsTabKey }>).detail;
      if (detail?.tab && isTabKey(detail.tab)) setActive(detail.tab);
    }
    window.addEventListener('lastest:settings-tab', onSwitch);
    return () => window.removeEventListener('lastest:settings-tab', onSwitch);
  }, []);

  return (
    <Tabs value={active} onValueChange={(v) => setActive(v as SettingsTabKey)} className="gap-6">
      <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">
        {visible.map((tab) => {
          const Icon = TAB_ICONS[tab.value];
          return (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5"
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      {visible.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="space-y-6 mt-0">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export { SECTION_TO_TAB };
