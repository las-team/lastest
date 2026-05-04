import { DefinitionPageClient } from './definition-page-client';
import {
  getSelectedRepository,
  getFunctionalAreasTree,
  getTestsWithStatusByRepo,
  getFunctionalAreasByRepo,
  getRoutesByRepo,
  getEnvironmentConfig,
  getDeletedTests,
} from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { getSetupScripts, getAvailableSetupTests } from '@/server/actions/setup-scripts';
import { getSetupConfigs } from '@/server/actions/setup-configs';
import { getDefaultSetupSteps } from '@/server/actions/setup-steps';
import { getDefaultTeardownSteps } from '@/server/actions/teardown-steps';
import { listStorageStates } from '@/server/actions/storage-states';

export default async function DefinitionPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const earlyAdopter = session?.team?.earlyAdopterMode ?? false;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;

  if (!selectedRepo) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Select a repository first</p>
        </div>
      </div>
    );
  }

  const [
    tree,
    tests,
    areas,
    routes,
    envConfig,
    deletedTests,
    setupScripts,
    setupConfigs,
    availableSetupTests,
    defaultSetupSteps,
    defaultTeardownSteps,
    storageStates,
  ] = await Promise.all([
    getFunctionalAreasTree(selectedRepo.id),
    getTestsWithStatusByRepo(selectedRepo.id),
    getFunctionalAreasByRepo(selectedRepo.id),
    getRoutesByRepo(selectedRepo.id),
    getEnvironmentConfig(selectedRepo.id),
    getDeletedTests(selectedRepo.id),
    getSetupScripts(selectedRepo.id),
    getSetupConfigs(selectedRepo.id),
    getAvailableSetupTests(selectedRepo.id),
    getDefaultSetupSteps(selectedRepo.id),
    getDefaultTeardownSteps(selectedRepo.id),
    listStorageStates(selectedRepo.id),
  ]);

  const uncategorizedTests = tests
    .filter((t) => !t.functionalAreaId)
    .map((t) => ({ id: t.id, name: t.name, specTitle: t.specTitle, latestStatus: t.latestStatus, isPlaceholder: t.isPlaceholder ?? false }));

  const banAiMode = session?.team?.banAiMode ?? false;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <DefinitionPageClient
        tree={tree}
        uncategorizedTests={uncategorizedTests}
        repository={selectedRepo}
        repositoryId={selectedRepo.id}
        selectedBranch={selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main'}
        banAiMode={banAiMode}
        earlyAdopterMode={earlyAdopter}
        areas={areas}
        tests={tests}
        routes={routes}
        baseUrl={envConfig.baseUrl}
        deletedTests={deletedTests}
        setupScripts={setupScripts}
        setupConfigs={setupConfigs}
        availableSetupTests={availableSetupTests}
        defaultSetupSteps={defaultSetupSteps}
        defaultTeardownSteps={defaultTeardownSteps}
        storageStates={storageStates}
      />
    </div>
  );
}
