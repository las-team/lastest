'use client';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ApiConfigList } from '@/components/setup/api-config-list';
import { DesignSystemBundleUpload } from '@/components/setup/design-system-bundle-upload';
import { SetupStepBuilder } from '@/components/setup/setup-step-builder';
import { addDefaultTeardownStep, removeDefaultTeardownStep, reorderDefaultTeardownSteps } from '@/server/actions/teardown-steps';
import type { Test, Repository, SetupScript, SetupConfig, StorageState, DesignSystemConfig } from '@/lib/db/schema';
import type { SetupStep } from '@/server/actions/setup-steps';
import type { TeardownStep } from '@/server/actions/teardown-steps';

interface SetupPageClientProps {
  repository: Repository;
  setupScripts: SetupScript[];
  setupConfigs: SetupConfig[];
  availableSetupTests: Test[];
  defaultSetupSteps: SetupStep[];
  defaultTeardownSteps: TeardownStep[];
  storageStates: StorageState[];
  designSystem: DesignSystemConfig | null;
  designSystemEnabled: boolean;
}

export function SetupPageClient({
  repository,
  setupScripts,
  setupConfigs,
  availableSetupTests,
  defaultSetupSteps,
  defaultTeardownSteps,
  storageStates,
  designSystem,
  designSystemEnabled,
}: SetupPageClientProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="overflow-auto flex-1">
        <div className="p-6 pt-4">
          <div className="max-w-5xl space-y-6">
            <p className="text-sm text-muted-foreground">
              Configure seed and teardown steps for test preparation and cleanup.
            </p>
            <Tabs defaultValue="seed-setup">
              <TabsList className="h-11 w-full p-1 bg-white dark:bg-zinc-950 border">
                <TabsTrigger value="seed-setup" className="flex-1 px-6 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">
                  Seed
                </TabsTrigger>
                <TabsTrigger value="seed-teardown" className="flex-1 px-6 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">
                  Teardown
                </TabsTrigger>
              </TabsList>

              <TabsContent value="seed-setup" className="space-y-8 mt-6">
                <section>
                  <SetupStepBuilder
                    repositoryId={repository.id}
                    setupSteps={defaultSetupSteps}
                    availableTests={availableSetupTests}
                    availableScripts={setupScripts}
                    availableStorageStates={storageStates}
                  />
                </section>

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
                  <DesignSystemBundleUpload
                    repositoryId={repository.id}
                    config={designSystem}
                    enabled={designSystemEnabled}
                    repoName={repository.name ?? undefined}
                  />
                </section>
              </TabsContent>

              <TabsContent value="seed-teardown" className="space-y-8 mt-6">
                <section>
                  <SetupStepBuilder
                    repositoryId={repository.id}
                    setupSteps={defaultTeardownSteps}
                    availableTests={availableSetupTests}
                    availableScripts={setupScripts}
                    onAddStep={addDefaultTeardownStep}
                    onRemoveStep={removeDefaultTeardownStep}
                    onReorderSteps={reorderDefaultTeardownSteps}
                    title="Default Teardown Steps"
                    description="Configure the default teardown sequence that runs after each test for cleanup."
                  />
                </section>

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
      </div>
    </div>
  );
}
