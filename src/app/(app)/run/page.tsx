import { RunDashboardClient } from './run-dashboard-client';
import {
  getSelectedRepository,
  getTestsByRepo,
  getTestRunsByRepo,
  getComposeConfig,
} from '@/lib/db/queries';
import { getBuildsByRepo, getLatestBuildChanges } from '@/server/actions/builds';
import { getEnvironmentConfig } from '@/server/actions/environment';
import { getCurrentSession } from '@/lib/auth';

export default async function RunPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const selectedRepo = teamId ? await getSelectedRepository(teamId) : null;
  const activeBranch = selectedRepo?.selectedBranch || selectedRepo?.defaultBranch || 'main';

  const [tests, runs, builds, envConfig, buildChanges, composeConfig] = await Promise.all([
    selectedRepo ? getTestsByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getTestRunsByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getBuildsByRepo(selectedRepo.id, 25) : Promise.resolve([]),
    getEnvironmentConfig(selectedRepo?.id),
    selectedRepo ? getLatestBuildChanges(selectedRepo.id) : null,
    selectedRepo ? getComposeConfig(selectedRepo.id, activeBranch) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col h-full">
      <RunDashboardClient
        tests={tests}
        runs={runs}
        builds={builds}
        repositoryId={selectedRepo?.id}
        activeBranch={activeBranch}
        currentBranch={selectedRepo?.selectedBranch ?? null}
        defaultBranch={selectedRepo?.defaultBranch ?? null}
        baseUrl={envConfig?.baseUrl || 'http://localhost:3000'}
        buildChanges={buildChanges}
        composeConfig={composeConfig ? {
          selectedTestIds: composeConfig.selectedTestIds ?? null,
          versionOverrides: composeConfig.versionOverrides ?? null,
        } : null}
      />
    </div>
  );
}
