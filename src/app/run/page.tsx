import { Header } from '@/components/layout/header';
import { RunDashboardClient } from './run-dashboard-client';
import {
  getTests,
  getTestRuns,
  getSelectedRepository,
  getTestsByRepo,
  getTestRunsByRepo,
} from '@/lib/db/queries';
import { getBuilds, getBuildsByRepo } from '@/server/actions/builds';
import { getEnvironmentConfig } from '@/server/actions/environment';

export default async function RunPage() {
  const selectedRepo = await getSelectedRepository();
  const activeBranch = selectedRepo?.selectedBranch || selectedRepo?.defaultBranch || 'main';

  const [tests, runs, builds, envConfig] = await Promise.all([
    selectedRepo ? getTestsByRepo(selectedRepo.id) : getTests(),
    selectedRepo ? getTestRunsByRepo(selectedRepo.id) : getTestRuns(),
    selectedRepo ? getBuildsByRepo(selectedRepo.id, 10) : getBuilds(10),
    getEnvironmentConfig(selectedRepo?.id),
  ]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Test Runs" />
      <RunDashboardClient
        tests={tests}
        runs={runs}
        builds={builds}
        repositoryId={selectedRepo?.id}
        activeBranch={activeBranch}
        baseUrl={envConfig?.baseUrl || 'http://localhost:3000'}
      />
    </div>
  );
}
