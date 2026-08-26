import { getCurrentSession } from "@/lib/auth";
import {
  getSelectedRepository,
  getRepositoriesByTeam,
  getCoverageCells,
  getCoverageDimensions,
  getCoverageTrend,
} from "@/lib/db/queries";
import {
  csvDataSourceTablesForRepo,
  sheetDataSourceTablesForRepo,
} from "@/lib/core/data-sources-reads";
import { getCoverageReport } from "@/lib/coverage/sync";
import { buildCoverageSpec } from "@lastest/coverage-model";
import { describeSources } from "@/lib/coverage/source-rows";
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
  const [
    { report, stop },
    cells,
    dimensions,
    csvSources,
    sheetSources,
    snapshots,
  ] = await Promise.all([
    getCoverageReport(selectedRepo.id, { environmentKey: env }),
    getCoverageCells(selectedRepo.id, { environmentKey: env }),
    getCoverageDimensions(selectedRepo.id, env),
    csvDataSourceTablesForRepo(selectedRepo.id),
    sheetDataSourceTablesForRepo(selectedRepo.id),
    getCoverageTrend(selectedRepo.id, { environmentKey: env, limit: 60 }),
  ]);

  // Resolved the same way profiling resolves them, so the disclosed sample
  // size is the one the numbers were actually computed from.
  const sourceSamples = describeSources([...csvSources, ...sheetSources]);

  const spec = buildCoverageSpec({
    repositoryId: selectedRepo.id,
    environmentKey: env,
    report,
    stop,
    cells,
    dimensions,
    sources: sourceSamples,
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
      trend={snapshots.map((s) => ({
        capturedAt: s.capturedAt.toISOString(),
        buildId: s.buildId,
        source: s.source,
        totalCells: s.totalCells,
        coveredCells: s.coveredCells,
        excludedCells: s.excludedCells,
        failingCells: s.failingCells,
        cellCoverage: s.cellCoverage,
        tupleCoverage: s.tupleCoverage,
        weightedVolumeCoverage: s.weightedVolumeCoverage,
      }))}
      sources={[
        ...csvSources.map((t) => ({
          kind: "csv" as const,
          alias: t.alias,
          rows: t.totalRows,
          profiledRows: t.profiledRows,
          truncated: t.truncated,
          columns: t.headers,
        })),
        ...sheetSources.map((t) => ({
          kind: "sheet" as const,
          alias: t.alias,
          rows: t.totalRows,
          profiledRows: t.profiledRows,
          truncated: t.truncated,
          columns: t.headers,
        })),
      ]}
    />
  );
}
