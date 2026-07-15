import { AppMapClient } from "./app-map-client";
import { AddRepoEmptyState } from "../tests/add-repo-empty-state";
import { getSelectedRepository, getRepositoriesByTeam } from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";
import { getAppMap, getActiveExploration } from "@/server/actions/app-map";
import { hasQaAgentAccess } from "@/lib/billing/feature-access";
import { planConfig } from "@/lib/billing/plans";

export default async function AppMapPage() {
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

  const qaAgentEnabled = session?.team
    ? hasQaAgentAccess(session.team.plan)
    : false;
  const [result, activeExploration] = await Promise.all([
    getAppMap(),
    qaAgentEnabled ? getActiveExploration() : Promise.resolve(null),
  ]);
  const maxExplorers = session?.team
    ? Math.max(1, planConfig(session.team.plan).maxExplorers)
    : 1;
  const branch =
    selectedRepo.selectedBranch || selectedRepo.defaultBranch || "main";

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <AppMapClient
        initialGraph={result.ok ? result.graph : null}
        emptyReason={result.ok ? null : result.reason}
        repositoryId={selectedRepo.id}
        branch={branch}
        qaAgentEnabled={qaAgentEnabled}
        maxExplorers={maxExplorers}
        activeExploration={activeExploration}
      />
    </div>
  );
}
