import * as queries from '@/lib/db/queries';
import { EnvPageClient } from './env-page-client';
import { getSetupScripts, getAvailableSetupTests } from '@/server/actions/setup-scripts';
import { getSetupConfigs } from '@/server/actions/setup-configs';

export default async function EnvPage() {
  const selectedRepo = await queries.getSelectedRepository();

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

  const [setupScripts, setupConfigs, availableTests] = await Promise.all([
    getSetupScripts(selectedRepo.id),
    getSetupConfigs(selectedRepo.id),
    getAvailableSetupTests(selectedRepo.id),
  ]);

  return (
    <EnvPageClient
      repository={selectedRepo}
      setupScripts={setupScripts}
      setupConfigs={setupConfigs}
      availableTests={availableTests}
    />
  );
}
