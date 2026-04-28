'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { getUserRepos, getRepoBranches } from '@/lib/github/oauth';
import { getUserProjectsDetailed, getProjectBranches } from '@/lib/gitlab/oauth';
import { TESTING_TEMPLATES, isValidTemplateId } from '@/lib/templates/testing-templates';

const REPO_SYNC_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Core GitHub repo sync — no session required */
export async function syncGithubReposForTeam(teamId: string, accessToken: string): Promise<number> {
  const ghRepos = await getUserRepos(accessToken);
  if (!ghRepos.length) return 0;

  for (const repo of ghRepos) {
    const existing = await queries.getRepositoryByGithubId(repo.id);
    if (existing && existing.teamId === teamId) {
      await queries.updateRepository(existing.id, {
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
      });
    } else if (!existing) {
      await queries.createRepository({
        teamId,
        githubRepoId: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
      });
    }
  }
  return ghRepos.length;
}

/** Core GitLab repo sync — no session required */
export async function syncGitlabReposForTeam(
  teamId: string,
  accessToken: string,
  instanceUrl?: string
): Promise<{ count: number; error?: string }> {
  const { projects, error } = await getUserProjectsDetailed(accessToken, instanceUrl);
  if (error) return { count: 0, error: error.message };
  if (!projects.length) return { count: 0 };

  for (const project of projects) {
    const existing = await queries.getRepositoryByGitlabProjectId(project.id);
    const [namespace, ...nameParts] = project.path_with_namespace.split('/');
    const projectName = nameParts.join('/');

    if (existing && existing.teamId === teamId) {
      await queries.updateRepository(existing.id, {
        owner: namespace,
        name: projectName,
        fullName: project.path_with_namespace,
        defaultBranch: project.default_branch,
      });
    } else if (!existing) {
      await queries.createRepository({
        teamId,
        provider: 'gitlab',
        gitlabProjectId: project.id,
        owner: namespace,
        name: projectName,
        fullName: project.path_with_namespace,
        defaultBranch: project.default_branch,
      });
    }
  }
  return { count: projects.length };
}

/** Sync repos from GitHub/GitLab if last sync was > 10 min ago */
export async function syncReposIfStale(teamId: string): Promise<void> {
  const [ghAccount, glAccount] = await Promise.all([
    queries.getGithubAccountByTeam(teamId),
    queries.getGitlabAccountByTeam(teamId),
  ]);

  if (ghAccount?.accessToken) {
    const isStale = !ghAccount.reposSyncedAt ||
      Date.now() - ghAccount.reposSyncedAt.getTime() > REPO_SYNC_TTL_MS;
    if (isStale) {
      try {
        await syncGithubReposForTeam(teamId, ghAccount.accessToken);
        await queries.updateGithubAccount(ghAccount.id, { reposSyncedAt: new Date() });
      } catch { /* non-fatal */ }
    }
  }

  if (glAccount?.accessToken) {
    const isStale = !glAccount.reposSyncedAt ||
      Date.now() - glAccount.reposSyncedAt.getTime() > REPO_SYNC_TTL_MS;
    if (isStale) {
      try {
        await syncGitlabReposForTeam(teamId, glAccount.accessToken, glAccount.instanceUrl || undefined);
        await queries.updateGitlabAccount(glAccount.id, { reposSyncedAt: new Date() });
      } catch { /* non-fatal */ }
    }
  }
}

export async function fetchAndSyncRepos(): Promise<{ success: boolean; count: number }> {
  const session = await requireTeamAccess();
  const account = await queries.getGithubAccountByTeam(session.team.id);
  if (!account) return { success: false, count: 0 };

  const count = await syncGithubReposForTeam(session.team.id, account.accessToken);
  if (count > 0) {
    await queries.updateGithubAccount(account.id, { reposSyncedAt: new Date() });
    revalidatePath('/');
    revalidatePath('/settings');
  }
  return { success: count > 0, count };
}

export async function fetchAndSyncGitlabRepos(): Promise<{ success: boolean; count: number }> {
  const session = await requireTeamAccess();
  const account = await queries.getGitlabAccountByTeam(session.team.id);
  if (!account) return { success: false, count: 0 };

  const { count } = await syncGitlabReposForTeam(session.team.id, account.accessToken, account.instanceUrl || undefined);
  if (count > 0) {
    await queries.updateGitlabAccount(account.id, { reposSyncedAt: new Date() });
    revalidatePath('/');
    revalidatePath('/settings');
  }
  return { success: count > 0, count };
}

export async function selectRepo(repositoryId: string | null) {
  const session = await requireTeamAccess();

  // Write to user-level selection
  await queries.updateUser(session.user.id, { selectedRepositoryId: repositoryId });

  // Backward compat: also write to team + provider account selections
  await queries.updateTeam(session.team.id, { selectedRepositoryId: repositoryId });

  const [githubAccount, gitlabAccount] = await Promise.all([
    queries.getGithubAccountByTeam(session.team.id),
    queries.getGitlabAccountByTeam(session.team.id),
  ]);

  if (githubAccount) {
    await queries.updateSelectedRepository(githubAccount.id, repositoryId);
  }
  if (gitlabAccount) {
    await queries.updateGitlabSelectedRepository(gitlabAccount.id, repositoryId);
  }

  revalidatePath('/');
  revalidatePath('/tests');
  revalidatePath('/run');
}

export async function createLocalRepo(name: string, baseUrl?: string) {
  const session = await requireTeamAccess();
  const repo = await queries.createRepository({
    teamId: session.team.id,
    provider: 'local',
    owner: 'local',
    name,
    fullName: name,
    ...(baseUrl ? { branchBaseUrls: { default: baseUrl } } : {}),
  });
  // Auto-select the new repo on user
  await queries.updateUser(session.user.id, { selectedRepositoryId: repo.id });
  revalidatePath('/');
  revalidatePath('/settings');
  return repo;
}

export async function getSelectedRepo() {
  const session = await requireTeamAccess();
  return queries.getSelectedRepository(session.user.id, session.team.id);
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

export async function updateAutoApproveDefaultBranch(repositoryId: string, enabled: boolean) {
  const session = await requireTeamAccess();
  const repo = await queries.getRepository(repositoryId);
  if (!repo || repo.teamId !== session.team.id) return;
  await queries.updateRepository(repositoryId, { autoApproveDefaultBranch: enabled });
  revalidatePath('/settings');
}

export async function updateComparisonRunSettings(
  repositoryId: string,
  enabled: boolean,
  baselineBranch?: string,
) {
  const session = await requireTeamAccess();
  const repo = await queries.getRepository(repositoryId);
  if (!repo || repo.teamId !== session.team.id) return;
  await queries.updateRepository(repositoryId, {
    comparisonRunEnabled: enabled,
    ...(baselineBranch !== undefined ? { comparisonBaselineBranch: baselineBranch } : {}),
  });
  revalidatePath('/run');
}

// Branch interface that works for both providers
interface RepoBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export async function fetchRepoBranches(repositoryId: string): Promise<RepoBranch[]> {
  const session = await requireTeamAccess();
  const repo = await queries.getRepository(repositoryId);
  if (!repo || repo.teamId !== session.team.id) return [];

  if (repo.provider === 'local') return [];

  if (repo.provider === 'gitlab') {
    // Fetch from GitLab
    const account = await queries.getGitlabAccountByTeam(session.team.id);
    if (!account || !repo.gitlabProjectId) return [];

    const branches = await getProjectBranches(account.accessToken, repo.gitlabProjectId, account.instanceUrl || undefined);
    // Transform GitLab branch format to common format
    return branches.map(b => ({
      name: b.name,
      commit: { sha: b.commit.id },
      protected: b.protected,
    }));
  } else {
    // Fetch from GitHub
    const account = await queries.getGithubAccountByTeam(session.team.id);
    if (!account) return [];

    const branches = await getRepoBranches(account.accessToken, repo.owner, repo.name);
    // Transform GitHub branch format to common format
    return branches.map(b => ({
      name: b.name,
      commit: { sha: b.commit.sha },
      protected: b.protected,
    }));
  }
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

export async function applyTestingTemplate(
  repositoryId: string,
  templateId: string | null,
): Promise<{ success: boolean; error?: string }> {
  await requireRepoAccess(repositoryId);

  // "custom" or null → just clear the template field
  if (!templateId || templateId === 'custom') {
    await queries.updateRepository(repositoryId, { testingTemplate: null });
    revalidatePath('/settings');
    return { success: true };
  }

  if (!isValidTemplateId(templateId) || templateId === 'custom') {
    return { success: false, error: 'Invalid template' };
  }

  const template = TESTING_TEMPLATES[templateId];
  const { stabilization, diff, selectorPriority, ...playwrightFields } = template.settings;

  await queries.updateRepository(repositoryId, { testingTemplate: templateId });
  await queries.upsertPlaywrightSettings(repositoryId, {
    ...playwrightFields,
    selectorPriority,
    stabilization,
    lockViewportToRecording: templateId === 'canvas',
  });
  await queries.upsertDiffSensitivitySettings(repositoryId, diff);

  revalidatePath('/settings');
  return { success: true };
}
