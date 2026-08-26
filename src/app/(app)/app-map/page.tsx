import AppMapPage from "@lastest/plugin-app-map/page";

import { AddRepoEmptyState } from "../tests/add-repo-empty-state";
import { getSelectedRepository, getRepositoriesByTeam } from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";
import { hasQaAgentAccess } from "@/lib/billing/feature-access";
import { isBillingEnabled } from "@/lib/billing/enabled";
import { planConfig } from "@/lib/billing/plans";
import { getPluginRuntime } from "@/lib/core/runtime";
import { ExploreProgressPanel } from "./explore-progress-panel";
import { cancelExploration } from "./cancel-exploration";

/**
 * The app half of the `/app-map` route.
 *
 * The render is entirely `@lastest/plugin-app-map`; what is left here is the
 * composition, and each thing passed down is something the plugin should not
 * be able to reach on its own:
 *
 * - **repository selection** is per-user state on core tables;
 * - **the plan gates** (`qaAgentEnabled`, `maxExplorers`) are billing;
 * - **`ExploreProgressPanel`** renders a live QA-agent session inside core's
 *   EB stream viewer — another plugin plus a core component;
 * - **`cancelExploration`** is qa-agent's server action.
 *
 * The `no-repo` empty state stays here too. The plugin's actions now take a
 * `repositoryId`, so "there is no repository" is a state that has to be
 * resolved before the plugin is called at all — which is why
 * `GetAppMapResult` lost its `"no-repo"` variant in the move.
 */
export default async function AppMapRoute() {
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

  // The plugin's action modules are dispatched directly by Next, so the runtime
  // is normally wired at boot (`src/instrumentation.ts`). Awaiting it here too
  // makes the page resilient to a boot-time failure that has since resolved —
  // it is memoized, so the second call is free.
  await getPluginRuntime();

  const qaAgentEnabled = session?.team
    ? hasQaAgentAccess(session.team.plan, isBillingEnabled())
    : false;
  const maxExplorers = session?.team
    ? Math.max(1, planConfig(session.team.plan).maxExplorers)
    : 1;
  const branch =
    selectedRepo.selectedBranch || selectedRepo.defaultBranch || "main";

  return (
    <AppMapPage
      repositoryId={selectedRepo.id}
      branch={branch}
      qaAgentEnabled={qaAgentEnabled}
      maxExplorers={maxExplorers}
      exploreProgressPanel={ExploreProgressPanel}
      onCancelExploration={cancelExploration}
    />
  );
}
