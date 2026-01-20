import { Header } from '@/components/layout/header';
import { RecordingClient } from './recording-client';
import { getFunctionalAreas, getPlaywrightSettings, getSelectedRepository } from '@/lib/db/queries';

export default async function RecordPage() {
  const areas = await getFunctionalAreas();
  const selectedRepo = await getSelectedRepository();
  const settings = await getPlaywrightSettings(selectedRepo?.id);

  return (
    <div className="flex flex-col h-full">
      <Header title="Record Test" />
      <RecordingClient
        areas={areas}
        settings={settings}
        repositoryId={selectedRepo?.id}
      />
    </div>
  );
}
