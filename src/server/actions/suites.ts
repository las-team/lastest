'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { getRunner } from '@/lib/playwright/runner';
import { getServerManager } from '@/lib/playwright/server-manager';
import { executeTests } from '@/lib/execution/executor';
import { captureSetupForRemoteRunner } from '@/lib/execution/setup-capture';
import { getCurrentSession, requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { getBranchInfo } from '@/lib/github/content';
import { createJob, updateJobProgress, completeJob, failJob } from './jobs';
import type { NewSuite, Test } from '@/lib/db/schema';

export async function createSuite(data: { name: string; description?: string; repositoryId?: string }) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  const result = await queries.createSuite(data);
  revalidatePath('/suites');
  return result;
}

export async function updateSuite(id: string, data: Partial<Pick<NewSuite, 'name' | 'description'>>) {
  await requireTeamAccess();
  await queries.updateSuite(id, data);
  revalidatePath('/suites');
  revalidatePath(`/suites/${id}`);
}

export async function deleteSuite(id: string) {
  await requireTeamAccess();
  await queries.deleteSuite(id);
  revalidatePath('/suites');
}

export async function getSuites(repositoryId?: string | null) {
  return queries.getSuites(repositoryId);
}

export async function getSuite(id: string) {
  return queries.getSuite(id);
}

export async function getSuiteWithTests(id: string) {
  return queries.getSuiteWithTests(id);
}

export async function addTestsToSuite(suiteId: string, testIds: string[]) {
  await requireTeamAccess();
  const result = await queries.addTestsToSuite(suiteId, testIds);
  revalidatePath(`/suites/${suiteId}`);
  return result;
}

export async function removeTestFromSuite(suiteId: string, testId: string) {
  await requireTeamAccess();
  await queries.removeTestFromSuite(suiteId, testId);
  revalidatePath(`/suites/${suiteId}`);
}

export async function reorderSuiteTests(suiteId: string, orderedTestIds: string[]) {
  await requireTeamAccess();
  await queries.reorderSuiteTests(suiteId, orderedTestIds);
  revalidatePath(`/suites/${suiteId}`);
}

async function getGitInfo(repositoryId: string | null) {
  if (!repositoryId) return { branch: 'unknown', commit: 'unknown' };

  const repo = await queries.getRepository(repositoryId);
  if (!repo) return { branch: 'unknown', commit: 'unknown' };

  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account) return { branch: repo.selectedBranch || repo.defaultBranch || 'main', commit: 'unknown' };

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';
  const branchInfo = await getBranchInfo(account.accessToken, repo.owner, repo.name, branch);
  if (!branchInfo) return { branch, commit: 'unknown' };

  return { branch: branchInfo.name, commit: branchInfo.commit.sha.slice(0, 7) };
}

export async function runSuite(suiteId: string, runnerId?: string) {
  await requireTeamAccess();
  const suiteWithTests = await queries.getSuiteWithTests(suiteId);
  if (!suiteWithTests) {
    throw new Error('Suite not found');
  }

  if (suiteWithTests.tests.length === 0) {
    throw new Error('Suite has no tests');
  }

  const repositoryId = suiteWithTests.repositoryId;
  const runner = getRunner(repositoryId);

  if (runner.isActive()) {
    throw new Error('Tests already running');
  }

  // Load environment config
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  if (envConfig?.id) {
    runner.setEnvironmentConfig(envConfig);
    getServerManager().setConfig(envConfig);
  }

  // Load playwright settings
  const playwrightSettings = await queries.getPlaywrightSettings(repositoryId);
  if (playwrightSettings) {
    runner.setSettings(playwrightSettings);
  }

  // Get tests in order
  const testIds = suiteWithTests.tests.map((t) => t.testId);
  const tests: Test[] = [];
  for (const id of testIds) {
    const test = await queries.getTest(id);
    if (test) tests.push(test);
  }

  // Get git info
  const gitInfo = await getGitInfo(repositoryId);

  // Create test run
  const run = await queries.createTestRun({
    repositoryId,
    gitBranch: gitInfo.branch,
    gitCommit: gitInfo.commit,
    startedAt: new Date(),
    status: 'running',
  });

  // Run tests async (halt on error)
  runSuiteTestsAsync(run.id, tests, repositoryId, suiteWithTests.name, runnerId);

  return { runId: run.id, testCount: tests.length };
}

async function runSuiteTestsAsync(
  runId: string,
  tests: Test[],
  repositoryId: string | null | undefined,
  suiteName: string,
  runnerId?: string
) {
  const runner = getRunner(repositoryId);
  const jobId = await createJob('test_run', `Suite: ${suiteName}`, tests.length, repositoryId);

  // Get teamId for agent execution
  let teamId: string | undefined;
  if (runnerId && runnerId !== 'local') {
    const session = await getCurrentSession();
    teamId = session?.user?.teamId ?? undefined;
  }

  // Load environment and playwright settings
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  const playwrightSettings = await queries.getPlaywrightSettings(repositoryId);

  // Setup runner for local execution
  if (!runnerId || runnerId === 'local' || !teamId) {
    if (envConfig?.id) {
      runner.setEnvironmentConfig(envConfig);
      getServerManager().setConfig(envConfig);
    }
    if (playwrightSettings) {
      runner.setSettings(playwrightSettings);
    }
  }

  // Capture setup context once for remote runner (before test loop)
  let setupContext: { storageState?: string; variables?: Record<string, unknown> } | undefined;
  if (runnerId && runnerId !== 'local' && teamId) {
    const baseUrl = envConfig?.baseUrl || 'http://localhost:3000';
    setupContext = await captureSetupForRemoteRunner(tests, baseUrl, repositoryId);
  }

  try {
    // Run tests one by one, halt on first failure
    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];

      let results;
      if (runnerId && runnerId !== 'local' && teamId) {
        results = await executeTests([test], runId, {
          repositoryId,
          teamId,
          runnerId,
          environmentConfig: envConfig,
          playwrightSettings,
          setupContext,
        });
      } else {
        results = await runner.runTests([test], runId);
      }

      const result = results[0];

      // Save result
      await queries.createTestResult({
        testRunId: runId,
        testId: result.testId,
        status: result.status,
        screenshotPath: result.screenshotPath,
        screenshots: result.screenshots,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
        videoPath: result.videoPath,
      });

      await updateJobProgress(jobId, i + 1, tests.length);

      // Halt on failure
      if (result.status === 'failed') {
        await queries.updateTestRun(runId, {
          completedAt: new Date(),
          status: 'failed',
        });
        await failJob(jobId, `Test failed: ${test.name}`);
        revalidatePath('/suites');
        return;
      }
    }

    // All passed
    await queries.updateTestRun(runId, {
      completedAt: new Date(),
      status: 'passed',
    });
    await completeJob(jobId);
  } catch (error) {
    await queries.updateTestRun(runId, {
      completedAt: new Date(),
      status: 'failed',
    });
    await failJob(jobId, error instanceof Error ? error.message : 'Suite run failed');
  }

  revalidatePath('/suites');
}

export async function getSuiteRunProgress(runId: string) {
  const run = await queries.getTestRun(runId);
  if (!run) return null;

  const results = await queries.getTestResultsByRun(runId);

  return {
    status: run.status,
    completedAt: run.completedAt,
    results: results.map((r) => ({
      testId: r.testId,
      status: r.status,
      errorMessage: r.errorMessage,
      durationMs: r.durationMs,
    })),
  };
}
