import Link from "next/link";
import { Stethoscope } from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import {
  getAISettings,
  getBuildsByRepo,
  getInProductAiEnabled,
  getLatestAgentSession,
  getSelectedRepository,
  getTriageRunSummary,
  listRecentTriageRuns,
} from "@/lib/db/queries";
import { AgentBreadcrumb } from "@/components/agents/agent-breadcrumb";
import {
  TriageAgentClient,
  type TriageLockReason,
  type TriageRunRow,
} from "@/components/agents/triage-agent-client";
import { QaAgentUpgradeGate } from "@lastest/plugin-qa-agent/ui/qa-agent-upgrade-gate";
import {
  hasQaAgentAccess,
  qaAgentMinPlanName,
} from "@/lib/billing/feature-access";
import { isBillingEnabled } from "@/lib/billing/enabled";
import { planConfig } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

/**
 * The Triage agent's home — reached by drilling into the Triage row on
 * `/agents`, exactly like `/qa-agent` and `/explorer`. The per-build workspace
 * is `/triage-agent/[buildId]`; this page owns the automation switch, the live
 * state and the history that leads there.
 */
export default async function TriageAgentPage() {
  const session = await getCurrentSession();
  const team = session?.team;
  const teamId = team?.id;
  const userId = session?.user?.id;

  // Pro-gated, same gate as `/agents` and `/qa-agent`, and checked before the
  // repo lookup so a team below the plan always lands on the upgrade screen.
  if (!hasQaAgentAccess(team?.plan ?? "free", isBillingEnabled())) {
    return (
      <QaAgentUpgradeGate
        currentPlanName={planConfig(team?.plan ?? "free").name}
        requiredPlanName={qaAgentMinPlanName()}
        title="Triage agent"
        icon={Stethoscope}
        description="One classifier for a whole build: it collects every failure and visual change, clusters them by root cause, and suggests a verdict per cluster — so you review a handful of causes instead of a wall of diffs."
      />
    );
  }

  const selectedRepo = teamId
    ? await getSelectedRepository(userId, teamId)
    : null;

  if (!selectedRepo) {
    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          <header>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Stethoscope className="h-6 w-6" />
              Triage agent
            </h1>
          </header>
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Connect and select a repository first — the triage agent classifies
            the builds of a repo.{" "}
            <Link href="/tests" className="underline">
              Add a repository
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const [triageSession, recentRuns, builds, aiSettings, aiEnabled] =
    await Promise.all([
      getLatestAgentSession(selectedRepo.id, "triage").catch(() => null),
      listRecentTriageRuns(selectedRepo.id, 10).catch(() => []),
      getBuildsByRepo(selectedRepo.id, 50).catch(() => []),
      getAISettings(selectedRepo.id).catch(() => null),
      getInProductAiEnabled(selectedRepo.id).catch(() => false),
    ]);

  // `listRecentTriageRuns` has the counts but not the reviewer's progress, and
  // builds carry the branch/commit — join both onto the run here rather than
  // growing a query the Run Results stream also owns.
  const summaries = await Promise.all(
    recentRuns.map((run) => getTriageRunSummary(run.buildId).catch(() => null)),
  );
  const buildById = new Map(builds.map((b) => [b.id, b]));

  const runs: TriageRunRow[] = recentRuns.map((run, i) => {
    const build = buildById.get(run.buildId);
    return {
      triageRunId: run.id,
      buildId: run.buildId,
      status: run.status,
      headline: run.headline,
      caseCount: run.caseCount,
      groupCount: run.groupCount,
      decidedCount: summaries[i]?.decidedCount ?? 0,
      at: run.computedAt ?? run.createdAt ?? null,
      gitBranch: build?.gitBranch ?? null,
      gitCommit: build?.gitCommit ?? null,
      failedCount: build?.failedCount ?? null,
    };
  });

  const latest = builds[0] ?? null;
  const triagedBuildIds = new Set(recentRuns.map((r) => r.buildId));

  // The toggle is a Pro-plan setting over an AI-backed agent: either gate locks
  // it, and the tooltip says which one. The plan branch is belt-and-braces —
  // a team that fails the gate has already been returned the upgrade screen
  // above, so it only fires when there is no team to read a plan from — but the
  // switch must fail closed rather than depend on that early return.
  const proOk = team ? hasQaAgentAccess(team.plan, isBillingEnabled()) : false;
  const lockReason: TriageLockReason = !proOk
    ? "plan"
    : !aiEnabled
      ? "ai_off"
      : null;

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="space-y-1">
          <AgentBreadcrumb current="Triage agent" />
          <h1 className="text-2xl font-semibold flex items-center gap-2 pt-1">
            <Stethoscope className="h-6 w-6" />
            Triage agent
          </h1>
          <p className="text-sm text-muted-foreground">
            The single classifier for a build&apos;s failures — it clusters
            every failed and review-required case by root cause, writes the
            run&apos;s story, and suggests a verdict per cluster.
          </p>
        </header>
        <TriageAgentClient
          repositoryId={selectedRepo.id}
          initialEnabled={aiSettings?.triageAgentEnabled ?? false}
          lockReason={lockReason}
          initialSession={triageSession ?? null}
          runs={runs}
          latestBuild={
            latest
              ? {
                  id: latest.id,
                  gitBranch: latest.gitBranch ?? null,
                  failedCount: latest.failedCount ?? null,
                  changesDetected: latest.changesDetected ?? null,
                  createdAt: latest.createdAt ?? null,
                  alreadyTriaged: triagedBuildIds.has(latest.id),
                }
              : null
          }
        />
      </div>
    </div>
  );
}
