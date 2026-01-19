import { Header } from '@/components/layout/header';
import { RunDashboardClient } from './run-dashboard-client';
import {
  getTests,
  getTestRuns,
  getSelectedRepository,
  getTestsByRepo,
  getTestRunsByRepo,
} from '@/lib/db/queries';

export default async function RunPage() {
  const selectedRepo = await getSelectedRepository();

  const [tests, runs] = await Promise.all([
    selectedRepo ? getTestsByRepo(selectedRepo.id) : getTests(),
    selectedRepo ? getTestRunsByRepo(selectedRepo.id) : getTestRuns(),
  ]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Test Runs" />
      <RunDashboardClient tests={tests} runs={runs} />
    </div>
  );
}
