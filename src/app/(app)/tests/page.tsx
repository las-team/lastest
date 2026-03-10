import { TestsPageClient } from './tests-page-client';
import {
  getSelectedRepository,
  getFunctionalAreasByRepo,
  getTestsWithStatusByRepo,
  getRoutesByRepo,
  getEnvironmentConfig,
  getDeletedTests,
} from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';

export default async function TestsPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;

  const [areas, tests, envConfig, routes, deletedTests] = await Promise.all([
    selectedRepo ? getFunctionalAreasByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getTestsWithStatusByRepo(selectedRepo.id) : Promise.resolve([]),
    getEnvironmentConfig(selectedRepo?.id),
    selectedRepo ? getRoutesByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getDeletedTests(selectedRepo.id) : Promise.resolve([]),
  ]);

  const banAiMode = session?.team?.banAiMode ?? false;

  return (
    <div className="flex flex-col h-full">
      <TestsPageClient
        areas={areas}
        tests={tests}
        routes={routes}
        repositoryId={selectedRepo?.id}
        baseUrl={envConfig.baseUrl}
        deletedTests={deletedTests}
        banAiMode={banAiMode}
      />
    </div>
  );
}
