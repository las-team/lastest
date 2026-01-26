import { Header } from '@/components/layout/header';
import { getTest, getTestResultsByTest, getSelectedRepository } from '@/lib/db/queries';
import { getTestScreenshotsGrouped } from '@/server/actions/tests';
import { TestDetailClient } from './test-detail-client';
import { notFound } from 'next/navigation';

interface TestDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TestDetailPage({ params }: TestDetailPageProps) {
  const { id } = await params;
  const test = await getTest(id);

  if (!test) {
    notFound();
  }

  const results = await getTestResultsByTest(id);
  const selectedRepo = await getSelectedRepository();
  const repoId = test.repositoryId || selectedRepo?.id;
  const screenshotGroups = await getTestScreenshotsGrouped(id, repoId);

  return (
    <div className="flex flex-col h-full">
      <Header title={test.name} />
      <TestDetailClient
        test={test}
        results={results}
        repositoryId={repoId}
        screenshotGroups={screenshotGroups}
      />
    </div>
  );
}
