import { DefinitionPageClient } from "./definition-page-client";
import { AddRepoEmptyState } from "./add-repo-empty-state";
import {
  getSelectedRepository,
  getFunctionalAreasTree,
  getTestsWithStatusByRepo,
  getFunctionalAreasByRepo,
  getRoutesByRepo,
  getEnvironmentConfig,
  getDeletedTests,
  getRepositoriesByTeam,
} from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";

export default async function DefinitionPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const earlyAdopter = session?.team?.earlyAdopterMode ?? false;
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

  const [tree, tests, areas, routes, envConfig, deletedTests] =
    await Promise.all([
      getFunctionalAreasTree(selectedRepo.id),
      getTestsWithStatusByRepo(selectedRepo.id),
      getFunctionalAreasByRepo(selectedRepo.id),
      getRoutesByRepo(selectedRepo.id),
      getEnvironmentConfig(selectedRepo.id),
      getDeletedTests(selectedRepo.id),
    ]);

  const uncategorizedTests = tests
    .filter((t) => !t.functionalAreaId)
    .map((t) => ({
      id: t.id,
      name: t.name,
      specTitle: t.specTitle,
      latestStatus: t.latestStatus,
      isPlaceholder: t.isPlaceholder ?? false,
    }));

  const banAiMode = session?.team?.banAiMode ?? false;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <DefinitionPageClient
        tree={tree}
        uncategorizedTests={uncategorizedTests}
        repositoryId={selectedRepo.id}
        selectedBranch={
          selectedRepo.selectedBranch || selectedRepo.defaultBranch || "main"
        }
        banAiMode={banAiMode}
        earlyAdopterMode={earlyAdopter}
        areas={areas}
        tests={tests}
        routes={routes}
        baseUrl={envConfig.baseUrl}
        deletedTests={deletedTests}
      />
    </div>
  );
}
