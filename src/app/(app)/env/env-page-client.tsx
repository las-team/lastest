'use client';

import { ApiConfigList } from '@/components/setup/api-config-list';
import { SetupStepBuilder } from '@/components/setup/setup-step-builder';
import type { Repository, Test, SetupScript, SetupConfig } from '@/lib/db/schema';
import type { SetupStep } from '@/server/actions/setup-steps';

interface EnvPageClientProps {
  repository: Repository;
  setupScripts: SetupScript[];
  setupConfigs: SetupConfig[];
  availableTests: Test[];
  defaultSetupSteps: SetupStep[];
}

export function EnvPageClient({
  repository,
  setupScripts,
  setupConfigs,
  availableTests,
  defaultSetupSteps,
}: EnvPageClientProps) {
  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Environment Setup</h1>
          <p className="text-muted-foreground mt-1">
            Configure default setup steps for test preparation.
          </p>
        </div>

        {/* Section 1: Default Setup Steps */}
        <section>
          <SetupStepBuilder
            repositoryId={repository.id}
            setupSteps={defaultSetupSteps}
            availableTests={availableTests}
            availableScripts={setupScripts}
          />
        </section>

        {/* Section 2: API Configs */}
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
      </div>
    </div>
  );
}
