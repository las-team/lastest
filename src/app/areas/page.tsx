import { Header } from '@/components/layout/header';
import { AreasPageClient } from './areas-page-client';
import {
  getSelectedRepository,
  getFunctionalAreasTree,
  getTestsWithStatusByRepo,
  getUnsortedSuites,
  getSuiteTests,
} from '@/lib/db/queries';

export default async function AreasPage() {
  const selectedRepo = await getSelectedRepository();

  if (!selectedRepo) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Areas" />
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
      <Header title="Areas" />
      <AreasPageClient
        tree={tree}
        uncategorizedTests={uncategorizedTests}
        unsortedSuites={unsortedSuites}
        repositoryId={selectedRepo.id}
      />
    </div>
  );
}
