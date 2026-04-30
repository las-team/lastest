import { Suspense } from 'react';
import { getSelectedRepository, getRepositoriesByTeamWithTestCounts } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { MobileTopBar } from './mobile-top-bar-client';

export async function MobileTopBarServer() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;

  const [selectedRepo, repos] = await Promise.all([
    teamId && userId ? getSelectedRepository(userId, teamId) : Promise.resolve(null),
    teamId ? getRepositoriesByTeamWithTestCounts(teamId) : Promise.resolve([]),
  ]);

  return (
    <Suspense>
      <MobileTopBar repos={repos} selectedRepo={selectedRepo ?? null} />
    </Suspense>
  );
}
