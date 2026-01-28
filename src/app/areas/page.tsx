import { Header } from '@/components/layout/header';
import { AreasPageClient } from './areas-page-client';
import {
  getSelectedRepository,
  getFunctionalAreasTree,
  getTestsWithStatusByRepo,
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

  const [tree, tests] = await Promise.all([
    getFunctionalAreasTree(selectedRepo.id),
    getTestsWithStatusByRepo(selectedRepo.id),
  ]);

  const uncategorizedTests = tests
    .filter((t) => !t.functionalAreaId)
    .map((t) => ({ id: t.id, name: t.name, latestStatus: t.latestStatus }));

  return (
    <div className="flex flex-col h-full">
      <Header title="Areas" />
      <AreasPageClient
        tree={tree}
        uncategorizedTests={uncategorizedTests}
        repositoryId={selectedRepo.id}
      />
    </div>
  );
}
