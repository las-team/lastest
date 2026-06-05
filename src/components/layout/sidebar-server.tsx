import {
  getSelectedRepository,
  getRepositoriesByTeamWithTestCounts,
  getLastBuildByBranch,
  getStepComparisonsByBuild,
  getLayerFeedbackByBuild,
  getTestRun,
} from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";
import { syncReposIfStale, fetchRepoBranches } from "@/server/actions/repos";
import { getEnvironmentConfig } from "@/server/actions/environment";
import { listSystemEmbeddedSessions } from "@/server/actions/embedded-sessions";
import { isVerifyPhaseEnabled } from "@/lib/verify/feature-flag";
import { Sidebar } from "./sidebar";

export async function SidebarServer({
  className,
}: { className?: string } = {}) {
  const session = await getCurrentSession();

  if (!session) {
    return (
      <Sidebar
        repos={[]}
        selectedRepo={null}
        currentUser={null}
        team={null}
        className={className}
      />
    );
  }

  const teamId = session.team?.id;
  const userId = session.user?.id;

  // Fire-and-forget: sync repos if stale (don't block render)
  if (teamId) {
    syncReposIfStale(teamId).catch(() => {});
  }

  const [selectedRepo, repos, ebSessions] = await Promise.all([
    teamId ? getSelectedRepository(userId, teamId) : Promise.resolve(null),
    teamId ? getRepositoriesByTeamWithTestCounts(teamId) : Promise.resolve([]),
    listSystemEmbeddedSessions().catch(() => []),
  ]);

  const envConfig = await getEnvironmentConfig(selectedRepo?.id).catch(
    () => null,
  );

  // Mirror the Run page: prefer the branch-pinned URL, fall back to env config.
  const activeBranch =
    selectedRepo?.selectedBranch ?? selectedRepo?.defaultBranch ?? "main";
  const branchBaseUrls =
    (selectedRepo?.branchBaseUrls as Record<string, string> | null) ?? null;
  const baseUrlForBranch =
    branchBaseUrls?.[activeBranch] ?? envConfig?.baseUrl ?? "";

  // Verify badge: count of unsorted (untriaged) cases on the active branch's
  // latest build. When zero, surface a "newer commit" hint instead so the
  // reviewer knows the code has moved past their last verified build.
  const verifyBadge =
    isVerifyPhaseEnabled(session.team) && selectedRepo
      ? await computeVerifyBadge(
          selectedRepo.id,
          selectedRepo.selectedBranch || selectedRepo.defaultBranch || "main",
        ).catch(() => ({ unsortedCount: 0, hasNewerCommit: false }))
      : { unsortedCount: 0, hasNewerCommit: false };

  return (
    <Sidebar
      repos={repos}
      selectedRepo={selectedRepo ?? null}
      currentUser={session.user}
      team={session.team}
      baseUrl={baseUrlForBranch}
      repositoryId={selectedRepo?.id}
      activeBranch={activeBranch}
      ebSessions={ebSessions}
      verifyPendingCount={verifyBadge.unsortedCount}
      verifyHasNewerCommit={verifyBadge.hasNewerCommit}
      className={className}
    />
  );
}

interface VerifyBadgeData {
  unsortedCount: number;
  /** True when the active branch's HEAD on GitHub is newer than the last
   *  build's commit — there's something to verify that hasn't been built. */
  hasNewerCommit: boolean;
}

async function computeVerifyBadge(
  repoId: string,
  branch: string,
): Promise<VerifyBadgeData> {
  const latestBuild = await getLastBuildByBranch(repoId, branch).catch(
    () => null,
  );

  let unsortedCount = 0;
  if (latestBuild) {
    const [steps, feedback] = await Promise.all([
      getStepComparisonsByBuild(latestBuild.id).catch(() => []),
      getLayerFeedbackByBuild(latestBuild.id).catch(() => []),
    ]);
    const approvedSteps = new Set<string>();
    for (const f of feedback) {
      if (f.status === "approved" || f.status === "auto_approved") {
        approvedSteps.add(f.stepComparisonId);
      }
    }
    // "Unsorted" = a yellow verdict that hasn't been adjudicated yet.
    // (Reds → Broken, greens → Verified, rejected → Broken — all already
    // sorted; only yellows-without-approval need triage.)
    unsortedCount = steps.filter(
      (s) => s.verdict === "yellow" && !approvedSteps.has(s.id),
    ).length;
  }

  let hasNewerCommit = false;
  if (latestBuild?.testRunId) {
    try {
      const testRun = await getTestRun(latestBuild.testRunId);
      const builtCommit = testRun?.gitCommit ?? null;
      if (builtCommit) {
        const branches = await fetchRepoBranches(repoId).catch(() => []);
        const head =
          branches.find((b) => b.name === branch)?.commit.sha ?? null;
        // test_runs.git_commit stores a short SHA (7 chars) but GitHub
        // returns the full 40-char SHA — match by common prefix length to
        // avoid a permanent "newer commit" flag on every branch.
        if (head && builtCommit) {
          const n = Math.min(head.length, builtCommit.length, 7);
          if (head.slice(0, n) !== builtCommit.slice(0, n))
            hasNewerCommit = true;
        }
      }
    } catch {
      // best-effort — don't break the sidebar on a GitHub API hiccup
    }
  }

  return { unsortedCount, hasNewerCommit };
}
