import * as queries from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { EnvPageClient } from './env-page-client';
import { getSetupScripts, getAvailableSetupTests } from '@/server/actions/setup-scripts';
import { getSetupConfigs } from '@/server/actions/setup-configs';
import { getDefaultSetupSteps } from '@/server/actions/setup-steps';
import { getDefaultTeardownSteps } from '@/server/actions/teardown-steps';

export default async function EnvPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const selectedRepo = teamId ? await queries.getSelectedRepository(teamId) : null;

  if (!selectedRepo) {
    return (
      <div className="flex-1 p-6">
        <div className="max-w-2xl mx-auto text-center py-12">
          <h2 className="text-lg font-semibold">No Repository Selected</h2>
          <p className="text-muted-foreground mt-2">
            Select a repository from the sidebar to manage environment setup.
          </p>
        </div>
      </div>
    );
  }

  const [setupScripts, setupConfigs, availableTests, defaultSetupSteps, defaultTeardownSteps] = await Promise.all([
    getSetupScripts(selectedRepo.id),
    getSetupConfigs(selectedRepo.id),
    getAvailableSetupTests(selectedRepo.id),
    getDefaultSetupSteps(selectedRepo.id),
    getDefaultTeardownSteps(selectedRepo.id),
  ]);

  return (
    <EnvPageClient
      repository={selectedRepo}
      setupScripts={setupScripts}
      setupConfigs={setupConfigs}
      availableTests={availableTests}
      defaultSetupSteps={defaultSetupSteps}
      defaultTeardownSteps={defaultTeardownSteps}
    />
  );
}
