import { SetupPageClient } from "./setup-page-client";
import { AddRepoEmptyState } from "../tests/add-repo-empty-state";
import {
  getSelectedRepository,
  getRepositoriesByTeam,
  getPlaywrightSettings,
} from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";
import {
  getSetupScripts,
  getAvailableSetupTests,
} from "@/server/actions/setup-scripts";
import { getSetupConfigs } from "@/server/actions/setup-configs";
import { getDefaultSetupSteps } from "@/server/actions/setup-steps";
import { getDefaultTeardownSteps } from "@/server/actions/teardown-steps";
import { listStorageStates } from "@/server/actions/storage-states";

export default async function SetupPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId
    ? await getSelectedRepository(userId, teamId)
    : null;

  if (!selectedRepo) {
    const repos = teamId ? await getRepositoriesByTeam(teamId) : [];
    return (
      <div className="flex flex-col h-full">
        <AddRepoEmptyState hasRepos={repos.length > 0} />
      </div>
    );
  }

  const [
    setupScripts,
    setupConfigs,
    availableSetupTests,
    defaultSetupSteps,
    defaultTeardownSteps,
    storageStates,
    playwrightSettings,
  ] = await Promise.all([
    getSetupScripts(selectedRepo.id),
    getSetupConfigs(selectedRepo.id),
    getAvailableSetupTests(selectedRepo.id),
    getDefaultSetupSteps(selectedRepo.id),
    getDefaultTeardownSteps(selectedRepo.id),
    listStorageStates(selectedRepo.id),
    getPlaywrightSettings(selectedRepo.id),
  ]);

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <SetupPageClient
        repository={selectedRepo}
        setupScripts={setupScripts}
        setupConfigs={setupConfigs}
        availableSetupTests={availableSetupTests}
        defaultSetupSteps={defaultSetupSteps}
        defaultTeardownSteps={defaultTeardownSteps}
        storageStates={storageStates}
        designSystem={playwrightSettings?.designSystem ?? null}
        designSystemEnabled={!!playwrightSettings?.enableDesignSystem}
      />
    </div>
  );
}
