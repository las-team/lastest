import Link from "next/link";
import { HeartPulse } from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import {
  getAISettings,
  getBuildsByRepo,
  getInProductAiEnabled,
  getLatestAgentSession,
  getRecentAgentSessions,
  getSelectedRepository,
} from "@/lib/db/queries";
import { AgentBreadcrumb } from "@/components/agents/agent-breadcrumb";
import {
  HealerAgentClient,
  type HealerCampaignRow,
  type HealerLockReason,
} from "@/components/agents/healer-agent-client";
import { QaAgentUpgradeGate } from "@lastest/plugin-qa-agent/ui/qa-agent-upgrade-gate";
import {
  hasQaAgentAccess,
  qaAgentMinPlanName,
} from "@/lib/billing/feature-access";
import { isBillingEnabled } from "@/lib/billing/enabled";
import { planConfig } from "@/lib/billing/plans";
import { DEFAULT_AI_SETTINGS } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * The Healer agent's home — reached by drilling into the Healer row on
 * `/agents`, exactly like `/triage-agent`. It owns the automation switch, the
 * two budgets, the live campaign and the campaign history.
 */
export default async function HealerAgentPage() {
  const session = await getCurrentSession();
  const team = session?.team;
  const teamId = team?.id;
  const userId = session?.user?.id;

  if (team && !hasQaAgentAccess(team.plan, isBillingEnabled())) {
    return (
      <QaAgentUpgradeGate
        currentPlanName={planConfig(team.plan).name}
        requiredPlanName={qaAgentMinPlanName()}
        title="Healer"
        icon={HeartPulse}
        description="Repairs failing tests in a loop — but only the ones Triage classified as a test problem, inside a budget you set. Real bugs stay red."
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
              <HeartPulse className="h-6 w-6" />
              Healer
            </h1>
          </header>
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Connect and select a repository first — the Healer repairs the tests
            of a repo.{" "}
            <Link href="/tests" className="underline">
              Add a repository
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const [healerSession, recent, builds, aiSettings, aiEnabled] =
    await Promise.all([
      getLatestAgentSession(selectedRepo.id, "healer").catch(() => null),
      getRecentAgentSessions(selectedRepo.id, "healer", 10).catch(() => []),
      getBuildsByRepo(selectedRepo.id, 20).catch(() => []),
      getAISettings(selectedRepo.id).catch(() => null),
      getInProductAiEnabled(selectedRepo.id).catch(() => false),
    ]);

  const buildById = new Map(builds.map((b) => [b.id, b]));
  const campaigns: HealerCampaignRow[] = recent
    .filter((s) => s.status !== "active")
    .map((s) => {
      const build = s.metadata.buildId
        ? buildById.get(s.metadata.buildId)
        : undefined;
      return {
        sessionId: s.id,
        buildId: s.metadata.buildId ?? null,
        status: s.status,
        rounds: s.metadata.healerRounds ?? 0,
        outcomes: s.metadata.healerOutcomes ?? [],
        at: s.completedAt ?? s.createdAt ?? null,
        gitBranch: build?.gitBranch ?? null,
        gitCommit: build?.gitCommit ?? null,
      };
    });

  const latest = builds[0] ?? null;

  const proOk = team ? hasQaAgentAccess(team.plan, isBillingEnabled()) : false;
  const lockReason: HealerLockReason = !proOk
    ? "plan"
    : !aiEnabled
      ? "ai_off"
      : !aiSettings?.triageAgentEnabled
        ? "triage_off"
        : null;

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="space-y-1">
          <AgentBreadcrumb current="Healer" />
          <h1 className="text-2xl font-semibold flex items-center gap-2 pt-1">
            <HeartPulse className="h-6 w-6" />
            Healer
          </h1>
          <p className="text-sm text-muted-foreground">
            Repairs failing tests in a heal → verify loop, and stops itself: it
            only touches failures the Triage agent classified as a test problem,
            spends a budget you set per test, and hands anything else to you
            with the reason.
          </p>
        </header>
        <HealerAgentClient
          repositoryId={selectedRepo.id}
          initialEnabled={aiSettings?.healerAgentEnabled ?? false}
          initialLimits={{
            maxAttemptsPerTest:
              aiSettings?.healerMaxAttemptsPerTest ??
              DEFAULT_AI_SETTINGS.healerMaxAttemptsPerTest,
            maxTestsPerBuild:
              aiSettings?.healerMaxTestsPerBuild ??
              DEFAULT_AI_SETTINGS.healerMaxTestsPerBuild,
          }}
          lockReason={lockReason}
          initialSession={healerSession ?? null}
          campaigns={campaigns}
          latestBuild={
            latest
              ? {
                  id: latest.id,
                  gitBranch: latest.gitBranch ?? null,
                  failedCount: latest.failedCount ?? null,
                  createdAt: latest.createdAt ?? null,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
