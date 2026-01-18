import { Header } from '@/components/layout/header';
import { CompareClient } from './compare-client';
import { getBranches } from '@/lib/git/utils';
import { getTestRuns } from '@/lib/db/queries';

export default async function ComparePage() {
  const [branches, runs] = await Promise.all([
    getBranches(),
    getTestRuns(),
  ]);

  return (
    <div className="flex flex-col h-full">
      <Header title="Compare Branches" />
      <CompareClient branches={branches} runs={runs} />
    </div>
  );
}
