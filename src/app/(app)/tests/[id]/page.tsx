import { getTest, getTestResultsByTest, getSelectedRepository, getPlannedScreenshotsByTest } from '@/lib/db/queries';
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
  const plannedScreenshots = await getPlannedScreenshotsByTest(id);

  return (
    <div className="flex flex-col h-full">
      <TestDetailClient
        test={test}
        results={results}
        repositoryId={repoId}
        screenshotGroups={screenshotGroups}
        plannedScreenshots={plannedScreenshots}
      />
    </div>
  );
}
