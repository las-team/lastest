import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import { OnboardingClient } from './onboarding-client';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const params = await searchParams;
  const session = await getCurrentSession();
  if (!session?.user) {
    redirect('/login');
  }

  const teamId = session.team?.id;
  const userId = session.user.id;

  const [githubAccount, gitlabAccount, repos, selectedRepo] = await Promise.all([
    teamId ? queries.getGithubAccountByTeam(teamId) : Promise.resolve(null),
    teamId ? queries.getGitlabAccountByTeam(teamId) : Promise.resolve(null),
    teamId ? queries.getRepositoriesByTeam(teamId) : Promise.resolve([]),
    teamId ? queries.getSelectedRepository(userId, teamId) : Promise.resolve(null),
  ]);

  const initialStep = (() => {
    const raw = parseInt(params.step ?? '', 10);
    if (Number.isNaN(raw) || raw < 1 || raw > 5) return 1;
    return raw;
  })();

  return (
    <OnboardingClient
      initialStep={initialStep}
      initialPath={session.user.onboardingPath ?? null}
      userName={session.user.name ?? session.user.email.split('@')[0]}
      githubAccount={
        githubAccount
          ? { username: githubAccount.githubUsername }
          : null
      }
      gitlabAccount={
        gitlabAccount
          ? { username: gitlabAccount.gitlabUsername }
          : null
      }
      repos={repos.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        provider: r.provider,
        defaultBranch: r.defaultBranch,
      }))}
      selectedRepoId={selectedRepo?.id ?? null}
      selectedRepoBaseUrl={
        selectedRepo?.branchBaseUrls?.default ??
        (selectedRepo?.defaultBranch
          ? selectedRepo.branchBaseUrls?.[selectedRepo.defaultBranch]
          : undefined) ??
        null
      }
    />
  );
}
