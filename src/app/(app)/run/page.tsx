import { RunDashboardClient } from './run-dashboard-client';
import {
  getSelectedRepository,
  getTestsByRepo,
  getTestRunsByRepo,
  getComposeConfig,
  getReviewTodosByBranch,
  getLastBuildByBranch,
  getVisualDiffsWithTestStatus,
} from '@/lib/db/queries';
import { getBuildsByRepo } from '@/server/actions/builds';
import { getEnvironmentConfig } from '@/server/actions/environment';
import { fetchRepoBranches } from '@/server/actions/repos';
import { getCurrentSession } from '@/lib/auth';

export default async function RunPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;
  const activeBranch = selectedRepo?.selectedBranch || selectedRepo?.defaultBranch || 'main';

  const [tests, runs, builds, envConfig, composeConfig, repoBranches, initialTodos, latestBuild] = await Promise.all([
    selectedRepo ? getTestsByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getTestRunsByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getBuildsByRepo(selectedRepo.id, 25) : Promise.resolve([]),
    getEnvironmentConfig(selectedRepo?.id),
    selectedRepo ? getComposeConfig(selectedRepo.id, activeBranch) : Promise.resolve(null),
    selectedRepo ? fetchRepoBranches(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getReviewTodosByBranch(selectedRepo.id, activeBranch) : Promise.resolve([]),
    selectedRepo ? getLastBuildByBranch(selectedRepo.id, activeBranch) : Promise.resolve(null),
  ]);

  const latestBuildId = latestBuild?.id ?? null;
  const initialDiffs = latestBuildId ? await getVisualDiffsWithTestStatus(latestBuildId) : [];

  // Map branch name → latest commit SHA for graph "ahead" indicators
  const branchHeads: Record<string, string> = {};
  for (const b of repoBranches) {
    branchHeads[b.name] = b.commit.sha;
  }

  const banAiMode = session?.team?.banAiMode ?? false;

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
        baseUrl={selectedRepo?.branchBaseUrls?.[activeBranch] ?? envConfig?.baseUrl ?? 'http://localhost:3000'}
        branchHeads={branchHeads}
        initialTodos={initialTodos}
        initialDiffs={initialDiffs}
        latestBuildId={latestBuildId}
        composeConfig={composeConfig ? {
          selectedTestIds: composeConfig.excludedTestIds
            ? tests.map(t => t.id).filter(id => !composeConfig.excludedTestIds!.includes(id))
            : composeConfig.selectedTestIds ?? null,
          versionOverrides: composeConfig.versionOverrides ?? null,
        } : null}
        banAiMode={banAiMode}
        comparisonRunEnabled={selectedRepo?.comparisonRunEnabled ?? false}
        comparisonBaselineBranch={selectedRepo?.comparisonBaselineBranch ?? null}
        branches={repoBranches.map(b => b.name)}
        branchBaseUrls={selectedRepo?.branchBaseUrls ?? null}
      />
    </div>
  );
}
