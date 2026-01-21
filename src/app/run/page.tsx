import { Header } from '@/components/layout/header';
import { RunDashboardClient } from './run-dashboard-client';
import {
  getTests,
  getTestRuns,
  getSelectedRepository,
  getTestsByRepo,
  getTestRunsByRepo,
} from '@/lib/db/queries';
import { getBuilds } from '@/server/actions/builds';

export default async function RunPage() {
  const selectedRepo = await getSelectedRepository();

  const [tests, runs, builds] = await Promise.all([
    selectedRepo ? getTestsByRepo(selectedRepo.id) : getTests(),
    selectedRepo ? getTestRunsByRepo(selectedRepo.id) : getTestRuns(),
    getBuilds(10),
  ]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Test Runs" />
      <RunDashboardClient tests={tests} runs={runs} builds={builds} repositoryId={selectedRepo?.id} />
    </div>
  );
}
