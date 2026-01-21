import { Header } from '@/components/layout/header';
import { TestsPageClient } from './tests-page-client';
import {
  getFunctionalAreas,
  getTestsWithStatus,
  getSelectedRepository,
  getFunctionalAreasByRepo,
  getTestsWithStatusByRepo,
  getRoutesByRepo,
  getRouteCoverageStats,
  getEnvironmentConfig,
} from '@/lib/db/queries';

export default async function TestsPage() {
  const selectedRepo = await getSelectedRepository();

  let routes: Awaited<ReturnType<typeof getRoutesByRepo>> = [];
  let coverage = { total: 0, withTests: 0, percentage: 0 };

  const [areas, tests, envConfig] = await Promise.all([
    selectedRepo ? getFunctionalAreasByRepo(selectedRepo.id) : getFunctionalAreas(),
    selectedRepo ? getTestsWithStatusByRepo(selectedRepo.id) : getTestsWithStatus(),
    getEnvironmentConfig(selectedRepo?.id),
  ]);

  if (selectedRepo) {
    [routes, coverage] = await Promise.all([
      getRoutesByRepo(selectedRepo.id),
      getRouteCoverageStats(selectedRepo.id),
    ]);
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Tests" />
      <TestsPageClient
        areas={areas}
        tests={tests}
        routes={routes}
        coverage={coverage}
        repositoryId={selectedRepo?.id}
        baseUrl={envConfig.baseUrl}
      />
    </div>
  );
}
