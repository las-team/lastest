import { Header } from '@/components/layout/header';
import { RunDashboardClient } from './run-dashboard-client';
import { getTests, getTestRuns } from '@/lib/db/queries';

export default async function RunPage() {
  const [tests, runs] = await Promise.all([
    getTests(),
    getTestRuns(),
  ]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Test Runs" />
      <RunDashboardClient tests={tests} runs={runs} />
    </div>
  );
}
