import { RecordingClient } from './recording-client';
import { getFunctionalAreas, getPlaywrightSettings, getSelectedRepository, getEnvironmentConfig } from '@/lib/db/queries';
import type { RecordingEngine } from '@/lib/db/schema';

export default async function RecordPage() {
  const areas = await getFunctionalAreas();
  const selectedRepo = await getSelectedRepository();
  const settings = await getPlaywrightSettings(selectedRepo?.id);
  const envConfig = await getEnvironmentConfig(selectedRepo?.id);

  return (
    <div className="flex flex-col h-full">
      <RecordingClient
        areas={areas}
        settings={settings}
        repositoryId={selectedRepo?.id}
        defaultBaseUrl={envConfig.baseUrl}
        enabledEngines={settings.enabledRecordingEngines as RecordingEngine[]}
        defaultEngine={settings.defaultRecordingEngine as RecordingEngine}
      />
    </div>
  );
}
