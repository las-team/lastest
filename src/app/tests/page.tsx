import { TestsPageClient } from './tests-page-client';
import {
  getFunctionalAreas,
  getTestsWithStatus,
  getSelectedRepository,
  getFunctionalAreasByRepo,
  getTestsWithStatusByRepo,
  getRoutesByRepo,
  getEnvironmentConfig,
} from '@/lib/db/queries';

export default async function TestsPage() {
  const selectedRepo = await getSelectedRepository();

  let routes: Awaited<ReturnType<typeof getRoutesByRepo>> = [];

  const [areas, tests, envConfig] = await Promise.all([
    selectedRepo ? getFunctionalAreasByRepo(selectedRepo.id) : getFunctionalAreas(),
    selectedRepo ? getTestsWithStatusByRepo(selectedRepo.id) : getTestsWithStatus(),
    getEnvironmentConfig(selectedRepo?.id),
  ]);

  if (selectedRepo) {
    routes = await getRoutesByRepo(selectedRepo.id);
  }

  return (
    <div className="flex flex-col h-full">
      <TestsPageClient
        areas={areas}
        tests={tests}
        routes={routes}
        repositoryId={selectedRepo?.id}
        baseUrl={envConfig.baseUrl}
      />
    </div>
  );
}
