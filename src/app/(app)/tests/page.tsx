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

  const [tree, tests, areas, routes, envConfig, deletedTests] = await Promise.all([
    getFunctionalAreasTree(selectedRepo.id),
    getTestsWithStatusByRepo(selectedRepo.id),
    getFunctionalAreasByRepo(selectedRepo.id),
    getRoutesByRepo(selectedRepo.id),
    getEnvironmentConfig(selectedRepo.id),
    getDeletedTests(selectedRepo.id),
  ]);

  const uncategorizedTests = tests
    .filter((t) => !t.functionalAreaId)
    .map((t) => ({ id: t.id, name: t.name, description: t.description, latestStatus: t.latestStatus, isPlaceholder: t.isPlaceholder ?? false }));

  const banAiMode = session?.team?.banAiMode ?? false;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <DefinitionPageClient
        tree={tree}
        uncategorizedTests={uncategorizedTests}
        repositoryId={selectedRepo.id}
        selectedBranch={selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main'}
        banAiMode={banAiMode}
        earlyAdopterMode={earlyAdopter}
        areas={areas}
        tests={tests}
        routes={routes}
        baseUrl={envConfig.baseUrl}
        deletedTests={deletedTests}
      />
    </div>
  );
}
