'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Code2, Compass, FileText, Telescope, Video } from 'lucide-react';
import type { FunctionalArea, PlaywrightSettings, RecordingEngine, Test } from '@/lib/db/schema';
import { RecordingClient } from './recording-client';
import { ExploreUrlPanel } from './panels/explore-url-panel';
import { AutoExplorePanel } from './panels/auto-explore-panel';
import { SpecPanel } from './panels/spec-panel';
import { ImportCodePanel } from './panels/import-code-panel';

type TabKey = 'record' | 'explore' | 'auto' | 'spec' | 'import';
const TAB_KEYS: TabKey[] = ['record', 'explore', 'auto', 'spec', 'import'];

type RecordingStep = 'setup' | 'recording' | 'saving';

interface SetupStepInfo {
  id: string;
  stepType: 'test' | 'script';
  testId: string | null;
  scriptId: string | null;
  name: string;
}

interface TestCreationTabsProps {
  areas: FunctionalArea[];
  settings: PlaywrightSettings;
  repositoryId?: string | null;
  defaultBaseUrl?: string;
  enabledEngines?: RecordingEngine[];
  defaultEngine?: RecordingEngine;
  rerecordTest?: Test | null;
  repositorySetupSteps?: SetupStepInfo[];
  availableTests?: { id: string; name: string }[];
  availableScripts?: { id: string; name: string }[];
}

export function TestCreationTabs(props: TestCreationTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rerecording = !!props.rerecordTest;
  const [recordingStep, setRecordingStep] = useState<RecordingStep>('setup');
  const hideTabBar = recordingStep === 'recording';

  const activeTab = useMemo<TabKey>(() => {
    if (rerecording) return 'record';
    const mode = searchParams.get('mode');
    return (TAB_KEYS as string[]).includes(mode ?? '') ? (mode as TabKey) : 'record';
  }, [searchParams, rerecording]);

  const handleTabChange = useCallback(
    (value: string) => {
      if (rerecording) return;
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'record') params.delete('mode');
      else params.set('mode', value);
      const qs = params.toString();
      router.replace(qs ? `/record?${qs}` : '/record');
    },
    [router, searchParams, rerecording],
  );

  const repoId = props.repositoryId ?? undefined;
  const baseUrl = props.defaultBaseUrl ?? '';

  const triggerClass =
    'flex-1 px-6 text-sm gap-1.5 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm';

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="flex flex-col flex-1 overflow-hidden"
    >
      <div
        className="px-6 pt-4 pb-0 shrink-0 flex justify-center data-[hidden=true]:hidden"
        data-hidden={hideTabBar}
      >
        <TabsList className="h-11 w-full max-w-5xl p-1 bg-white dark:bg-zinc-950 border">
          <TabsTrigger value="record" className={triggerClass}>
            <Video className="h-3.5 w-3.5" />
            Record
          </TabsTrigger>
          <TabsTrigger value="explore" disabled={rerecording} className={triggerClass}>
            <Compass className="h-3.5 w-3.5" />
            Explore (URL)
          </TabsTrigger>
          <TabsTrigger value="auto" disabled={rerecording} className={triggerClass}>
            <Telescope className="h-3.5 w-3.5" />
            Auto-Explore
          </TabsTrigger>
          <TabsTrigger value="spec" disabled={rerecording} className={triggerClass}>
            <FileText className="h-3.5 w-3.5" />
            Spec
          </TabsTrigger>
          <TabsTrigger value="import" disabled={rerecording} className={triggerClass}>
            <Code2 className="h-3.5 w-3.5" />
            Import code
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="record" className="overflow-auto flex-1 flex flex-col">
        <RecordingClient
          areas={props.areas}
          settings={props.settings}
          repositoryId={props.repositoryId}
          defaultBaseUrl={props.defaultBaseUrl}
          enabledEngines={props.enabledEngines}
          defaultEngine={props.defaultEngine}
          rerecordTest={props.rerecordTest}
          repositorySetupSteps={props.repositorySetupSteps}
          availableTests={props.availableTests}
          availableScripts={props.availableScripts}
          onStepChange={setRecordingStep}
        />
      </TabsContent>

      <TabsContent value="explore" className="overflow-auto flex-1 flex flex-col">
        <ExploreUrlPanel repositoryId={repoId} areas={props.areas} defaultBaseUrl={baseUrl} />
      </TabsContent>

      <TabsContent value="auto" className="overflow-auto flex-1 flex flex-col">
        <AutoExplorePanel repositoryId={repoId} defaultBaseUrl={baseUrl} />
      </TabsContent>

      <TabsContent value="spec" className="overflow-auto flex-1 flex flex-col">
        <SpecPanel repositoryId={repoId} />
      </TabsContent>

      <TabsContent value="import" className="overflow-auto flex-1 flex flex-col">
        <ImportCodePanel repositoryId={repoId} areas={props.areas} defaultBaseUrl={baseUrl} />
      </TabsContent>
    </Tabs>
  );
}
