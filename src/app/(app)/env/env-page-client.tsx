'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SetupScriptList } from '@/components/setup/setup-script-list';
import { ApiConfigList } from '@/components/setup/api-config-list';
import { DefaultSetupCard } from '@/components/setup/default-setup-card';
import type { Repository, Test, SetupScript, SetupConfig } from '@/lib/db/schema';

interface EnvPageClientProps {
  repository: Repository;
  setupScripts: SetupScript[];
  setupConfigs: SetupConfig[];
  availableTests: Test[];
}

export function EnvPageClient({
  repository,
  setupScripts,
  setupConfigs,
  availableTests,
}: EnvPageClientProps) {
  const [activeTab, setActiveTab] = useState('scripts');

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Environment Setup</h1>
          <p className="text-muted-foreground mt-1">
            Configure setup scripts and API configurations for test preparation.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="scripts">Scripts</TabsTrigger>
            <TabsTrigger value="configs">API Configs</TabsTrigger>
            <TabsTrigger value="defaults">Defaults</TabsTrigger>
          </TabsList>

          <TabsContent value="scripts" className="mt-4">
            <SetupScriptList
              repositoryId={repository.id}
              scripts={setupScripts}
            />
          </TabsContent>

          <TabsContent value="configs" className="mt-4">
            <ApiConfigList
              repositoryId={repository.id}
              configs={setupConfigs}
            />
          </TabsContent>

          <TabsContent value="defaults" className="mt-4">
            <DefaultSetupCard
              repository={repository}
              setupScripts={setupScripts}
              availableTests={availableTests}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
