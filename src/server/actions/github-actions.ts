'use server';

import { requireTeamAccess, requireTeamAdmin } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import type { GithubActionMode, GithubActionTriggerEvent } from '@/lib/db/schema';
import { generateWorkflowYaml } from '@/lib/github/workflow-yaml';
import { getWorkflowFileSha, upsertWorkflowFile, setRepoSecret, deleteWorkflowFile, deleteRepoSecret, checkRepoSecretExists, getLatestWorkflowRun } from '@/lib/github/actions';
import { createRunnerInternal, regenerateRunnerTokenInternal, deleteRunnerInternal } from '@/server/actions/runners';
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
  const config = await queries.getGithubActionConfig(id, session.team.id);
  if (!config) throw new Error('Config not found');

  // Clean up GitHub resources if the workflow was deployed
  if (config.workflowDeployed) {
    const ghAccount = await queries.getGithubAccountByTeam(session.team.id);
    if (ghAccount) {
      // Delete workflow file and secrets (best-effort — don't fail the delete if GitHub is unreachable)
      await Promise.allSettled([
        deleteWorkflowFile(ghAccount.accessToken, config.repositoryOwner, config.repositoryName),
        deleteRepoSecret(ghAccount.accessToken, config.repositoryOwner, config.repositoryName, 'LASTEST_TOKEN'),
        deleteRepoSecret(ghAccount.accessToken, config.repositoryOwner, config.repositoryName, 'LASTEST_URL'),
      ]);
    }
  }

  // Delete auto-created runner (ephemeral/auto modes link the runner to the config)
  const mode = config.mode as GithubActionMode;
  if ((mode === 'ephemeral' || mode === 'auto') && config.runnerId) {
    await deleteRunnerInternal(config.runnerId, session.team.id);
  }

  await queries.deleteGithubActionConfig(id, session.team.id);
  revalidatePath('/settings');
  return { success: true };
}

export async function deployWorkflowToGithub(
  configId: string,
  _opts?: Record<string, unknown>,
) {
  const session = await requireTeamAdmin();
  const config = await queries.getGithubActionConfig(configId, session.team.id);
  if (!config) throw new Error('Config not found');

  const isEphemeral = config.mode === 'ephemeral';
  const isAuto = config.mode === 'auto';

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
  if (isEphemeral || isAuto) {
    // Ephemeral/Auto mode: auto-create runner and set secrets automatically
    const repoName = `${config.repositoryOwner}/${config.repositoryName}`;
    const result = await createRunnerInternal(
      isAuto ? `gha-auto-${repoName}` : `gha-${repoName}`,
      session.team.id,
      session.user.id,
      ['run'],
      'remote',
      isAuto, // authOnly for auto mode
    );
    if ('error' in result) throw new Error(`Failed to create runner: ${result.error}`);

    await setRepoSecret(
      ghAccount.accessToken,
      config.repositoryOwner,
      config.repositoryName,
      'LASTEST_TOKEN',
      result.token,
    );
    results.tokenSecret = true;

    const lastestUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_BASE_URL || 'http://localhost:3000';
    await setRepoSecret(
      ghAccount.accessToken,
      config.repositoryOwner,
      config.repositoryName,
      'LASTEST_URL',
      lastestUrl,
    );
    results.urlSecret = true;

    // Link the auto-created runner to this config
    await queries.updateGithubActionConfig(configId, session.team.id, {
      runnerId: result.runner.id,
    });
  } else if (config.runnerId) {
    // Persistent mode with assigned runner: regenerate token and auto-set secrets
    const regen = await regenerateRunnerTokenInternal(config.runnerId, session.team.id);
    if ('error' in regen) throw new Error(`Failed to regenerate runner token: ${regen.error}`);

    await setRepoSecret(
      ghAccount.accessToken,
      config.repositoryOwner,
      config.repositoryName,
      'LASTEST_TOKEN',
      regen.token,
    );
    results.tokenSecret = true;

    const lastestUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_BASE_URL || 'http://localhost:3000';
    await setRepoSecret(
      ghAccount.accessToken,
      config.repositoryOwner,
      config.repositoryName,
      'LASTEST_URL',
      lastestUrl,
    );
    results.urlSecret = true;
  }

  // Mark as deployed
  await queries.updateGithubActionConfig(configId, session.team.id, {
    workflowDeployed: true,
    lastDeployedAt: new Date(),
  });

  revalidatePath('/settings');
  return results;
}

export type ValidationCheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export type ValidationCheck = {
  status: ValidationCheckStatus;
  message: string;
};

export type ValidationResult = {
  githubAccount: ValidationCheck;
  workflowFile: ValidationCheck;
  secretToken: ValidationCheck;
  secretUrl: ValidationCheck;
  runner: ValidationCheck;
  serverUrl: ValidationCheck;
  lastRun: ValidationCheck;
};

export async function validateGithubActionSetup(configId: string): Promise<ValidationResult> {
  const session = await requireTeamAccess();
  const config = await queries.getGithubActionConfig(configId, session.team.id);
  if (!config) throw new Error('Config not found');

  const result: ValidationResult = {
    githubAccount: { status: 'skip', message: '' },
    workflowFile: { status: 'skip', message: '' },
    secretToken: { status: 'skip', message: '' },
    secretUrl: { status: 'skip', message: '' },
    runner: { status: 'skip', message: '' },
    serverUrl: { status: 'skip', message: '' },
    lastRun: { status: 'skip', message: '' },
  };

  // 1. GitHub Account
  const ghAccount = await queries.getGithubAccountByTeam(session.team.id);
  if (!ghAccount) {
    result.githubAccount = { status: 'fail', message: 'No GitHub account connected' };
    result.workflowFile = { status: 'skip', message: 'Requires GitHub account' };
    result.secretToken = { status: 'skip', message: 'Requires GitHub account' };
    result.secretUrl = { status: 'skip', message: 'Requires GitHub account' };
    result.lastRun = { status: 'skip', message: 'Requires GitHub account' };
  } else {
    result.githubAccount = { status: 'pass', message: `Connected as ${ghAccount.githubUsername}` };

    // Run GitHub API checks in parallel
    const [workflowResult, tokenResult, urlResult, runResult] = await Promise.allSettled([
      getWorkflowFileSha(ghAccount.accessToken, config.repositoryOwner, config.repositoryName),
      checkRepoSecretExists(ghAccount.accessToken, config.repositoryOwner, config.repositoryName, 'LASTEST_TOKEN'),
      checkRepoSecretExists(ghAccount.accessToken, config.repositoryOwner, config.repositoryName, 'LASTEST_URL'),
      getLatestWorkflowRun(ghAccount.accessToken, config.repositoryOwner, config.repositoryName),
    ]);

    // 2. Workflow File
    if (workflowResult.status === 'fulfilled') {
      result.workflowFile = workflowResult.value
        ? { status: 'pass', message: 'Workflow file exists' }
        : { status: 'fail', message: 'Workflow file not found in repo' };
    } else {
      result.workflowFile = { status: 'fail', message: `API error: ${workflowResult.reason?.message || 'Unknown'}` };
    }

    // 3. LASTEST_TOKEN secret
    if (tokenResult.status === 'fulfilled') {
      result.secretToken = tokenResult.value
        ? { status: 'pass', message: 'Secret is set' }
        : { status: 'fail', message: 'LASTEST_TOKEN secret not found' };
    } else {
      result.secretToken = { status: 'fail', message: `API error: ${tokenResult.reason?.message || 'Unknown'}` };
    }

    // 4. LASTEST_URL secret
    if (urlResult.status === 'fulfilled') {
      result.secretUrl = urlResult.value
        ? { status: 'pass', message: 'Secret is set' }
        : { status: 'fail', message: 'LASTEST_URL secret not found' };
    } else {
      result.secretUrl = { status: 'fail', message: `API error: ${urlResult.reason?.message || 'Unknown'}` };
    }

    // 7. Last Workflow Run
    if (runResult.status === 'fulfilled') {
      const run = runResult.value;
      if (!run) {
        result.lastRun = { status: 'warn', message: 'No workflow runs found yet' };
      } else if (run.conclusion === 'success') {
        result.lastRun = { status: 'pass', message: `Last run succeeded (${new Date(run.createdAt).toLocaleDateString()})` };
      } else if (run.status === 'in_progress' || run.status === 'queued') {
        result.lastRun = { status: 'warn', message: `Run ${run.status}` };
      } else {
        result.lastRun = { status: 'fail', message: `Last run: ${run.conclusion || run.status} (${new Date(run.createdAt).toLocaleDateString()})` };
      }
    } else {
      result.lastRun = { status: 'warn', message: 'Could not fetch workflow runs' };
    }
  }

  // 5. Runner
  if (config.runnerId) {
    const runner = await queries.getRunnerById(config.runnerId);
    if (!runner) {
      result.runner = { status: 'fail', message: 'Linked runner not found in database' };
    } else if (runner.status === 'online') {
      result.runner = { status: 'pass', message: `Runner "${runner.name}" is online` };
    } else {
      result.runner = { status: 'warn', message: `Runner "${runner.name}" is ${runner.status}` };
    }
  } else {
    const mode = config.mode as GithubActionMode;
    if (mode === 'persistent') {
      result.runner = { status: 'fail', message: 'No runner assigned (persistent mode requires one)' };
    } else {
      result.runner = { status: 'pass', message: `${mode} mode — runner created on demand` };
    }
  }

  // 6. Server URL reachability
  const serverUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_BASE_URL;
  if (!serverUrl || serverUrl === 'http://localhost:3000') {
    result.serverUrl = { status: 'warn', message: `Server URL is "${serverUrl || 'not set'}" — not reachable from GitHub Actions` };
  } else {
    try {
      const healthRes = await fetch(`${serverUrl}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (healthRes.ok) {
        result.serverUrl = { status: 'pass', message: `${serverUrl} is reachable` };
      } else {
        result.serverUrl = { status: 'fail', message: `${serverUrl} returned ${healthRes.status}` };
      }
    } catch {
      result.serverUrl = { status: 'fail', message: `${serverUrl} is not reachable` };
    }
  }

  return result;
}
