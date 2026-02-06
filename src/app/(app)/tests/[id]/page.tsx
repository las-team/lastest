import { getTest, getTestResultsByTest, getSelectedRepository, getPlannedScreenshotsByTest, getDefaultSetupSteps, getTestsByRepo, getSetupScripts } from '@/lib/db/queries';
import { getTestScreenshotsGrouped } from '@/server/actions/tests';
import { getCurrentSession } from '@/lib/auth';
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

  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const results = await getTestResultsByTest(id);
  const selectedRepo = teamId ? await getSelectedRepository(teamId) : null;
  const repoId = test.repositoryId || selectedRepo?.id;
  const screenshotGroups = await getTestScreenshotsGrouped(id, repoId);
  const plannedScreenshots = await getPlannedScreenshotsByTest(id);

  // Load setup data
  const defaultSetupSteps = repoId ? await getDefaultSetupSteps(repoId) : [];
  const availableTests = repoId ? await getTestsByRepo(repoId) : [];
  const setupScripts = repoId ? await getSetupScripts(repoId) : [];

  return (
    <div className="flex flex-col h-full">
      <TestDetailClient
        test={test}
        results={results}
        repositoryId={repoId}
        screenshotGroups={screenshotGroups}
        plannedScreenshots={plannedScreenshots}
        defaultSetupSteps={defaultSetupSteps}
        availableTests={availableTests}
        availableScripts={setupScripts}
      />
    </div>
  );
}
