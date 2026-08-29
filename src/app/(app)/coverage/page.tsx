import AppMapPage from "@lastest/plugin-app-map/page";

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
import { coverageReportFrom } from "@/lib/coverage/sync";
import { buildPageCoverageAttribution } from "@/lib/coverage/page-attribution";
import { buildCoverageSpec } from "@lastest/coverage-model";
import { describeSources } from "@/lib/coverage/source-rows";
import { DEFAULT_COVERAGE_ENVIRONMENT } from "@/lib/db/schema";
import { hasQaAgentAccess } from "@/lib/billing/feature-access";
import { isBillingEnabled } from "@/lib/billing/enabled";
import { planConfig } from "@/lib/billing/plans";
import { getPluginRuntime } from "@/lib/core/runtime";
import { AddRepoEmptyState } from "../tests/add-repo-empty-state";
import { ExploreProgressPanel } from "../app-map/explore-progress-panel";
import { cancelExploration } from "../app-map/cancel-exploration";
import { CoverageClient } from "./coverage-client";
import {
  CoverageDataProvider,
  type CoverageRailData,
} from "./coverage-context";
import { CoverageRail } from "./coverage-rail";

export const dynamic = "force-dynamic";

/**
 * Coverage — one screen for both halves of "what is covered?".
 *
 * The App Map and the data-coverage model were two tabs answering the same
 * question about different axes: which *pages* have been exercised, and which
 * *data combinations* have. Keeping them apart meant neither could answer the
 * question people actually ask — "which screen is this gap on?" — and it meant
 * two nav entries for one idea.
 *
 * So the map is the screen (canvas first: it is the surface people navigate by)
 * and the data space is the rail beside it, scoped to whatever page is
 * selected. The two heavy data views keep full width as peer tabs.
 *
 * The composition is the point of this file: the App Map is a plugin, coverage
 * is core, and neither may import the other. The plugin gets the coverage
 * surfaces as opaque slots — a rendered node for each tab, a component for the
 * rail — and never sees a coverage type. `/app-map` now redirects here.
 */
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

  // The plugin's action modules are dispatched directly by Next, so the runtime
  // is normally wired at boot (`src/instrumentation.ts`). Awaiting it here too
  // makes the page resilient to a boot-time failure that has since resolved —
  // it is memoized, so the second call is free.
  await getPluginRuntime();

  const env = DEFAULT_COVERAGE_ENVIRONMENT;
  // Cells and dimensions are read ONCE and the report is derived from them.
  // `getCoverageReport` reads both itself, so calling it alongside the two
  // reads meant two full scans of each table on every render of a
  // force-dynamic page — the largest tables in this feature, fetched twice for
  // nothing.
  const [cells, dimensions, csvSources, sheetSources, snapshots, pageCoverage] =
    await Promise.all([
      getCoverageCells(selectedRepo.id, { environmentKey: env }),
      getCoverageDimensions(selectedRepo.id, env),
      csvDataSourceTablesForRepo(selectedRepo.id),
      sheetDataSourceTablesForRepo(selectedRepo.id),
      getCoverageTrend(selectedRepo.id, { environmentKey: env, limit: 60 }),
      buildPageCoverageAttribution(selectedRepo.id, { environmentKey: env }),
    ]);
  const { report, stop } = coverageReportFrom({
    repositoryId: selectedRepo.id,
    environmentKey: env,
    cells,
    dimensions,
  });

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

  const stopSummary = {
    shouldStop: stop.shouldStop,
    reasons: stop.reasons,
    metrics: stop.metrics,
    explanation: stop.explanation,
  };
  const trend = snapshots.map((s) => ({
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
  }));
  const sources = [
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
  ];

  const objectTypeByCoordsKey = new Map(
    spec.sections.flatMap((sec) =>
      sec.cells.map((c) => [c.coordsKey, sec.objectType] as const),
    ),
  );

  const railData: CoverageRailData = {
    repositoryId: selectedRepo.id,
    environmentKey: env,
    hasModel: spec.sections.length > 0,
    strength: spec.acceptance.strength,
    tupleCoverage: stop.metrics.tupleCoverage,
    pairwiseTarget: spec.acceptance.pairwiseTarget,
    weightedVolumeCoverage: stop.metrics.weightedVolumeCoverage,
    weightedVolumeTarget: spec.acceptance.weightedVolumeTarget,
    coveredCells: stop.metrics.coveredCells,
    eligibleCells: stop.metrics.eligibleCells,
    excludedCells: stop.metrics.excludedCells,
    skippedAsNonOccurring: spec.scope.skippedAsNonOccurring,
    totalRecords: spec.sections.reduce((a, s) => a + s.totals.totalRecords, 0),
    dimensions: spec.sections.flatMap((sec) =>
      sec.dimensions.map((d) => ({
        objectType: sec.objectType,
        field: d.field,
        values: d.values.map((v) => ({
          value: v.value,
          covered: v.covered,
          recordCount: v.recordCount,
        })),
      })),
    ),
    outstanding: spec.outstanding.map((c) => ({
      cellId: c.id,
      coordsKey: c.coordsKey,
      objectType: objectTypeByCoordsKey.get(c.coordsKey) ?? "",
      coords: c.coords,
      observedCount: c.observedCount,
      weight: c.weight,
    })),
    pageCoverage,
  };

  const qaAgentEnabled = session?.team
    ? hasQaAgentAccess(session.team.plan, isBillingEnabled())
    : false;
  const maxExplorers = session?.team
    ? Math.max(1, planConfig(session.team.plan).maxExplorers)
    : 1;
  const branch =
    selectedRepo.selectedBranch || selectedRepo.defaultBranch || "main";

  const coverageProps = {
    repositoryId: selectedRepo.id,
    environmentKey: env,
    spec,
    stop: stopSummary,
    dimensions,
    trend,
    sources,
  };

  return (
    <CoverageDataProvider value={railData}>
      {/* The canvas tab strip is this screen's visible header, so the document
          outline would otherwise have no heading at all. */}
      <h1 className="sr-only">Coverage</h1>
      <AppMapPage
        repositoryId={selectedRepo.id}
        branch={branch}
        qaAgentEnabled={qaAgentEnabled}
        maxExplorers={maxExplorers}
        exploreProgressPanel={ExploreProgressPanel}
        onCancelExploration={cancelExploration}
        dataView={<CoverageClient {...coverageProps} view="data" />}
        gapsView={<CoverageClient {...coverageProps} view="gaps" />}
        coverageRail={CoverageRail}
        coverageSummary={
          spec.sections.length > 0
            ? `${stop.metrics.eligibleCells} cells · ${stop.metrics.coveredCells} covered`
            : undefined
        }
        coverageGapCount={spec.outstanding.length}
      />
    </CoverageDataProvider>
  );
}
