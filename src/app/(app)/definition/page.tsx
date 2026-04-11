import { DefinitionPageClient } from './definition-page-client';
import {
  getSelectedRepository,
  getFunctionalAreasTree,
  getTestsWithStatusByRepo,
  getUnsortedSuites,
  getSuiteTests,
  getSpecsByRepo,
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

  const [tree, tests, unsortedSuitesList, allSpecs, areas, routes, envConfig, deletedTests] = await Promise.all([
    getFunctionalAreasTree(selectedRepo.id),
    getTestsWithStatusByRepo(selectedRepo.id),
    getUnsortedSuites(selectedRepo.id),
    getSpecsByRepo(selectedRepo.id),
    getFunctionalAreasByRepo(selectedRepo.id),
    getRoutesByRepo(selectedRepo.id),
    getEnvironmentConfig(selectedRepo.id),
    getDeletedTests(selectedRepo.id),
  ]);

  // Get test counts for unsorted suites
  const unsortedSuites = await Promise.all(
    unsortedSuitesList.map(async (suite) => {
      const suiteTestList = await getSuiteTests(suite.id);
      return {
        id: suite.id,
        name: suite.name,
        description: suite.description,
        testCount: suiteTestList.length,
      };
    })
  );

  const uncategorizedTests = tests
    .filter((t) => !t.functionalAreaId)
    .map((t) => ({ id: t.id, name: t.name, description: t.description, latestStatus: t.latestStatus, isPlaceholder: t.isPlaceholder ?? false }));

  const banAiMode = session?.team?.banAiMode ?? false;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <DefinitionPageClient
        tree={tree}
        uncategorizedTests={uncategorizedTests}
        unsortedSuites={unsortedSuites}
        repositoryId={selectedRepo.id}
        selectedBranch={selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main'}
        banAiMode={banAiMode}
        allSpecs={allSpecs}
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
