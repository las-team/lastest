import { db } from '../index';
import {
  repositories,
  pullRequests,
  githubAccounts,
  gitlabAccounts,
  baselines,
} from '../schema';
import type {
  NewRepository,
  NewPullRequest,
  NewGithubAccount,
  NewGitlabAccount,
} from '../schema';
import { getGithubAccountByTeam } from './auth';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// Pull Requests
export async function getPullRequest(id: string) {
  return db.select().from(pullRequests).where(eq(pullRequests.id, id)).get();
}

export async function getPullRequestByBranch(headBranch: string) {
  return db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.headBranch, headBranch), eq(pullRequests.status, 'open')))
    .get();
}

export async function createPullRequest(data: Omit<NewPullRequest, 'id'>) {
  const id = uuid();
  await db.insert(pullRequests).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updatePullRequest(id: string, data: Partial<NewPullRequest>) {
  await db.update(pullRequests).set({ ...data, updatedAt: new Date() }).where(eq(pullRequests.id, id));
}

// GitHub Accounts
/** @deprecated Use getGithubAccountByTeam(teamId) instead for proper tenant isolation */
export async function getGithubAccount() {
  return db.select().from(githubAccounts).get();
}

export async function createGithubAccount(data: Omit<NewGithubAccount, 'id'>) {
  const id = uuid();
  await db.insert(githubAccounts).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateGithubAccount(id: string, data: Partial<NewGithubAccount>) {
  await db.update(githubAccounts).set(data).where(eq(githubAccounts.id, id));
}

export async function deleteGithubAccount(id: string) {
  await db.delete(githubAccounts).where(eq(githubAccounts.id, id));
}

// GitLab Accounts
/** @deprecated Use getGitlabAccountByTeam(teamId) instead for proper tenant isolation */
export async function getGitlabAccount() {
  return db.select().from(gitlabAccounts).get();
}

export async function getGitlabAccountByTeam(teamId: string) {
  return db.select().from(gitlabAccounts).where(eq(gitlabAccounts.teamId, teamId)).get();
}

export async function createGitlabAccount(data: Omit<NewGitlabAccount, 'id'>) {
  const id = uuid();
  await db.insert(gitlabAccounts).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateGitlabAccount(id: string, data: Partial<NewGitlabAccount>) {
  await db.update(gitlabAccounts).set(data).where(eq(gitlabAccounts.id, id));
}

export async function deleteGitlabAccount(id: string) {
  await db.delete(gitlabAccounts).where(eq(gitlabAccounts.id, id));
}

export async function updateGitlabSelectedRepository(accountId: string, repositoryId: string | null) {
  await db.update(gitlabAccounts).set({ selectedRepositoryId: repositoryId }).where(eq(gitlabAccounts.id, accountId));
}

// Repositories
export async function getRepositories() {
  return db.select().from(repositories).orderBy(desc(repositories.createdAt)).all();
}

export async function getRepository(id: string) {
  return db.select().from(repositories).where(eq(repositories.id, id)).get();
}

export async function getRepositoryByGithubId(githubRepoId: number) {
  return db.select().from(repositories).where(eq(repositories.githubRepoId, githubRepoId)).get();
}

export async function getRepositoryByGitlabProjectId(gitlabProjectId: number) {
  return db.select().from(repositories).where(eq(repositories.gitlabProjectId, gitlabProjectId)).get();
}

export async function createRepository(data: Omit<NewRepository, 'id'>) {
  const id = uuid();
  await db.insert(repositories).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateRepository(id: string, data: Partial<NewRepository>) {
  await db.update(repositories).set(data).where(eq(repositories.id, id));
}

export async function deleteRepository(id: string) {
  await db.delete(repositories).where(eq(repositories.id, id));
}

export async function getBaselinesByRepo(repositoryId: string) {
  return db.select().from(baselines).where(eq(baselines.repositoryId, repositoryId)).all();
}

// Update selected repo for github account
export async function updateSelectedRepository(accountId: string, repositoryId: string | null) {
  await db.update(githubAccounts).set({ selectedRepositoryId: repositoryId }).where(eq(githubAccounts.id, accountId));
}

export async function getSelectedRepository(teamId?: string) {
  const account = teamId ? await getGithubAccountByTeam(teamId) : await getGithubAccount();
  if (!account?.selectedRepositoryId) return null;
  const repo = await getRepository(account.selectedRepositoryId);
  return repo || null;
}
