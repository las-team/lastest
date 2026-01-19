import { Header } from '@/components/layout/header';
import { getSelectedRepository, getTestRunsByRepo } from '@/lib/db/queries';
import { RepoClient } from './repo-client';

export default async function RepoPage() {
  const selectedRepo = (await getSelectedRepository()) ?? null;

  let testRuns: Awaited<ReturnType<typeof getTestRunsByRepo>> = [];
  if (selectedRepo) {
    testRuns = await getTestRunsByRepo(selectedRepo.id);
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
        />
      </div>
    </div>
  );
}
