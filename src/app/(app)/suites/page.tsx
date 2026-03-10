import { SuitesPageClient } from './suites-page-client';
import { getSuites, getSelectedRepository } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';

export default async function SuitesPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;
  const suites = selectedRepo ? await getSuites(selectedRepo.id) : [];

  return (
    <div className="flex flex-col h-full">
      <SuitesPageClient suites={suites} repositoryId={selectedRepo?.id} />
    </div>
  );
}
