import { notFound } from "next/navigation";
import {
  getBuild,
  getBuildChangeMap,
  getTestRun,
  getRepository,
  getFunctionalAreasByRepo,
  getTestsByRepo,
  getA11yScoreTrend,
  getBuildA11yViolations,
  getDesignSystemScoreTrend,
  getBuildDesignSystemViolations,
  getPlaywrightSettings,
  getComposeConfig,
  getTeamRunUsage,
} from "@/lib/db/queries";
import { getCurrentSession, requireRepoAccess } from "@/lib/auth";
import { isInteractivePlaybackEnabled } from "@/lib/playback/feature-flag";
import { fetchRepoBranches } from "@/server/actions/repos";
import { getStreamUrlForRunner } from "@/server/actions/embedded-sessions";
import { getBuildsByComparisonPairId } from "@/lib/db/queries";
import { getEnvironmentConfig } from "@/server/actions/environment";
import {
  computeRunUsageProjection,
  deriveRunUsageBannerState,
} from "@/lib/billing/run-usage";
import { BoardFocusClient } from "./board-focus-client";
import { WebMcpRouteContext } from "@/components/webmcp/webmcp-route-context-client";

export const dynamic = "force-dynamic";

interface VerifyBuildPageProps {
  params: Promise<{ buildId: string }>;
}

export default async function VerifyBuildPage({
  params,
}: VerifyBuildPageProps) {
  const { buildId } = await params;
  const session = await getCurrentSession();
  const build = await getBuild(buildId);
  if (!build) notFound();

  const testRun = build.testRunId ? await getTestRun(build.testRunId) : null;
  const repo = testRun?.repositoryId
    ? await getRepository(testRun.repositoryId)
    : null;
  if (repo) await requireRepoAccess(repo.id);

  // Frame-only data — fast lookups for the header chrome + drag/drop targets.
  // Heavy data (step_comparisons, layer feedback, visual_diffs, test_results,
  // change-map compute, crashed-build backfill) is deferred to the client's
  // first /verify-status fetch so the page renders the frame instantly.
  const [
    areas,
    tests,
    branches,
    changeMap,
    a11yTrend,
    a11yViolations,
    designSystemTrend,
    designSystemViolations,
    pwSettings,
  ] = await Promise.all([
    repo
      ? getFunctionalAreasByRepo(repo.id).catch(() => [])
      : Promise.resolve([]),
    repo ? getTestsByRepo(repo.id).catch(() => []) : Promise.resolve([]),
    repo ? fetchRepoBranches(repo.id).catch(() => []) : Promise.resolve([]),
    getBuildChangeMap(buildId).catch(() => null),
    repo ? getA11yScoreTrend(repo.id).catch(() => []) : Promise.resolve([]),
    // Drill-in rows are needed only when the build actually has violations;
    // an empty array short-circuits the A11yViolationsCard render.
    (build.a11yViolationCount ?? 0) > 0
      ? getBuildA11yViolations(buildId).catch(() => [])
      : Promise.resolve([]),
    repo
      ? getDesignSystemScoreTrend(repo.id).catch(() => [])
      : Promise.resolve([]),
    (build.designSystemViolationCount ?? 0) > 0
      ? getBuildDesignSystemViolations(buildId).catch(() => [])
      : Promise.resolve([]),
    repo
      ? getPlaywrightSettings(repo.id).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Run split-button inputs. The old `/run` dashboard fetched all of this to
  // render three cards; here it decorates one button, so everything is either
  // already loaded (tests, branches) or a single cheap lookup.
  const activeBranch =
    testRun?.gitBranch ?? repo?.selectedBranch ?? repo?.defaultBranch ?? "main";
  const [composeConfig, envConfig, runUsage] = await Promise.all([
    repo
      ? getComposeConfig(repo.id, activeBranch).catch(() => null)
      : Promise.resolve(null),
    getEnvironmentConfig(repo?.id).catch(() => null),
    session?.team?.id
      ? getTeamRunUsage(session.team.id).catch(() => null)
      : Promise.resolve(null),
  ]);

  // `excludedTestIds` and `selectedTestIds` are two spellings of the same
  // selection; normalise to the inclusive one the run actions take.
  const composedTestIds = composeConfig?.excludedTestIds
    ? tests
        .map((t) => t.id)
        .filter((id) => !composeConfig.excludedTestIds!.includes(id))
    : (composeConfig?.selectedTestIds ?? null);

  // Live browser stream, when this build runs on an embedded browser. Resolved
  // at render like the retired build page did: the board shows it only while
  // the build is in flight, and the Run button refreshes the route on start,
  // which is what re-resolves the URL for a freshly claimed EB.
  let embeddedStreamUrl: string | null = null;
  if (testRun?.runnerId) {
    const streamInfo = await getStreamUrlForRunner(testRun.runnerId).catch(
      () => null,
    );
    embeddedStreamUrl = streamInfo?.streamUrl ?? null;
  }

  // The other half of a comparison run — a chip beside the branch picker, so a
  // baseline build never reads as "the" result of the run.
  let comparisonSibling: { id: string; role: string } | null = null;
  if (build.comparisonPairId) {
    const pair = await getBuildsByComparisonPairId(
      build.comparisonPairId,
    ).catch(() => []);
    const sibling = pair.find((b) => b.id !== buildId);
    if (sibling) {
      comparisonSibling = {
        id: sibling.id,
        role: sibling.comparisonRole || "unknown",
      };
    }
  }

  const runsPaused =
    !!runUsage &&
    process.env.ENFORCE_RUN_LIMITS === "true" &&
    deriveRunUsageBannerState({
      used: runUsage.runMinutesThisMonth,
      quota: runUsage.monthlyRunQuota,
      projected: computeRunUsageProjection(
        runUsage.runMinutesThisMonth,
        runUsage.monthlyRunQuota,
      ).projected,
      enforcementEnabled: true,
    }) === "paused";

  return (
    <>
      {/* Scopes the build-level WebMCP tools to this build. */}
      <WebMcpRouteContext buildId={buildId} />
      <BoardFocusClient
        build={build}
        branch={testRun?.gitBranch ?? null}
        changeMap={changeMap}
        stepComparisons={[]}
        areas={areas.map((a) => ({ id: a.id, name: a.name }))}
        tests={tests.map((t) => ({
          id: t.id,
          name: t.name,
          functionalAreaId: t.functionalAreaId,
        }))}
        layerFeedback={[]}
        visualDiffs={[]}
        testResults={[]}
        repositoryId={repo?.id ?? null}
        branches={branches.map((b) => b.name)}
        defaultBranch={repo?.defaultBranch ?? null}
        a11yTrend={a11yTrend}
        a11yViolations={a11yViolations}
        designSystemTrend={designSystemTrend}
        designSystemViolations={designSystemViolations}
        repoDesignSystem={pwSettings?.designSystem ?? null}
        interactivePlayback={isInteractivePlaybackEnabled(session?.team)}
        embeddedStreamUrl={embeddedStreamUrl}
        comparisonSibling={comparisonSibling}
        runOptions={{
          totalTests: tests.length,
          composedTestIds,
          versionOverrides: composeConfig?.versionOverrides ?? null,
          comparisonBaselineBranch: repo?.comparisonBaselineBranch ?? null,
          branchBaseUrls: repo?.branchBaseUrls ?? null,
          baseUrl:
            repo?.branchBaseUrls?.[activeBranch] ??
            envConfig?.baseUrl ??
            "http://localhost:3000",
          runsPaused,
        }}
      />
    </>
  );
}
