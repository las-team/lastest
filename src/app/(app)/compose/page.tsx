import { ComposeClient } from './compose-client';
import { getTestsWithVersions } from '@/server/actions/builds';
import { getSelectedRepository } from '@/lib/db/queries';
import { getLastBuildByBranch, getVisualDiffsWithTestStatus } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function ComposePage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const selectedRepo = teamId ? await getSelectedRepository(teamId) : null;

  if (!selectedRepo) {
    redirect('/');
  }

  const defaultBranch = selectedRepo.defaultBranch ?? 'main';

  const [testsWithVersions, mainBuild] = await Promise.all([
    getTestsWithVersions(selectedRepo.id),
    getLastBuildByBranch(selectedRepo.id, defaultBranch),
  ]);

  // If we found a main branch build, get its diffs
  const mainBuildDiffs = mainBuild
    ? await getVisualDiffsWithTestStatus(mainBuild.id)
    : [];

  return (
    <div className="flex flex-col h-full">
      <ComposeClient
        tests={testsWithVersions}
        repositoryId={selectedRepo.id}
        defaultBranch={defaultBranch}
        mainBuild={mainBuild ?? null}
        mainBuildDiffs={mainBuildDiffs}
      />
    </div>
  );
}
