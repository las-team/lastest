import { RunDashboardClient } from './run-dashboard-client';
import {
  getTests,
  getTestRuns,
  getSelectedRepository,
  getTestsByRepo,
  getTestRunsByRepo,
} from '@/lib/db/queries';
import { getBuilds, getBuildsByRepo, getLatestBuildChanges } from '@/server/actions/builds';
import { getEnvironmentConfig } from '@/server/actions/environment';

export default async function RunPage() {
  const selectedRepo = await getSelectedRepository();
  const activeBranch = selectedRepo?.selectedBranch || selectedRepo?.defaultBranch || 'main';

  const [tests, runs, builds, envConfig, buildChanges] = await Promise.all([
    selectedRepo ? getTestsByRepo(selectedRepo.id) : getTests(),
    selectedRepo ? getTestRunsByRepo(selectedRepo.id) : getTestRuns(),
    selectedRepo ? getBuildsByRepo(selectedRepo.id, 10) : getBuilds(10),
    getEnvironmentConfig(selectedRepo?.id),
    selectedRepo ? getLatestBuildChanges(selectedRepo.id) : null,
  ]);

  return (
    <div className="flex flex-col h-full">
      <RunDashboardClient
        tests={tests}
        runs={runs}
        builds={builds}
        repositoryId={selectedRepo?.id}
        activeBranch={activeBranch}
        baseUrl={envConfig?.baseUrl || 'http://localhost:3000'}
        buildChanges={buildChanges}
      />
    </div>
  );
}
