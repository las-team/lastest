import { notFound } from 'next/navigation';
import { getTest } from '@/lib/db/queries';
import { listTestRunsForCompare } from '@/server/actions/compare-runs';
import { CompareRunsClient } from './compare-runs-client';

interface CompareRunsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function CompareRunsPage({ params, searchParams }: CompareRunsPageProps) {
  const { id } = await params;
  const { from, to } = await searchParams;

  const test = await getTest(id);
  if (!test) notFound();

  // Auth + ownership is enforced inside listTestRunsForCompare. We pre-load
  // the candidate list here so the page can render synchronously and avoid a
  // client-side flash of "loading runs…" before the picker appears.
  const candidates = await listTestRunsForCompare(id);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <CompareRunsClient
        testId={id}
        testName={test.name}
        candidates={candidates}
        initialFromId={from ?? null}
        initialToId={to ?? null}
      />
    </div>
  );
}
