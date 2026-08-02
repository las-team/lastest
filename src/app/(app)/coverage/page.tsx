import { getCurrentSession } from "@/lib/auth";
import {
  getSelectedRepository,
  getRepositoriesByTeam,
  getCoverageCells,
  getCoverageDimensions,
  getCsvDataSources,
  getGoogleSheetsDataSources,
  getCoverageTrend,
} from "@/lib/db/queries";
import { getCoverageReport } from "@/lib/coverage/sync";
import { buildCoverageSpec } from "@/lib/coverage/spec";
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
    getCsvDataSources(selectedRepo.id),
    getGoogleSheetsDataSources(selectedRepo.id),
    getCoverageTrend(selectedRepo.id, { environmentKey: env, limit: 60 }),
  ]);

  // Resolved the same way profiling resolves them, so the disclosed sample
  // size is the one the numbers were actually computed from.
  const sourceSamples = await describeSources(csvSources, sheetSources);

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
        ...csvSources.map((s) => ({
          kind: "csv" as const,
          alias: s.alias,
          rows:
            sourceSamples.find((x) => x.objectType === s.alias)?.totalRows ??
            s.rowCount ??
            0,
          profiledRows:
            sourceSamples.find((x) => x.objectType === s.alias)?.profiledRows ??
            0,
          truncated:
            sourceSamples.find((x) => x.objectType === s.alias)?.truncated ??
            false,
          columns: s.cachedHeaders ?? [],
        })),
        ...sheetSources.map((s) => ({
          kind: "sheet" as const,
          alias: s.alias,
          rows: s.cachedData?.length ?? 0,
          profiledRows: s.cachedData?.length ?? 0,
          truncated: false,
          columns: s.cachedHeaders ?? [],
        })),
      ]}
    />
  );
}
