import { Header } from '@/components/layout/header';
import { TestsPageClient } from './tests-page-client';
import { getFunctionalAreas, getTestsWithStatus } from '@/lib/db/queries';

export default async function TestsPage() {
  const [areas, tests] = await Promise.all([
    getFunctionalAreas(),
    getTestsWithStatus(),
  ]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Tests" />
      <TestsPageClient areas={areas} tests={tests} />
    </div>
  );
}
