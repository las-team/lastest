import { Header } from '@/components/layout/header';
import { SuitesPageClient } from './suites-page-client';
import { getSuites, getSelectedRepository } from '@/lib/db/queries';

export default async function SuitesPage() {
  const selectedRepo = await getSelectedRepository();
  const suites = await getSuites(selectedRepo?.id);

  return (
    <div className="flex flex-col h-full">
      <Header title="Suites" />
      <SuitesPageClient suites={suites} repositoryId={selectedRepo?.id} />
    </div>
  );
}
