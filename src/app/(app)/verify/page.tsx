import { redirect } from "next/navigation";
import { getSelectedRepository, getLastBuildByBranch } from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";
import { isVerifyPhaseEnabled } from "@/lib/verify/feature-flag";
import { fetchRepoBranches } from "@/server/actions/repos";
import { VerifyIndexClient } from "./verify-index-client";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const session = await getCurrentSession();
  if (!isVerifyPhaseEnabled(session?.team)) {
    redirect("/run");
  }

  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId
    ? await getSelectedRepository(userId, teamId)
    : null;

  if (!selectedRepo) {
    return (
      <VerifyIndexClient
        hasRepo={false}
        repositoryId={null}
        activeBranch={null}
        defaultBranch={null}
        branches={[]}
      />
    );
  }

  const activeBranch =
    selectedRepo.selectedBranch || selectedRepo.defaultBranch || "main";
  const latestBuild = await getLastBuildByBranch(
    selectedRepo.id,
    activeBranch,
  ).catch(() => null);
  if (latestBuild) {
    // Skip the client-side "Opening latest build…" flash — server-redirect
    // straight into the build view so users see the page chrome instantly.
    redirect(`/verify/${latestBuild.id}`);
  }

  // No builds on this branch yet — render the empty shell so the user can
  // switch branches or kick off a build.
  const branchList = await fetchRepoBranches(selectedRepo.id).catch(() => []);
  return (
    <VerifyIndexClient
      hasRepo
      repositoryId={selectedRepo.id}
      activeBranch={activeBranch}
      defaultBranch={selectedRepo.defaultBranch ?? null}
      branches={branchList.map((b) => b.name)}
    />
  );
}
