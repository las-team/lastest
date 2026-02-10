import { ComposeClient } from './compose-client';
import { getTestsWithVersions } from '@/server/actions/builds';
import { getSelectedRepository, getLastBuildByBranch, getBuildTestSummaries } from '@/lib/db/queries';
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

  const mainBuildTests = mainBuild
    ? await getBuildTestSummaries(mainBuild.id)
    : [];

  return (
    <div className="flex flex-col h-full">
      <ComposeClient
        tests={testsWithVersions}
        defaultBranch={defaultBranch}
        mainBuild={mainBuild ?? null}
        mainBuildTests={mainBuildTests}
      />
    </div>
  );
}
