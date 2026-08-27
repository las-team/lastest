import Link from "next/link";
import { Network } from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import {
  FLEET_AGENT_KINDS,
  getSelectedRepository,
  getTeamRunUsage,
  listLiveAgentSessions,
  listRecentSettledAgentSessions,
} from "@/lib/db/queries";
import { getQaTasksByRepo } from "@lastest/plugin-qa-agent/reads";
import {
  escalationsFrom,
  idleRow,
  rowFromSession,
  sortRoster,
  summarise,
  type FleetAgentKind,
  type FleetRow,
} from "@/lib/agents/fleet";
import { AgentsConsole } from "@/components/agents/agents-console-client";

export const dynamic = "force-dynamic";

/**
 * The Agents console — one roster for every agent working the selected repo.
 *
 * This is the only sidebar entry for agent work: the QA agent and the Explorer
 * are reached by drilling through a row rather than by their own nav items.
 *
 * Explorer rows are absent from this PR. They live in the explorer plugin's
 * own table and arrive through `src/lib/core/explorer-reads.ts`, which is the
 * next change in the stack — until then the Explorer keeps its sidebar entry.
 */
export default async function AgentsPage() {
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
              <Network className="h-6 w-6" />
              Agents
            </h1>
          </header>
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Connect and select a repository first — agents work inside a repo.{" "}
            <Link href="/tests" className="underline">
              Add a repository
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const [liveSessions, settled, tasks, runUsage] = await Promise.all([
    listLiveAgentSessions(selectedRepo.id).catch(() => []),
    listRecentSettledAgentSessions(selectedRepo.id).catch(() => []),
    getQaTasksByRepo(selectedRepo.id).catch(() => []),
    teamId ? getTeamRunUsage(teamId).catch(() => null) : Promise.resolve(null),
  ]);

  // One row per live session, plus an idle row for every kind that has none —
  // the roster is the whole fleet, not just what happens to be running.
  const liveRows = liveSessions.map(rowFromSession);
  const kindsWithLiveRow = new Set<FleetAgentKind>(liveRows.map((r) => r.kind));
  const rows: FleetRow[] = sortRoster([
    ...liveRows,
    ...FLEET_AGENT_KINDS.filter(
      (k: FleetAgentKind) => !kindsWithLiveRow.has(k),
    ).map(idleRow),
  ]);

  return (
    <AgentsConsole
      repositoryName={selectedRepo.fullName ?? selectedRepo.name}
      rows={rows}
      summary={summarise(rows)}
      escalations={escalationsFrom(rows, tasks)}
      settled={settled.map((s) => ({
        id: s.id,
        kind: s.kind,
        status: s.status,
        completedAt: s.completedAt ?? s.createdAt ?? null,
      }))}
      queuedCount={tasks.filter((t) => t.status === "queued").length}
      runUsage={
        runUsage
          ? {
              used: runUsage.runMinutesThisMonth,
              quota: runUsage.monthlyRunQuota,
            }
          : null
      }
    />
  );
}
