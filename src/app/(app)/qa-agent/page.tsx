import Link from "next/link";
import { getCurrentSession } from "@/lib/auth";
import {
  getSelectedRepository,
  getLatestAgentSession,
  getGithubAccountByTeam,
  getAISettings,
} from "@/lib/db/queries";
import { getEnvironmentConfig } from "@/server/actions/environment";
import { QaAgentClient } from "@/components/qa-agent/qa-agent-client";
import { Bot } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function QaAgentPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
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

  const [qaSession, ghAccount, envConfig, aiSettings] = await Promise.all([
    getLatestAgentSession(selectedRepo.id, "qa").catch(() => null),
    teamId ? getGithubAccountByTeam(teamId).catch(() => null) : null,
    getEnvironmentConfig(selectedRepo.id).catch(() => null),
    getAISettings(selectedRepo.id).catch(() => null),
  ]);

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

  // Credentials never reach the client; drop the password from the snapshot.
  const initialSession = qaSession
    ? {
        ...qaSession,
        metadata: (({ quickstartPassword: _pw, ...rest }) => rest)(
          qaSession.metadata,
        ),
      }
    : null;

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
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
          initialSession={initialSession}
        />
      </div>
    </div>
  );
}
