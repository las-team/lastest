import { AreasPageClient } from './areas-page-client';
import {
  getSelectedRepository,
  getFunctionalAreasTree,
  getTestsWithStatusByRepo,
  getUnsortedSuites,
  getSuiteTests,
} from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';

export default async function AreasPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const selectedRepo = teamId ? await getSelectedRepository(teamId) : null;

  if (!selectedRepo) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Select a repository first</p>
        </div>
      </div>
    );
  }

  const [tree, tests, unsortedSuitesList] = await Promise.all([
    getFunctionalAreasTree(selectedRepo.id),
    getTestsWithStatusByRepo(selectedRepo.id),
    getUnsortedSuites(selectedRepo.id),
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
    .map((t) => ({ id: t.id, name: t.name, latestStatus: t.latestStatus }));

  return (
    <div className="flex flex-col h-full">
      <AreasPageClient
        tree={tree}
        uncategorizedTests={uncategorizedTests}
        unsortedSuites={unsortedSuites}
        repositoryId={selectedRepo.id}
        selectedBranch={selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main'}
      />
    </div>
  );
}
