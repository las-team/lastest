import { notFound } from 'next/navigation';
import { SuiteDetailClient } from './suite-detail-client';
import {
  getSuiteWithTests,
  getTestsWithStatusByRepo,
  getFunctionalAreasByRepo,
  getSelectedRepository,
} from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import type { FunctionalArea } from '@/lib/db/schema';

interface Props {
  params: Promise<{ suiteId: string }>;
}

interface TestWithStatus {
  id: string;
  name: string;
  code: string;
  targetUrl: string | null;
  functionalAreaId: string | null;
  latestStatus: string | null;
  area: FunctionalArea | null;
}

export default async function SuiteDetailPage({ params }: Props) {
  const { suiteId } = await params;
  const suite = await getSuiteWithTests(suiteId);

  if (!suite) {
    notFound();
  }

  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const selectedRepo = teamId ? await getSelectedRepository(teamId) : null;
  const repositoryId = suite.repositoryId || selectedRepo?.id;

  const [testsRaw, areas] = await Promise.all([
    repositoryId ? getTestsWithStatusByRepo(repositoryId) : [],
    repositoryId ? getFunctionalAreasByRepo(repositoryId) : [],
  ]);

  // Normalize the tests to match expected interface
  const tests: TestWithStatus[] = testsRaw.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    targetUrl: t.targetUrl,
    functionalAreaId: t.functionalAreaId,
    latestStatus: t.latestStatus,
    area: t.area ?? null,
  }));

  return (
    <div className="flex flex-col h-full">
      <SuiteDetailClient
        suite={suite}
        availableTests={tests}
        areas={areas}
      />
    </div>
  );
}
