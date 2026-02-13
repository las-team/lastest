'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { getUserRepos, getRepoBranches, type GitHubRepo, type GitHubBranch } from '@/lib/github/oauth';
import { getUserProjects, getProjectBranches, type GitLabProject, type GitLabBranch } from '@/lib/gitlab/oauth';
import { TESTING_TEMPLATES, isValidTemplateId } from '@/lib/templates/testing-templates';

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

export async function fetchAndSyncGitlabRepos(): Promise<{ success: boolean; count: number }> {
  const session = await requireTeamAccess();
  const account = await queries.getGitlabAccountByTeam(session.team.id);
  if (!account) {
    return { success: false, count: 0 };
  }

  const glProjects = await getUserProjects(account.accessToken, account.instanceUrl || undefined);
  if (!glProjects.length) {
    return { success: false, count: 0 };
  }

  // Upsert repos for this team
  for (const project of glProjects) {
    const existing = await queries.getRepositoryByGitlabProjectId(project.id);
    const [namespace, ...nameParts] = project.path_with_namespace.split('/');
    const projectName = nameParts.join('/'); // Handle nested groups

    if (existing && existing.teamId === session.team.id) {
      await queries.updateRepository(existing.id, {
        owner: namespace,
        name: projectName,
        fullName: project.path_with_namespace,
        defaultBranch: project.default_branch,
      });
    } else if (!existing) {
      await queries.createRepository({
        teamId: session.team.id,
        provider: 'gitlab',
        gitlabProjectId: project.id,
        owner: namespace,
        name: projectName,
        fullName: project.path_with_namespace,
        defaultBranch: project.default_branch,
      });
    }
  }

  revalidatePath('/');
  revalidatePath('/settings');
  return { success: true, count: glProjects.length };
}

export async function selectRepo(repositoryId: string | null) {
  const session = await requireTeamAccess();

  // Update both GitHub and GitLab account selections
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

export async function updateAutoApproveDefaultBranch(repositoryId: string, enabled: boolean) {
  const session = await requireTeamAccess();
  const repo = await queries.getRepository(repositoryId);
  if (!repo || repo.teamId !== session.team.id) return;
  await queries.updateRepository(repositoryId, { autoApproveDefaultBranch: enabled });
  revalidatePath('/settings');
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
  });
  await queries.upsertDiffSensitivitySettings(repositoryId, diff);

  revalidatePath('/settings');
  return { success: true };
}
