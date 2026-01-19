import { Header } from '@/components/layout/header';
import { TestsPageClient } from './tests-page-client';
import {
  getFunctionalAreas,
  getTestsWithStatus,
  getSelectedRepository,
  getFunctionalAreasByRepo,
  getTestsWithStatusByRepo,
} from '@/lib/db/queries';

export default async function TestsPage() {
  const selectedRepo = await getSelectedRepository();

  const [areas, tests] = await Promise.all([
    selectedRepo ? getFunctionalAreasByRepo(selectedRepo.id) : getFunctionalAreas(),
    selectedRepo ? getTestsWithStatusByRepo(selectedRepo.id) : getTestsWithStatus(),
  ]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Tests" />
      <TestsPageClient areas={areas} tests={tests} />
    </div>
  );
}
