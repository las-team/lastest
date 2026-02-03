import { RecordingClient } from './recording-client';
import { getFunctionalAreas, getPlaywrightSettings, getSelectedRepository, getEnvironmentConfig, getTest } from '@/lib/db/queries';
import type { RecordingEngine } from '@/lib/db/schema';

interface RecordPageProps {
  searchParams: Promise<{ rerecordId?: string }>;
}

export default async function RecordPage({ searchParams }: RecordPageProps) {
  const params = await searchParams;
  const areas = await getFunctionalAreas();
  const selectedRepo = await getSelectedRepository();
  const settings = await getPlaywrightSettings(selectedRepo?.id);
  const envConfig = await getEnvironmentConfig(selectedRepo?.id);

  // Fetch test data if re-recording
  const rerecordTest = params.rerecordId ? await getTest(params.rerecordId) : null;

  return (
    <div className="flex flex-col h-full">
      <RecordingClient
        areas={areas}
        settings={settings}
        repositoryId={selectedRepo?.id}
        defaultBaseUrl={rerecordTest?.targetUrl || envConfig.baseUrl}
        enabledEngines={settings.enabledRecordingEngines as RecordingEngine[]}
        defaultEngine={settings.defaultRecordingEngine as RecordingEngine}
        rerecordTest={rerecordTest}
      />
    </div>
  );
}
