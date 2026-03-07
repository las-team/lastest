'use server';

import { requireTeamAccess, requireTeamAdmin } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import type { GithubActionMode, GithubActionTriggerEvent } from '@/lib/db/schema';
import { generateWorkflowYaml } from '@/lib/github/workflow-yaml';
import { getWorkflowFileSha, upsertWorkflowFile, setRepoSecret } from '@/lib/github/actions';
import { createRunnerInternal } from '@/server/actions/runners';
import { revalidatePath } from 'next/cache';

export async function getGithubActionConfigsAction() {
  const session = await requireTeamAccess();
  return queries.getGithubActionConfigs(session.team.id);
}

export async function createGithubActionConfigAction(input: {
  repositoryOwner: string;
  repositoryName: string;
  githubRepoId?: number;
  mode: GithubActionMode;
  runnerId?: string;
  triggerEvents?: GithubActionTriggerEvent[];
  branchFilter?: string[];
  cronSchedule?: string;
  targetUrl?: string;
  timeout?: number;
  failOnChanges?: boolean;
}) {
  const session = await requireTeamAdmin();
  const config = await queries.createGithubActionConfig({
    teamId: session.team.id,
    ...input,
  });
  revalidatePath('/settings');
  return config;
}

export async function updateGithubActionConfigAction(
  id: string,
  input: {
    mode?: GithubActionMode;
    runnerId?: string | null;
    triggerEvents?: GithubActionTriggerEvent[];
    branchFilter?: string[];
    cronSchedule?: string | null;
    targetUrl?: string | null;
    timeout?: number;
    failOnChanges?: boolean;
  },
) {
  const session = await requireTeamAdmin();
  const config = await queries.updateGithubActionConfig(id, session.team.id, input);
  revalidatePath('/settings');
  return config;
}

export async function deleteGithubActionConfigAction(id: string) {
  const session = await requireTeamAdmin();
  await queries.deleteGithubActionConfig(id, session.team.id);
  revalidatePath('/settings');
  return { success: true };
}

export async function deployWorkflowToGithub(
  configId: string,
  opts: {
    setSecrets?: boolean;
    runnerToken?: string;
    lastest2Url?: string;
  },
) {
  const session = await requireTeamAdmin();
  const config = await queries.getGithubActionConfig(configId, session.team.id);
  if (!config) throw new Error('Config not found');

  const isEphemeral = config.mode === 'ephemeral';

  // Get GitHub account for token
  const ghAccount = await queries.getGithubAccountByTeam(session.team.id);
  if (!ghAccount) throw new Error('No GitHub account connected');

  const yaml = generateWorkflowYaml({
    mode: config.mode as GithubActionMode,
    repositoryOwner: config.repositoryOwner,
    repositoryName: config.repositoryName,
    triggerEvents: (config.triggerEvents ?? ['push', 'pull_request', 'workflow_dispatch']) as GithubActionTriggerEvent[],
    branchFilter: (config.branchFilter ?? ['main']) as string[],
    cronSchedule: config.cronSchedule,
    targetUrl: config.targetUrl,
    timeout: config.timeout ?? 300000,
    failOnChanges: config.failOnChanges ?? true,
  });

  const results: { workflow: boolean; tokenSecret: boolean; urlSecret: boolean } = {
    workflow: false,
    tokenSecret: false,
    urlSecret: false,
  };

  // 1. Push workflow file
  const existingSha = await getWorkflowFileSha(
    ghAccount.accessToken,
    config.repositoryOwner,
    config.repositoryName,
  );
  await upsertWorkflowFile(
    ghAccount.accessToken,
    config.repositoryOwner,
    config.repositoryName,
    yaml,
    existingSha,
  );
  results.workflow = true;

  // 2. Set secrets
  if (isEphemeral) {
    // Ephemeral mode: auto-create runner and set secrets automatically
    const repoName = `${config.repositoryOwner}/${config.repositoryName}`;
    const result = await createRunnerInternal(
      `gha-${repoName}`,
      session.team.id,
      session.user.id,
      ['run'],
      'remote',
    );
    if ('error' in result) throw new Error(`Failed to create runner: ${result.error}`);

    await setRepoSecret(
      ghAccount.accessToken,
      config.repositoryOwner,
      config.repositoryName,
      'LASTEST2_TOKEN',
      result.token,
    );
    results.tokenSecret = true;

    const lastest2Url = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_BASE_URL || 'http://localhost:3000';
    await setRepoSecret(
      ghAccount.accessToken,
      config.repositoryOwner,
      config.repositoryName,
      'LASTEST2_URL',
      lastest2Url,
    );
    results.urlSecret = true;
  } else if (opts.setSecrets) {
    // Persistent mode: use user-provided values
    if (opts.runnerToken) {
      await setRepoSecret(
        ghAccount.accessToken,
        config.repositoryOwner,
        config.repositoryName,
        'LASTEST2_TOKEN',
        opts.runnerToken,
      );
      results.tokenSecret = true;
    }
    if (opts.lastest2Url) {
      await setRepoSecret(
        ghAccount.accessToken,
        config.repositoryOwner,
        config.repositoryName,
        'LASTEST2_URL',
        opts.lastest2Url,
      );
      results.urlSecret = true;
    }
  }

  // Mark as deployed
  await queries.updateGithubActionConfig(configId, session.team.id, {
    workflowDeployed: true,
    lastDeployedAt: new Date(),
  });

  revalidatePath('/settings');
  return results;
}
