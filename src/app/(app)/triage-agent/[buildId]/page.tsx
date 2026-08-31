import { notFound } from "next/navigation";
import {
  getBuild,
  getTestRun,
  getRepository,
  getTriageRunForBuild,
  getTestResultsByRun,
  getVisualDiffsByBuild,
  getTestsByRepo,
  getFunctionalAreasByRepo,
  getTestRunsByRepo,
} from "@/lib/db/queries";
import { getCurrentSession, requireRepoAccess } from "@/lib/auth";
import {
  hasQaAgentAccess,
  qaAgentMinPlanName,
} from "@/lib/billing/feature-access";
import { isBillingEnabled } from "@/lib/billing/enabled";
import { planConfig } from "@/lib/billing/plans";
import { QaAgentUpgradeGate } from "@lastest/plugin-qa-agent/ui/qa-agent-upgrade-gate";
import {
  deriveTriageScreen,
  type PriorRunOutcomes,
} from "@/components/triage/derive";
import { TriageRunClient } from "@/app/(app)/triage-agent/[buildId]/triage-run-client";

export const dynamic = "force-dynamic";

interface TriageBuildPageProps {
  params: Promise<{ buildId: string }>;
}

/** How many earlier runs feed the per-case sparkline. */
const HISTORY_DEPTH = 3;

export default async function TriageBuildPage({
  params,
}: TriageBuildPageProps) {
  const { buildId } = await params;
  const session = await getCurrentSession();
  const team = session?.team;

  // Pro gate first — identical to /agents and /qa-agent.
  if (team && !hasQaAgentAccess(team.plan, isBillingEnabled())) {
    return (
      <QaAgentUpgradeGate
        currentPlanName={planConfig(team.plan).name}
        requiredPlanName={qaAgentMinPlanName()}
      />
    );
  }

  const build = await getBuild(buildId);
  if (!build) notFound();

  const testRun = build.testRunId ? await getTestRun(build.testRunId) : null;
  const repo = testRun?.repositoryId
    ? await getRepository(testRun.repositoryId)
    : null;
  if (repo) await requireRepoAccess(repo.id);

  const [triage, results, diffs, tests, areas, branchRuns] = await Promise.all([
    getTriageRunForBuild(buildId).catch(() => null),
    testRun ? getTestResultsByRun(testRun.id).catch(() => []) : [],
    getVisualDiffsByBuild(buildId).catch(() => []),
    repo ? getTestsByRepo(repo.id).catch(() => []) : [],
    repo ? getFunctionalAreasByRepo(repo.id).catch(() => []) : [],
    repo ? getTestRunsByRepo(repo.id).catch(() => []) : [],
  ]);

  // "run N of M" — this run's place among the branch's runs (oldest = 1).
  // `getTestRunsByRepo` returns newest-first.
  const sameBranch = testRun
    ? branchRuns.filter((r) => r.gitBranch === testRun.gitBranch)
    : [];
  const indexFromNewest = testRun
    ? sameBranch.findIndex((r) => r.id === testRun.id)
    : -1;
  const runTotal = sameBranch.length || null;
  const runPosition =
    indexFromNewest >= 0 && runTotal ? runTotal - indexFromNewest : null;

  // The runs immediately before this one, oldest first, for the sparkline.
  const priorRuns: PriorRunOutcomes[] = [];
  if (indexFromNewest >= 0) {
    const earlier = sameBranch
      .slice(indexFromNewest + 1, indexFromNewest + 1 + HISTORY_DEPTH)
      .reverse();
    const rows = await Promise.all(
      earlier.map((r) => getTestResultsByRun(r.id).catch(() => [])),
    );
    earlier.forEach((r, i) => {
      priorRuns.push({
        runId: r.id,
        results: rows[i].map((x) => ({ testId: x.testId, status: x.status })),
      });
    });
  }

  const screen = deriveTriageScreen({
    build,
    testRun: testRun ?? null,
    repoName: repo?.fullName ?? repo?.name ?? "repository",
    repositoryId: repo?.id ?? null,
    runPosition,
    runTotal,
    triage,
    results,
    diffs,
    tests,
    areas,
    priorRuns,
  });

  return <TriageRunClient screen={screen} />;
}
