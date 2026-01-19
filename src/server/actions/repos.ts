'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { getUserRepos, getRepoBranches, type GitHubRepo, type GitHubBranch } from '@/lib/github/oauth';

export async function fetchAndSyncRepos(): Promise<{ success: boolean; count: number }> {
  const account = await queries.getGithubAccount();
  if (!account) {
    return { success: false, count: 0 };
  }

  const ghRepos = await getUserRepos(account.accessToken);
  if (!ghRepos.length) {
    return { success: false, count: 0 };
  }

  // Upsert repos
  for (const repo of ghRepos) {
    const existing = await queries.getRepositoryByGithubId(repo.id);
    if (existing) {
      await queries.updateRepository(existing.id, {
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
      });
    } else {
      await queries.createRepository({
        githubRepoId: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
      });
    }
  }

  revalidatePath('/');
  revalidatePath('/repo');
  revalidatePath('/settings');
  return { success: true, count: ghRepos.length };
}

export async function selectRepo(repositoryId: string | null) {
  const account = await queries.getGithubAccount();
  if (!account) return;

  await queries.updateSelectedRepository(account.id, repositoryId);
  revalidatePath('/');
  revalidatePath('/tests');
  revalidatePath('/run');
  revalidatePath('/repo');
}

export async function getSelectedRepo() {
  return queries.getSelectedRepository();
}

export async function getRepos() {
  return queries.getRepositories();
}

export async function getRepo(id: string) {
  return queries.getRepository(id);
}

export async function updateRepoBaseline(repositoryId: string, branch: string) {
  await queries.updateRepository(repositoryId, { selectedBaseline: branch });
  revalidatePath('/repo');
}

export async function fetchRepoBranches(repositoryId: string): Promise<GitHubBranch[]> {
  const account = await queries.getGithubAccount();
  if (!account) return [];

  const repo = await queries.getRepository(repositoryId);
  if (!repo) return [];

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
