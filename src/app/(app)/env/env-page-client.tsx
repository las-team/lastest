'use client';

import { ApiConfigList } from '@/components/setup/api-config-list';
import { SetupStepBuilder } from '@/components/setup/setup-step-builder';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  addDefaultTeardownStep,
  removeDefaultTeardownStep,
  reorderDefaultTeardownSteps,
} from '@/server/actions/teardown-steps';
import type { Repository, Test, SetupScript, SetupConfig } from '@/lib/db/schema';
import type { SetupStep } from '@/server/actions/setup-steps';
import type { TeardownStep } from '@/server/actions/teardown-steps';

interface EnvPageClientProps {
  repository: Repository;
  setupScripts: SetupScript[];
  setupConfigs: SetupConfig[];
  availableTests: Test[];
  defaultSetupSteps: SetupStep[];
  defaultTeardownSteps: TeardownStep[];
}

export function EnvPageClient({
  repository,
  setupScripts,
  setupConfigs,
  availableTests,
  defaultSetupSteps,
  defaultTeardownSteps,
}: EnvPageClientProps) {
  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Environment Setup</h1>
          <p className="text-muted-foreground mt-1">
            Configure setup and teardown steps for test preparation and cleanup.
          </p>
        </div>

        <Tabs defaultValue="setup">
          <TabsList className="h-11 w-full p-1">
            <TabsTrigger value="setup" className="flex-1 px-6 text-sm">
              Setup
            </TabsTrigger>
            <TabsTrigger value="teardown" className="flex-1 px-6 text-sm">
              Teardown
            </TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="space-y-8 mt-6">
            {/* Default Setup Steps */}
            <section>
              <SetupStepBuilder
                repositoryId={repository.id}
                setupSteps={defaultSetupSteps}
                availableTests={availableTests}
                availableScripts={setupScripts}
              />
            </section>

            {/* API Configs */}
            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-medium">API Configurations</h2>
                <p className="text-sm text-muted-foreground">
                  Configure API endpoints for data seeding scripts.
                </p>
              </div>
              <ApiConfigList
                repositoryId={repository.id}
                configs={setupConfigs}
              />
            </section>
          </TabsContent>

          <TabsContent value="teardown" className="space-y-8 mt-6">
            <section>
              <SetupStepBuilder
                repositoryId={repository.id}
                setupSteps={defaultTeardownSteps}
                availableTests={availableTests}
                availableScripts={setupScripts}
                onAddStep={addDefaultTeardownStep}
                onRemoveStep={removeDefaultTeardownStep}
                onReorderSteps={reorderDefaultTeardownSteps}
                title="Default Teardown Steps"
                description="Configure the default teardown sequence that runs after each test for cleanup."
              />
            </section>

            {/* API Configs (shared) */}
            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-medium">API Configurations</h2>
                <p className="text-sm text-muted-foreground">
                  Configure API endpoints for data seeding scripts.
                </p>
              </div>
              <ApiConfigList
                repositoryId={repository.id}
                configs={setupConfigs}
              />
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
