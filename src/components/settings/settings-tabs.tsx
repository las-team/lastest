"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Settings as SettingsIcon,
  Plug,
  TestTube,
  Bot,
  User,
} from "lucide-react";

export type SettingsTabKey =
  | "general"
  | "integrations"
  | "testing"
  | "ai"
  | "account";

export interface SettingsTabsProps {
  tabs: Array<{
    value: SettingsTabKey;
    label: string;
    /** Optional: hide the tab entirely (e.g., account tab when no user) */
    hidden?: boolean;
    content: ReactNode;
  }>;
  defaultValue?: SettingsTabKey;
}

// Maps the legacy section/highlight ids to the tab they now live in.
const SECTION_TO_TAB: Record<string, SettingsTabKey> = {
  repository: "general",
  features: "general",
  about: "general",
  github: "integrations",
  gitlab: "integrations",
  "google-sheets": "integrations",
  schedules: "integrations",
  "github-actions": "integrations",
  "gitlab-pipelines": "integrations",
  cicd: "integrations",
  "diff-sensitivity": "testing",
  diff: "testing",
  playwright: "testing",
  "ai-settings": "ai",
  ai: "ai",
  "ai-logs": "ai",
  "ban-ai": "ai",
  "email-preferences": "account",
  notifications: "account",
  team: "account",
  storage: "account",
  runners: "account",
  "api-tokens": "account",
  "test-migration": "account",
  "danger-zone": "account",
};

const TAB_ICONS: Record<SettingsTabKey, typeof SettingsIcon> = {
  general: SettingsIcon,
  integrations: Plug,
  testing: TestTube,
  ai: Bot,
  account: User,
};

const TAB_ORDER: SettingsTabKey[] = [
  "general",
  "integrations",
  "testing",
  "ai",
  "account",
];

function readInitialTab(defaultValue: SettingsTabKey): SettingsTabKey {
  if (typeof window === "undefined") return defaultValue;
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("tab");
  const fromHash = url.hash.replace(/^#/, "");
  const fromHighlight = url.searchParams.get("highlight")?.split(",")[0];
  const candidate = fromQuery ?? fromHash ?? fromHighlight ?? "";
  if (isTabKey(candidate)) return candidate;
  if (candidate && SECTION_TO_TAB[candidate]) return SECTION_TO_TAB[candidate];
  return defaultValue;
}

function isTabKey(value: string): value is SettingsTabKey {
  return TAB_ORDER.includes(value as SettingsTabKey);
}

export function SettingsTabs({
  tabs,
  defaultValue = "general",
}: SettingsTabsProps) {
  const router = useRouter();
  const visible = tabs.filter((t) => !t.hidden);
  // Start with defaultValue on both server and client so SSR matches CSR.
  // The URL-derived tab (?tab=, #hash, ?highlight=) is applied after mount.
  const initialDefault: SettingsTabKey = visible.some(
    (t) => t.value === defaultValue,
  )
    ? defaultValue
    : (visible[0]?.value ?? defaultValue);
  const [active, setActive] = useState<SettingsTabKey>(initialDefault);

  // Pick up URL-derived tab after hydration to avoid SSR/CSR mismatch.
  useEffect(() => {
    const fromUrl = readInitialTab(initialDefault);
    if (fromUrl !== active && visible.some((t) => t.value === fromUrl)) {
      setActive(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the URL hash so the active tab survives reloads and is shareable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.hash.replace(/^#/, "") !== active) {
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
    window.addEventListener("lastest:settings-tab", onSwitch);
    return () => window.removeEventListener("lastest:settings-tab", onSwitch);
  }, []);

  return (
    <Tabs
      value={active}
      onValueChange={(v) => setActive(v as SettingsTabKey)}
      className="gap-6"
    >
      <TabsList className="h-11 w-full max-w-5xl p-1 bg-white dark:bg-zinc-950 border">
        {visible.map((tab) => {
          const Icon = TAB_ICONS[tab.value];
          return (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex-1 px-2 md:px-6 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm"
            >
              <Icon />
              <span>{tab.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      {visible.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="space-y-6 mt-0"
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export { SECTION_TO_TAB };
