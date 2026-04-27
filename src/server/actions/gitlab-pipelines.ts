'use server';

import { requireTeamAccess, requireTeamAdmin } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import type {
  GitlabPipelineMode,
  GitlabPipelineTriggerEvent,
  GitlabPipelineDeliveryMode,
} from '@/lib/db/schema';
import { generateCiYaml } from '@/lib/gitlab/ci-yaml';
import {
  upsertCiFile,
  deleteCiFile,
  setProjectVariable,
  deleteProjectVariable,
  checkProjectVariableExists,
  upsertProjectHook,
  deleteProjectHook,
  upsertPipelineSchedule,
  deletePipelineSchedule,
  getLatestPipeline,
  getCiFileMeta,
} from '@/lib/gitlab/pipelines';
import {
  createRunnerInternal,
  regenerateRunnerTokenInternal,
  deleteRunnerInternal,
} from '@/server/actions/runners';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

interface CreateInput {
  repositoryId?: string | null;
  projectPath: string;
  gitlabProjectId?: number;
  mode: GitlabPipelineMode;
  deliveryMode?: GitlabPipelineDeliveryMode;
  runnerId?: string;
  triggerEvents?: GitlabPipelineTriggerEvent[];
  branchFilter?: string[];
  cronSchedule?: string;
  timeout?: number;
  failOnChanges?: boolean;
}

export async function getGitlabPipelineConfigsAction() {
  const session = await requireTeamAccess();
  return queries.getGitlabPipelineConfigs(session.team.id);
}

export async function createGitlabPipelineConfigAction(input: CreateInput) {
  const session = await requireTeamAdmin();
  const config = await queries.createGitlabPipelineConfig({
    teamId: session.team.id,
    ...input,
  });
  revalidatePath('/settings');
  return config;
}

export async function updateGitlabPipelineConfigAction(
  id: string,
  input: {
    mode?: GitlabPipelineMode;
    deliveryMode?: GitlabPipelineDeliveryMode;
    runnerId?: string | null;
    triggerEvents?: GitlabPipelineTriggerEvent[];
    branchFilter?: string[];
    cronSchedule?: string | null;
    timeout?: number;
    failOnChanges?: boolean;
  },
) {
  const session = await requireTeamAdmin();
  const config = await queries.updateGitlabPipelineConfig(id, session.team.id, input);
  revalidatePath('/settings');
  return config;
}

export async function deleteGitlabPipelineConfigAction(id: string) {
  const session = await requireTeamAdmin();
  const config = await queries.getGitlabPipelineConfig(id, session.team.id);
  if (!config) throw new Error('Config not found');

  // Best-effort cleanup of GitLab-side resources
  if (config.pipelineDeployed) {
    const glAccount = await queries.getGitlabAccountByTeam(session.team.id);
    if (glAccount && config.gitlabProjectId) {
      const instanceUrl = glAccount.instanceUrl || 'https://gitlab.com';
      const publicUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_BASE_URL || 'http://localhost:3000';
      const hookUrl = `${publicUrl}/api/webhooks/gitlab`;
      await Promise.allSettled([
        config.deliveryMode === 'ci_file'
          ? deleteCiFile(glAccount.accessToken, instanceUrl, config.gitlabProjectId, 'main')
          : Promise.resolve(),
        deleteProjectVariable(glAccount.accessToken, instanceUrl, config.gitlabProjectId, 'LASTEST_TOKEN'),
        deleteProjectVariable(glAccount.accessToken, instanceUrl, config.gitlabProjectId, 'LASTEST_URL'),
        deleteProjectHook(glAccount.accessToken, instanceUrl, config.gitlabProjectId, hookUrl),
        deletePipelineSchedule(glAccount.accessToken, instanceUrl, config.gitlabProjectId),
      ]);
    }
  }

  // Auto-created runners are owned by ephemeral/auto modes
  const mode = config.mode as GitlabPipelineMode;
  if ((mode === 'ephemeral' || mode === 'auto') && config.runnerId) {
    await deleteRunnerInternal(config.runnerId, session.team.id);
  }

  await queries.deleteGitlabPipelineConfig(id, session.team.id);
  revalidatePath('/settings');
  return { success: true };
}

export async function deployPipelineToGitlab(configId: string) {
  const session = await requireTeamAdmin();
  const config = await queries.getGitlabPipelineConfig(configId, session.team.id);
  if (!config) throw new Error('Config not found');

  const glAccount = await queries.getGitlabAccountByTeam(session.team.id);
  if (!glAccount) throw new Error('No GitLab account connected');
  const instanceUrl = glAccount.instanceUrl || 'https://gitlab.com';
  if (!config.gitlabProjectId) throw new Error('Config is missing gitlabProjectId');

  const isEphemeral = config.mode === 'ephemeral';
  const isAuto = config.mode === 'auto';

  const results = {
    ciFile: false,
    tokenVar: false,
    urlVar: false,
    hook: false,
    schedule: false,
  };

  // 1. CI file (only for ci_file delivery mode)
  if (config.deliveryMode === 'ci_file') {
    const yaml = generateCiYaml({
      mode: config.mode as GitlabPipelineMode,
      projectPath: config.projectPath,
      triggerEvents: (config.triggerEvents ?? ['push', 'merge_request']) as GitlabPipelineTriggerEvent[],
      branchFilter: (config.branchFilter ?? ['main']) as string[],
      timeout: config.timeout ?? 300000,
      failOnChanges: config.failOnChanges ?? true,
    });
    // Default to 'main' branch — GitLab projects almost always have it; falling back to API discovery
    // is overkill since users can re-deploy if their default branch differs.
    await upsertCiFile(glAccount.accessToken, instanceUrl, config.gitlabProjectId, 'main', yaml);
    results.ciFile = true;
  }

  // 2. Project variables (token + url)
  let runnerToken: string | null = null;
  let runnerId: string | null = config.runnerId ?? null;

  if (isEphemeral || isAuto) {
    if (!runnerId) {
      const result = await createRunnerInternal(
        isAuto ? `glp-auto-${config.projectPath}` : `glp-${config.projectPath}`,
        session.team.id,
        session.user.id,
        ['run'],
        'remote',
        isAuto, // authOnly for auto mode
      );
      if ('error' in result) throw new Error(`Failed to create runner: ${result.error}`);
      runnerToken = result.token;
      runnerId = result.runner.id;
    } else {
      const regen = await regenerateRunnerTokenInternal(runnerId, session.team.id);
      if ('error' in regen) throw new Error(`Failed to regenerate runner token: ${regen.error}`);
      runnerToken = regen.token;
    }
  } else if (runnerId) {
    const regen = await regenerateRunnerTokenInternal(runnerId, session.team.id);
    if ('error' in regen) throw new Error(`Failed to regenerate runner token: ${regen.error}`);
    runnerToken = regen.token;
  }

  if (runnerToken) {
    await setProjectVariable(
      glAccount.accessToken,
      instanceUrl,
      config.gitlabProjectId,
      'LASTEST_TOKEN',
      runnerToken,
      { masked: true },
    );
    results.tokenVar = true;

    const lastestUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_BASE_URL || 'http://localhost:3000';
    await setProjectVariable(
      glAccount.accessToken,
      instanceUrl,
      config.gitlabProjectId,
      'LASTEST_URL',
      lastestUrl,
      { masked: false },
    );
    results.urlVar = true;
  }

  // 3. Project hook — generate per-config secret if not present
  let webhookSecret = config.webhookSecret;
  if (!webhookSecret) {
    webhookSecret = crypto.randomBytes(32).toString('hex');
  }
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_BASE_URL || 'http://localhost:3000';
  const triggerEvents = (config.triggerEvents ?? ['push', 'merge_request']) as GitlabPipelineTriggerEvent[];
  await upsertProjectHook(
    glAccount.accessToken,
    instanceUrl,
    config.gitlabProjectId,
    `${publicUrl}/api/webhooks/gitlab`,
    webhookSecret,
    {
      push: triggerEvents.includes('push'),
      merge_request: triggerEvents.includes('merge_request'),
    },
  );
  results.hook = true;

  // 4. Pipeline schedule (only if 'schedule' is enabled and we have a cron)
  if (triggerEvents.includes('schedule') && config.cronSchedule) {
    await upsertPipelineSchedule(
      glAccount.accessToken,
      instanceUrl,
      config.gitlabProjectId,
      config.cronSchedule,
      'main',
    );
    results.schedule = true;
  }

  // Persist
  await queries.updateGitlabPipelineConfig(configId, session.team.id, {
    runnerId: runnerId ?? undefined,
    webhookSecret,
    pipelineDeployed: true,
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

export type GitlabValidationResult = {
  gitlabAccount: ValidationCheck;
  ciFile: ValidationCheck;
  variableToken: ValidationCheck;
  variableUrl: ValidationCheck;
  runner: ValidationCheck;
  serverUrl: ValidationCheck;
  lastPipeline: ValidationCheck;
};

export async function validateGitlabPipelineSetup(configId: string): Promise<GitlabValidationResult> {
  const session = await requireTeamAccess();
  const config = await queries.getGitlabPipelineConfig(configId, session.team.id);
  if (!config) throw new Error('Config not found');

  const result: GitlabValidationResult = {
    gitlabAccount: { status: 'skip', message: '' },
    ciFile: { status: 'skip', message: '' },
    variableToken: { status: 'skip', message: '' },
    variableUrl: { status: 'skip', message: '' },
    runner: { status: 'skip', message: '' },
    serverUrl: { status: 'skip', message: '' },
    lastPipeline: { status: 'skip', message: '' },
  };

  const glAccount = await queries.getGitlabAccountByTeam(session.team.id);
  if (!glAccount) {
    result.gitlabAccount = { status: 'fail', message: 'No GitLab account connected' };
    result.ciFile = { status: 'skip', message: 'Requires GitLab account' };
    result.variableToken = { status: 'skip', message: 'Requires GitLab account' };
    result.variableUrl = { status: 'skip', message: 'Requires GitLab account' };
    result.lastPipeline = { status: 'skip', message: 'Requires GitLab account' };
  } else if (!config.gitlabProjectId) {
    result.gitlabAccount = { status: 'pass', message: `Connected as @${glAccount.gitlabUsername}` };
    result.ciFile = { status: 'fail', message: 'Config has no gitlabProjectId' };
  } else {
    const instanceUrl = glAccount.instanceUrl || 'https://gitlab.com';
    result.gitlabAccount = {
      status: 'pass',
      message: `Connected as @${glAccount.gitlabUsername} on ${instanceUrl}`,
    };

    const [ciFileResult, tokenVarResult, urlVarResult, lastPipelineResult] = await Promise.allSettled([
      config.deliveryMode === 'ci_file'
        ? getCiFileMeta(glAccount.accessToken, instanceUrl, config.gitlabProjectId, 'main')
        : Promise.resolve(null),
      checkProjectVariableExists(glAccount.accessToken, instanceUrl, config.gitlabProjectId, 'LASTEST_TOKEN'),
      checkProjectVariableExists(glAccount.accessToken, instanceUrl, config.gitlabProjectId, 'LASTEST_URL'),
      getLatestPipeline(glAccount.accessToken, instanceUrl, config.gitlabProjectId),
    ]);

    if (config.deliveryMode === 'ci_file') {
      if (ciFileResult.status === 'fulfilled') {
        result.ciFile = ciFileResult.value
          ? { status: 'pass', message: '.gitlab-ci.yml exists' }
          : { status: 'fail', message: '.gitlab-ci.yml not found in repo' };
      } else {
        result.ciFile = { status: 'fail', message: `API error: ${ciFileResult.reason?.message || 'Unknown'}` };
      }
    } else {
      result.ciFile = { status: 'pass', message: 'webhook delivery mode (no CI file expected)' };
    }

    if (tokenVarResult.status === 'fulfilled') {
      result.variableToken = tokenVarResult.value
        ? { status: 'pass', message: 'LASTEST_TOKEN variable is set' }
        : { status: 'fail', message: 'LASTEST_TOKEN variable not found' };
    } else {
      result.variableToken = { status: 'fail', message: `API error: ${tokenVarResult.reason?.message || 'Unknown'}` };
    }

    if (urlVarResult.status === 'fulfilled') {
      result.variableUrl = urlVarResult.value
        ? { status: 'pass', message: 'LASTEST_URL variable is set' }
        : { status: 'fail', message: 'LASTEST_URL variable not found' };
    } else {
      result.variableUrl = { status: 'fail', message: `API error: ${urlVarResult.reason?.message || 'Unknown'}` };
    }

    if (lastPipelineResult.status === 'fulfilled') {
      const p = lastPipelineResult.value;
      if (!p) {
        result.lastPipeline = { status: 'warn', message: 'No pipelines found yet' };
      } else if (p.status === 'success') {
        result.lastPipeline = { status: 'pass', message: `Last pipeline succeeded (${new Date(p.created_at).toLocaleDateString()})` };
      } else if (p.status === 'running' || p.status === 'pending' || p.status === 'created') {
        result.lastPipeline = { status: 'warn', message: `Pipeline ${p.status}` };
      } else {
        result.lastPipeline = { status: 'fail', message: `Last pipeline: ${p.status}` };
      }
    } else {
      result.lastPipeline = { status: 'warn', message: 'Could not fetch pipelines' };
    }
  }

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
    const mode = config.mode as GitlabPipelineMode;
    if (mode === 'persistent') {
      result.runner = { status: 'fail', message: 'No runner assigned (persistent mode requires one)' };
    } else {
      result.runner = { status: 'pass', message: `${mode} mode — runner created on demand` };
    }
  }

  const serverUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_BASE_URL;
  if (!serverUrl || serverUrl === 'http://localhost:3000') {
    result.serverUrl = { status: 'warn', message: `Server URL is "${serverUrl || 'not set'}" — not reachable from GitLab CI` };
  } else {
    try {
      const healthRes = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
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

/**
 * Generate the .gitlab-ci.yml preview for a given config (used by the preview dialog).
 */
export async function previewGitlabCiYaml(configId: string): Promise<string> {
  const session = await requireTeamAccess();
  const config = await queries.getGitlabPipelineConfig(configId, session.team.id);
  if (!config) throw new Error('Config not found');
  return generateCiYaml({
    mode: config.mode as GitlabPipelineMode,
    projectPath: config.projectPath,
    triggerEvents: (config.triggerEvents ?? ['push', 'merge_request']) as GitlabPipelineTriggerEvent[],
    branchFilter: (config.branchFilter ?? ['main']) as string[],
    timeout: config.timeout ?? 300000,
    failOnChanges: config.failOnChanges ?? true,
  });
}
