import { RecordingClient } from './recording-client';
import { getFunctionalAreasByRepo, getPlaywrightSettings, getSelectedRepository, getEnvironmentConfig, getTest, getDefaultSetupSteps, getTestsByRepo, getSetupScripts } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import type { RecordingEngine } from '@/lib/db/schema';

interface RecordPageProps {
  searchParams: Promise<{ rerecordId?: string }>;
}

export default async function RecordPage({ searchParams }: RecordPageProps) {
  const params = await searchParams;
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;
  const areas = selectedRepo ? await getFunctionalAreasByRepo(selectedRepo.id) : [];
  const settings = await getPlaywrightSettings(selectedRepo?.id);
  const envConfig = await getEnvironmentConfig(selectedRepo?.id);

  // Fetch test data if re-recording
  const rerecordTest = params.rerecordId ? await getTest(params.rerecordId) : null;

  // Resolve repository setup configuration (multi-step system)
  const [defaultSteps, availableTestsRaw, availableScriptsRaw] = await Promise.all([
    selectedRepo ? getDefaultSetupSteps(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getTestsByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getSetupScripts(selectedRepo.id) : Promise.resolve([]),
  ]);
  const repositorySetupSteps = defaultSteps.map(s => ({
    id: s.id,
    stepType: s.stepType as 'test' | 'script',
    testId: s.testId,
    scriptId: s.scriptId,
    name: s.testName || s.scriptName || 'Unknown',
  }));
  const availableTests = availableTestsRaw.map(t => ({ id: t.id, name: t.name }));
  const availableScripts = availableScriptsRaw.map(s => ({ id: s.id, name: s.name }));

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
        repositorySetupSteps={repositorySetupSteps}
        availableTests={availableTests}
        availableScripts={availableScripts}
      />
    </div>
  );
}
