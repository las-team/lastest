import { AppMapClient } from "./app-map-client";
import { AddRepoEmptyState } from "../tests/add-repo-empty-state";
import { getSelectedRepository, getRepositoriesByTeam } from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";
import { getAppMap } from "@/server/actions/app-map";
import { hasQaAgentAccess } from "@/lib/billing/feature-access";

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

  const result = await getAppMap();
  const qaAgentEnabled = session?.team
    ? hasQaAgentAccess(session.team.plan)
    : false;
  const branch =
    selectedRepo.selectedBranch || selectedRepo.defaultBranch || "main";

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <AppMapClient
        initialGraph={result.ok ? result.graph : null}
        emptyReason={result.ok ? null : result.reason}
        branch={branch}
        qaAgentEnabled={qaAgentEnabled}
      />
    </div>
  );
}
