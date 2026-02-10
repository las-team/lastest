import { ComposeClient } from './compose-client';
import { getTestsWithVersions } from '@/server/actions/builds';
import { getEnvironmentConfig } from '@/server/actions/environment';
import { getSelectedRepository } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function ComposePage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const selectedRepo = teamId ? await getSelectedRepository(teamId) : null;

  if (!selectedRepo) {
    redirect('/run');
  }

  const [testsWithVersions, envConfig] = await Promise.all([
    getTestsWithVersions(selectedRepo.id),
    getEnvironmentConfig(selectedRepo.id),
  ]);

  return (
    <div className="flex flex-col h-full">
      <ComposeClient
        tests={testsWithVersions}
        repositoryId={selectedRepo.id}
        baseUrl={envConfig?.baseUrl || 'http://localhost:3000'}
        currentBranch={selectedRepo.selectedBranch ?? null}
        defaultBranch={selectedRepo.defaultBranch ?? null}
      />
    </div>
  );
}
