import { RecordingClient } from './recording-client';
import { getFunctionalAreasByRepo, getPlaywrightSettings, getSelectedRepository, getEnvironmentConfig, getTest, getSetupScript } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import type { RecordingEngine } from '@/lib/db/schema';

interface RecordPageProps {
  searchParams: Promise<{ rerecordId?: string }>;
}

export default async function RecordPage({ searchParams }: RecordPageProps) {
  const params = await searchParams;
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const selectedRepo = teamId ? await getSelectedRepository(teamId) : null;
  const areas = selectedRepo ? await getFunctionalAreasByRepo(selectedRepo.id) : [];
  const settings = await getPlaywrightSettings(selectedRepo?.id);
  const envConfig = await getEnvironmentConfig(selectedRepo?.id);

  // Fetch test data if re-recording
  const rerecordTest = params.rerecordId ? await getTest(params.rerecordId) : null;

  // Resolve repository setup configuration
  let repositorySetup: { type: 'test' | 'script' | 'none'; name?: string; id?: string } = { type: 'none' };
  if (selectedRepo?.defaultSetupTestId) {
    const setupTest = await getTest(selectedRepo.defaultSetupTestId);
    if (setupTest) {
      repositorySetup = { type: 'test', name: setupTest.name, id: setupTest.id };
    }
  } else if (selectedRepo?.defaultSetupScriptId) {
    const setupScript = await getSetupScript(selectedRepo.defaultSetupScriptId);
    if (setupScript) {
      repositorySetup = { type: 'script', name: setupScript.name, id: setupScript.id };
    }
  }

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
        repositorySetup={repositorySetup}
      />
    </div>
  );
}
