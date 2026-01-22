import { Header } from '@/components/layout/header';
import { CompareClient } from './compare-client';
import { getTestRuns, getSelectedRepository, getTestRunsByRepo } from '@/lib/db/queries';
import { fetchRepoBranches } from '@/server/actions/repos';

export default async function ComparePage() {
  const selectedRepo = await getSelectedRepository();

  let branches: string[] = [];
  let runs: Awaited<ReturnType<typeof getTestRuns>> = [];
  let defaultBaseline: string | null = null;
  let activeBranch = 'main';

  if (selectedRepo) {
    // Use GitHub API branches for selected repo
    const ghBranches = await fetchRepoBranches(selectedRepo.id);
    branches = ghBranches.map(b => b.name);
    runs = await getTestRunsByRepo(selectedRepo.id);
    defaultBaseline = selectedRepo.selectedBaseline || selectedRepo.defaultBranch;
    activeBranch = selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main';
  } else {
    // No repo selected - use empty state
    branches = [];
    runs = await getTestRuns();
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Compare Branches" />
      <CompareClient
        branches={branches}
        runs={runs}
        defaultBaseline={defaultBaseline}
        repositoryId={selectedRepo?.id}
        activeBranch={activeBranch}
      />
    </div>
  );
}
