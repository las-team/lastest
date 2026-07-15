import Link from "next/link";
import { getCurrentSession } from "@/lib/auth";
import {
  getSelectedRepository,
  getLatestAgentSession,
  getAISettings,
  listFindingsBySession,
  listExperienceByRepo,
  listKnowledgeByRepo,
} from "@/lib/db/queries";
import type { AgentSession } from "@/lib/db/schema";
import { getEnvironmentConfig } from "@/server/actions/environment";
import { ExplorerClient } from "@/components/explorer/explorer-client";
import { QaAgentUpgradeGate } from "@/components/qa-agent/qa-agent-upgrade-gate";
import {
  hasQaAgentAccess,
  qaAgentMinPlanName,
} from "@/lib/billing/feature-access";
import { planConfig } from "@/lib/billing/plans";
import { Compass } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ExplorerPage() {
  const session = await getCurrentSession();
  const team = session?.team;
  const teamId = team?.id;
  const userId = session?.user?.id;

  // Explorer shares the QA agent's plan tier.
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
              <Compass className="h-6 w-6" />
              Explorer
            </h1>
          </header>
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Connect and select a repository first — the explorer records its
            findings and learned experience into a repo.{" "}
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

  const [explorerSession, knowledge, experience, envConfig, aiSettings] =
    await Promise.all([
      getLatestAgentSession(selectedRepo.id, "explorer").catch(() => null),
      listKnowledgeByRepo(selectedRepo.id).catch(() => []),
      listExperienceByRepo(selectedRepo.id, 50).catch(() => []),
      getEnvironmentConfig(selectedRepo.id).catch(() => null),
      getAISettings(selectedRepo.id).catch(() => null),
    ]);

  const findings = explorerSession
    ? await listFindingsBySession(explorerSession.id).catch(() => [])
    : [];

  const defaultUrl =
    selectedRepo.branchBaseUrls?.[activeBranch] ?? envConfig?.baseUrl ?? "";
  const aiConfigured = Boolean(
    aiSettings?.provider && aiSettings.provider !== "none",
  );

  // Credentials never reach the client.
  const sanitize = (s: AgentSession): AgentSession => ({
    ...s,
    metadata: (({ quickstartPassword: _pw, ...rest }) => rest)(s.metadata),
  });
  const initialSession = explorerSession
    ? { ...sanitize(explorerSession), findings }
    : null;
  const sanitizedKnowledge = knowledge.map(({ credPassword, ...rest }) => ({
    id: rest.id,
    title: rest.title,
    urlPattern: rest.urlPattern,
    matchKind: rest.matchKind,
    body: rest.body,
    credEmail: rest.credEmail,
    hasCredentials: Boolean(credPassword),
    enabled: rest.enabled,
  }));

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Compass className="h-6 w-6" />
            Explorer
          </h1>
          <p className="text-sm text-muted-foreground">
            An autonomous exploratory tester — it researches each page, plans
            scenarios in rotating styles, drives a live browser, records defects
            and UX findings, learns from every run, and keeps passing flows as
            tests.
          </p>
        </header>
        <ExplorerClient
          repositoryId={selectedRepo.id}
          defaultUrl={defaultUrl}
          aiConfigured={aiConfigured}
          initialSession={initialSession}
          initialKnowledge={sanitizedKnowledge}
          initialExperience={experience}
        />
      </div>
    </div>
  );
}
