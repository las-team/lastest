'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess } from '@/lib/auth';
import { getUserRepos, getRepoBranches, type GitHubRepo, type GitHubBranch } from '@/lib/github/oauth';

export async function fetchAndSyncRepos(): Promise<{ success: boolean; count: number }> {
  const session = await requireTeamAccess();
  const account = await queries.getGithubAccountByTeam(session.team.id);
  if (!account) {
    return { success: false, count: 0 };
  }

  const ghRepos = await getUserRepos(account.accessToken);
  if (!ghRepos.length) {
    return { success: false, count: 0 };
  }

  // Upsert repos for this team
  for (const repo of ghRepos) {
    const existing = await queries.getRepositoryByGithubId(repo.id);
    if (existing && existing.teamId === session.team.id) {
      await queries.updateRepository(existing.id, {
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
      });
    } else if (!existing) {
      await queries.createRepository({
        teamId: session.team.id,
        githubRepoId: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
      });
    }
  }

  revalidatePath('/');
  revalidatePath('/settings');
  return { success: true, count: ghRepos.length };
}

export async function selectRepo(repositoryId: string | null) {
  const session = await requireTeamAccess();
  const account = await queries.getGithubAccountByTeam(session.team.id);
  if (!account) return;

  await queries.updateSelectedRepository(account.id, repositoryId);
  revalidatePath('/');
  revalidatePath('/tests');
  revalidatePath('/run');
}

export async function getSelectedRepo() {
  const session = await requireTeamAccess();
  return queries.getSelectedRepository(session.team.id);
}

export async function getRepos() {
  const session = await requireTeamAccess();
  return queries.getRepositoriesByTeam(session.team.id);
}

export async function getRepo(id: string) {
  const session = await requireTeamAccess();
  const repo = await queries.getRepository(id);
  // Verify repo belongs to user's team
  if (!repo || repo.teamId !== session.team.id) return null;
  return repo;
}

export async function updateRepoBaseline(repositoryId: string, branch: string) {
  const session = await requireTeamAccess();
  const repo = await queries.getRepository(repositoryId);
  if (!repo || repo.teamId !== session.team.id) return;
  await queries.updateRepository(repositoryId, { selectedBaseline: branch });
}

export async function updateRepoSelectedBranch(repositoryId: string, branch: string) {
  const session = await requireTeamAccess();
  const repo = await queries.getRepository(repositoryId);
  if (!repo || repo.teamId !== session.team.id) return;
  await queries.updateRepository(repositoryId, { selectedBranch: branch });
  revalidatePath('/');
  revalidatePath('/run');
  revalidatePath('/builds');
}

export async function fetchRepoBranches(repositoryId: string): Promise<GitHubBranch[]> {
  const session = await requireTeamAccess();
  const account = await queries.getGithubAccountByTeam(session.team.id);
  if (!account) return [];

  const repo = await queries.getRepository(repositoryId);
  if (!repo || repo.teamId !== session.team.id) return [];

  return getRepoBranches(account.accessToken, repo.owner, repo.name);
}

// Get branch test status (has runs or not)
export async function getBranchTestStatus(repositoryId: string): Promise<Map<string, boolean>> {
  const runs = await queries.getTestRunsByRepo(repositoryId);
  const branchStatus = new Map<string, boolean>();

  for (const run of runs) {
    branchStatus.set(run.gitBranch, true);
  }

  return branchStatus;
}
