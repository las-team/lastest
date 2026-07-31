import { getCurrentSession } from "@/lib/auth";
import {
  getSelectedRepository,
  getRepositoriesByTeam,
  getCoverageCells,
  getCoverageDimensions,
  getCsvDataSources,
  getGoogleSheetsDataSources,
} from "@/lib/db/queries";
import { getCoverageReport } from "@/lib/coverage/sync";
import { buildCoverageSpec } from "@/lib/coverage/spec";
import { DEFAULT_COVERAGE_ENVIRONMENT } from "@/lib/db/schema";
import { AddRepoEmptyState } from "../tests/add-repo-empty-state";
import { CoverageClient } from "./coverage-client";

export const dynamic = "force-dynamic";

export default async function CoveragePage() {
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

  const env = DEFAULT_COVERAGE_ENVIRONMENT;
  const [{ report, stop }, cells, dimensions, csvSources, sheetSources] =
    await Promise.all([
      getCoverageReport(selectedRepo.id, { environmentKey: env }),
      getCoverageCells(selectedRepo.id, { environmentKey: env }),
      getCoverageDimensions(selectedRepo.id, env),
      getCsvDataSources(selectedRepo.id),
      getGoogleSheetsDataSources(selectedRepo.id),
    ]);

  const spec = buildCoverageSpec({
    repositoryId: selectedRepo.id,
    environmentKey: env,
    report,
    stop,
    cells,
    dimensions,
  });

  return (
    <CoverageClient
      repositoryId={selectedRepo.id}
      environmentKey={env}
      spec={spec}
      stop={{
        shouldStop: stop.shouldStop,
        reasons: stop.reasons,
        metrics: stop.metrics,
        explanation: stop.explanation,
      }}
      dimensions={dimensions}
      sources={[
        ...csvSources.map((s) => ({
          kind: "csv" as const,
          alias: s.alias,
          rows: s.cachedData?.length ?? 0,
          columns: s.cachedHeaders ?? [],
        })),
        ...sheetSources.map((s) => ({
          kind: "sheet" as const,
          alias: s.alias,
          rows: s.cachedData?.length ?? 0,
          columns: s.cachedHeaders ?? [],
        })),
      ]}
    />
  );
}
