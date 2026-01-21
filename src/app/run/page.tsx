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
import { getGitInfo } from '@/lib/git/utils';

export default async function RunPage() {
  const selectedRepo = await getSelectedRepository();
  const gitInfo = await getGitInfo();

  const [tests, runs, builds] = await Promise.all([
    selectedRepo ? getTestsByRepo(selectedRepo.id) : getTests(),
    selectedRepo ? getTestRunsByRepo(selectedRepo.id) : getTestRuns(),
    selectedRepo ? getBuildsByRepo(selectedRepo.id, 10) : getBuilds(10),
  ]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Test Runs" />
      <RunDashboardClient
        tests={tests}
        runs={runs}
        builds={builds}
        repositoryId={selectedRepo?.id}
        activeBranch={gitInfo.branch}
      />
    </div>
  );
}
