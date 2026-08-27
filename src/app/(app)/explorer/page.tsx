import Link from "next/link";
import { Compass } from "lucide-react";
import ExplorerPage from "@lastest/plugin-explorer/page";

import { getCurrentSession } from "@/lib/auth";
import { getSelectedRepository, getAISettings } from "@/lib/db/queries";
import { getEnvironmentConfig } from "@/server/actions/environment";
import { ExplorerBrowserViewer } from "@/components/explorer-browser-viewer";
import { AgentBreadcrumb } from "@/components/agents/agent-breadcrumb";
import { QaAgentUpgradeGate } from "@lastest/plugin-qa-agent/ui/qa-agent-upgrade-gate";
import { qaAgentMinPlanName } from "@/lib/billing/feature-access";
import { planConfig } from "@/lib/billing/plans";
import { getPluginRuntime } from "@/lib/core/runtime";

export const dynamic = "force-dynamic";

/**
 * The app half of the `/explorer` route.
 *
 * Spike S1 said this could be one line, and the *page* is — the whole render
 * lives in `plugins/explorer`. What remains is the composition: resolve which
 * repository the user has selected, hand over the pieces of app UI the plugin
 * is not allowed to import, and let it do the rest.
 *
 * Each thing passed down is something a plugin should not be able to reach:
 * repository *selection* is per-user state on core tables, the plan name is
 * billing, and the EB stream viewer is core's. None of it is data the plugin
 * could have fetched itself.
 */
export default async function Page() {
  const session = await getCurrentSession();
  const team = session?.team;
  const teamId = team?.id;

  // The plugin's action modules are dispatched directly by Next, so the runtime
  // is normally wired at boot (`src/instrumentation.ts`). Awaiting it here too
  // makes the page resilient to a boot-time failure that has since resolved —
  // it is memoized, so the second call is free.
  await getPluginRuntime();

  const selectedRepo = teamId
    ? await getSelectedRepository(session?.user?.id, teamId)
    : null;

  const [envConfig, aiSettings] = selectedRepo
    ? await Promise.all([
        getEnvironmentConfig(selectedRepo.id).catch(() => null),
        getAISettings(selectedRepo.id).catch(() => null),
      ])
    : [null, null];

  const activeBranch =
    selectedRepo?.selectedBranch || selectedRepo?.defaultBranch || "main";

  return (
    <ExplorerPage
      repositoryId={selectedRepo?.id ?? null}
      defaultUrl={
        selectedRepo?.branchBaseUrls?.[activeBranch] ?? envConfig?.baseUrl ?? ""
      }
      aiConfigured={Boolean(
        aiSettings?.provider && aiSettings.provider !== "none",
      )}
      browserViewer={ExplorerBrowserViewer}
      breadcrumb={<AgentBreadcrumb current="Explorer" />}
      upgradeGate={
        team ? (
          <QaAgentUpgradeGate
            currentPlanName={planConfig(team.plan).name}
            requiredPlanName={qaAgentMinPlanName()}
          />
        ) : null
      }
      noRepository={
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
      }
    />
  );
}
