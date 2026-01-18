import { Header } from '@/components/layout/header';
import { RunDetailClient } from './run-detail-client';
import { getTestRun, getTestResultsByRun, getTest } from '@/lib/db/queries';
import { notFound } from 'next/navigation';

interface RunDetailPageProps {
  params: Promise<{ runId: string }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;
  const run = await getTestRun(runId);

  if (!run) {
    notFound();
  }

  const results = await getTestResultsByRun(runId);

  // Get test names for results
  const resultsWithTests = await Promise.all(
    results.map(async (result) => {
      const test = result.testId ? await getTest(result.testId) : null;
      return {
        ...result,
        testName: test?.name || 'Unknown',
      };
    })
  );

  return (
    <div className="flex flex-col h-full">
      <Header title={`Run #${run.id.slice(0, 8)}`} />
      <RunDetailClient run={run} results={resultsWithTests} />
    </div>
  );
}
