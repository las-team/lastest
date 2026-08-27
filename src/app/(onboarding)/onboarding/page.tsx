import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import type { OnboardingSegment } from "@/lib/segment/regulated";
import { OnboardingClient } from "./onboarding-client";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const params = await searchParams;
  const session = await getCurrentSession();
  if (!session?.user) {
    redirect("/login");
  }

  const teamId = session.team?.id;
  const userId = session.user.id;

  const [githubAccount, gitlabAccount, repos, selectedRepo] = await Promise.all(
    [
      teamId ? queries.getGithubAccountByTeam(teamId) : Promise.resolve(null),
      teamId ? queries.getGitlabAccountByTeam(teamId) : Promise.resolve(null),
      teamId ? queries.getRepositoriesByTeam(teamId) : Promise.resolve([]),
      teamId
        ? queries.getSelectedRepository(userId, teamId)
        : Promise.resolve(null),
    ],
  );

  // 0 is the segment fork and 6 the pharma setup; 1-5 are the original custom
  // path, unchanged. A deep link into 1-5 (`connectGithub("/onboarding?step=2")`
  // is one) can only have come from the custom path, so it implies the segment
  // rather than re-asking it and dropping the user's OAuth round-trip.
  const rawStep = parseInt(params.step ?? "", 10);
  const deepLinkedStep =
    !Number.isNaN(rawStep) && rawStep >= 0 && rawStep <= 6 ? rawStep : null;

  const initialSegment: OnboardingSegment | null =
    // The team is regulated only if it came through the pharma fork, so that
    // flag is what a return visit resumes from.
    session.team?.regulatedMode
      ? "pharma"
      : deepLinkedStep !== null && deepLinkedStep >= 1 && deepLinkedStep <= 5
        ? "custom"
        : null;

  const initialStep = deepLinkedStep ?? (initialSegment === "pharma" ? 6 : 0);

  const serverUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return (
    <OnboardingClient
      initialStep={initialStep}
      initialPath={session.user.onboardingPath ?? null}
      initialSegment={initialSegment}
      userName={session.user.name ?? session.user.email.split("@")[0]}
      serverUrl={serverUrl}
      githubAccount={
        githubAccount ? { username: githubAccount.githubUsername } : null
      }
      gitlabAccount={
        gitlabAccount ? { username: gitlabAccount.gitlabUsername } : null
      }
      repos={repos.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        provider: r.provider,
        defaultBranch: r.defaultBranch,
      }))}
      selectedRepoId={selectedRepo?.id ?? null}
      selectedRepoBaseUrl={
        (selectedRepo?.defaultBranch
          ? selectedRepo.branchBaseUrls?.[selectedRepo.defaultBranch]
          : undefined) ??
        selectedRepo?.branchBaseUrls?.main ??
        (selectedRepo?.branchBaseUrls
          ? Object.values(selectedRepo.branchBaseUrls)[0]
          : undefined) ??
        null
      }
    />
  );
}
