import { ReviewClient } from './review-client';
import {
  getSelectedRepository,
  getReviewTodosByBranch,
  getLastBuildByBranch,
  getVisualDiffsWithTestStatus,
} from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;

  const activeBranch = selectedRepo?.selectedBranch || selectedRepo?.defaultBranch || 'main';

  let initialTodos: Awaited<ReturnType<typeof getReviewTodosByBranch>> = [];
  let initialDiffs: Awaited<ReturnType<typeof getVisualDiffsWithTestStatus>> = [];
  let latestBuildId: string | null = null;

  if (selectedRepo) {
    const [todos, latestBuild] = await Promise.all([
      getReviewTodosByBranch(selectedRepo.id, activeBranch),
      getLastBuildByBranch(selectedRepo.id, activeBranch),
    ]);
    initialTodos = todos;
    if (latestBuild) {
      latestBuildId = latestBuild.id;
      initialDiffs = await getVisualDiffsWithTestStatus(latestBuild.id);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ReviewClient
        repositoryId={selectedRepo?.id || null}
        currentBranch={selectedRepo?.selectedBranch ?? null}
        defaultBranch={selectedRepo?.defaultBranch ?? null}
        initialTodos={initialTodos}
        initialDiffs={initialDiffs}
        latestBuildId={latestBuildId}
      />
    </div>
  );
}
