import { Header } from '@/components/layout/header';
import { getSelectedRepository, getTestRunsByRepo, getRoutesByRepo, getRouteCoverageStats, getScanStatus } from '@/lib/db/queries';
import { RepoClient } from './repo-client';

export default async function RepoPage() {
  const selectedRepo = (await getSelectedRepository()) ?? null;

  let testRuns: Awaited<ReturnType<typeof getTestRunsByRepo>> = [];
  let routes: Awaited<ReturnType<typeof getRoutesByRepo>> = [];
  let coverage = { total: 0, withTests: 0, percentage: 0 };
  let scanStatusData: Awaited<ReturnType<typeof getScanStatus>> = undefined;

  if (selectedRepo) {
    [testRuns, routes, coverage, scanStatusData] = await Promise.all([
      getTestRunsByRepo(selectedRepo.id),
      getRoutesByRepo(selectedRepo.id),
      getRouteCoverageStats(selectedRepo.id),
      getScanStatus(selectedRepo.id),
    ]);
  }

  // Build branch -> hasTests map
  const branchTestStatus: Record<string, boolean> = {};
  for (const run of testRuns) {
    branchTestStatus[run.gitBranch] = true;
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Repository Overview" />
      <div className="flex-1 p-6">
        <RepoClient
          repository={selectedRepo}
          branchTestStatus={branchTestStatus}
          routes={routes}
          coverage={coverage}
          scanStatus={scanStatusData}
        />
      </div>
    </div>
  );
}
