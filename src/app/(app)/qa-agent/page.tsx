import Link from "next/link";
import { getCurrentSession } from "@/lib/auth";
import {
  getSelectedRepository,
  getLatestAgentSession,
  getRecentAgentSessions,
  getGithubAccountByTeam,
  getAISettings,
  getDefaultSetupSteps,
  getStorageStates,
  getQaTasksByRepo,
  getQaAgentTrigger,
} from "@/lib/db/queries";
import type { AgentSession } from "@/lib/db/schema";
import { getEnvironmentConfig } from "@/server/actions/environment";
import { QaAgentClient } from "@/components/qa-agent/qa-agent-client";
import { QaAgentUpgradeGate } from "@/components/qa-agent/qa-agent-upgrade-gate";
import {
  hasQaAgentAccess,
  qaAgentMinPlanName,
} from "@/lib/billing/feature-access";
import { planConfig } from "@/lib/billing/plans";
import { Bot } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function QaAgentPage() {
  const session = await getCurrentSession();
  const team = session?.team;
  const teamId = team?.id;
  const userId = session?.user?.id;

  // QA Agent is a Pro-tier feature. Gate before anything else so teams below
  // the required plan always land on the upgrade screen (regardless of whether
  // they've connected a repo yet).
  if (team && !hasQaAgentAccess(team.plan)) {
    return (
      <QaAgentUpgradeGate
        currentPlanName={planConfig(team.plan).name}
        requiredPlanName={qaAgentMinPlanName()}
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
              <Bot className="h-6 w-6" />
              QA Agent
            </h1>
          </header>
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Connect and select a repository first — the QA agent builds its
            suite into a repo.{" "}
            <Link href="/tests" className="underline">
              Add a repository
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const activeBranch =
    selectedRepo.selectedBranch || selectedRepo.defaultBranch || "main";

  const [
    qaSession,
    recentSessions,
    qaTasks,
    qaTriggerConfig,
    ghAccount,
    envConfig,
    aiSettings,
    hasDefaultSetupSteps,
    hasLiveStorageState,
  ] = await Promise.all([
    getLatestAgentSession(selectedRepo.id, "qa").catch(() => null),
    getRecentAgentSessions(selectedRepo.id, "qa", 10).catch(() => []),
    getQaTasksByRepo(selectedRepo.id).catch(() => []),
    getQaAgentTrigger(selectedRepo.id)
      .then((t) => t ?? null)
      .catch(() => null),
    teamId ? getGithubAccountByTeam(teamId).catch(() => null) : null,
    getEnvironmentConfig(selectedRepo.id).catch(() => null),
    getAISettings(selectedRepo.id).catch(() => null),
    getDefaultSetupSteps(selectedRepo.id)
      .then((steps) => steps.length > 0)
      .catch(() => false),
    getStorageStates(selectedRepo.id)
      .then((rows) =>
        rows.some((s) => !s.expiresAt || s.expiresAt.getTime() > Date.now()),
      )
      .catch(() => false),
  ]);

  // Latest stored plan (any prior full/refresh run) powers the fill-gaps mode.
  const planSource = recentSessions.find((s) => s.metadata.qaPlan);
  const storedPlan = planSource?.metadata.qaPlan;
  const storedPlanInfo = storedPlan
    ? `${storedPlan.items.length} items, ${storedPlan.journeys.length} journeys` +
      (planSource?.createdAt
        ? ` (from ${new Date(planSource.createdAt).toLocaleDateString()})`
        : "")
    : null;

  const githubConnected = Boolean(
    ghAccount?.accessToken &&
    selectedRepo.provider === "github" &&
    selectedRepo.owner,
  );
  const aiConfigured = Boolean(
    aiSettings?.provider && aiSettings.provider !== "none",
  );
  const defaultUrl =
    selectedRepo.branchBaseUrls?.[activeBranch] ?? envConfig?.baseUrl ?? "";
  // The Login step checks setup steps / storage states first — surface that
  // in the setup form so the user knows creds may be unnecessary.
  const hasExistingAuthSetup = hasDefaultSetupSteps || hasLiveStorageState;

  // Credentials never reach the client; drop the password from the snapshot.
  const sanitize = (s: AgentSession): AgentSession => ({
    ...s,
    metadata: (({ quickstartPassword: _pw, ...rest }) => rest)(s.metadata),
  });
  const initialSession = qaSession ? sanitize(qaSession) : null;
  const sanitizedRecent = recentSessions.map(sanitize);

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bot className="h-6 w-6" />
            QA Agent
          </h1>
          <p className="text-sm text-muted-foreground">
            An orchestrated agent team — scout, planner, generator, healer —
            that discovers your app, plans coverage against testing best
            practices, and builds a complete E2E suite you can watch and steer.
          </p>
        </header>
        <QaAgentClient
          repositoryId={selectedRepo.id}
          repositoryName={selectedRepo.fullName ?? selectedRepo.name ?? "repo"}
          defaultUrl={defaultUrl}
          githubConnected={githubConnected}
          aiConfigured={aiConfigured}
          hasStoredPlan={Boolean(storedPlan)}
          storedPlanInfo={storedPlanInfo}
          hasExistingAuthSetup={hasExistingAuthSetup}
          initialSession={initialSession}
          recentSessions={sanitizedRecent}
          initialTasks={qaTasks}
          initialTriggerConfig={qaTriggerConfig}
        />
      </div>
    </div>
  );
}
