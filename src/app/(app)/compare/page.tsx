import { CompareClient } from './compare-client';
import { getSelectedRepository, getTestRunsByRepo } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { fetchRepoBranches } from '@/server/actions/repos';

export default async function ComparePage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const selectedRepo = teamId ? await getSelectedRepository(teamId) : null;

  let branches: string[] = [];
  let runs: Awaited<ReturnType<typeof getTestRunsByRepo>> = [];
  let defaultBaseline: string | null = null;
  let activeBranch = 'main';

  if (selectedRepo) {
    const ghBranches = await fetchRepoBranches(selectedRepo.id);
    branches = ghBranches.map(b => b.name);
    runs = await getTestRunsByRepo(selectedRepo.id);
    defaultBaseline = selectedRepo.selectedBaseline || selectedRepo.defaultBranch;
    activeBranch = selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main';
  }

  return (
    <div className="flex flex-col h-full">
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
