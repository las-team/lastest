import { getTest, getSelectedRepository } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { DebugClient } from './debug-client';

interface DebugPageProps {
  params: Promise<{ id: string }>;
}

export default async function DebugPage({ params }: DebugPageProps) {
  const { id } = await params;
  const test = await getTest(id);

  if (!test) {
    notFound();
  }

  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;
  const repositoryId = test.repositoryId || selectedRepo?.id || null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DebugClient
        test={test}
        repositoryId={repositoryId}
      />
    </div>
  );
}
