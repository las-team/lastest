'use server';

import { revalidatePath } from 'next/cache';
import { getRunner } from '@/lib/playwright/runner';
import { getServerManager } from '@/lib/playwright/server-manager';
import { executeTests } from '@/lib/execution/executor';
import { resolveSetupCodeForRunner } from '@/lib/execution/setup-capture';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { getBranchInfo } from '@/lib/github/content';
import * as queries from '@/lib/db/queries';
import { v4 as uuid } from 'uuid';
import type { Test } from '@/lib/db/schema';
import { createJob, createPendingJob, startJob, updateJobProgress, completeJob, failJob } from './jobs';

interface GitInfo {
  branch: string;
  commit: string;
}

async function getGitInfoFromGitHub(repositoryId: string | null): Promise<GitInfo> {
  if (!repositoryId) {
    return { branch: 'unknown', commit: 'unknown' };
  }

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    return { branch: 'unknown', commit: 'unknown' };
  }

  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account) {
    return { branch: repo.selectedBranch || repo.defaultBranch || 'main', commit: 'unknown' };
  }

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';
  const branchInfo = await getBranchInfo(account.accessToken, repo.owner, repo.name, branch);

  if (!branchInfo) {
    return { branch, commit: 'unknown' };
  }

  return {
    branch: branchInfo.name,
    commit: branchInfo.commit.sha.slice(0, 7),
  };
}

export async function createTestRun(testIds?: string[], repositoryId?: string | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  // Get repo for git info via GitHub API
  const repo = repositoryId ? await queries.getRepository(repositoryId) : null;
  const gitInfo = await getGitInfoFromGitHub(repositoryId ?? repo?.id ?? null);

  const run = await queries.createTestRun({
    repositoryId: repositoryId ?? repo?.id,
    gitBranch: gitInfo.branch,
    gitCommit: gitInfo.commit,
    startedAt: new Date(),
    status: 'running',
  });

  return run;
}

export async function runTests(testIds?: string[], repositoryId?: string | null, headless?: boolean, runnerId?: string, forceVideoRecording?: boolean) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  const runner = getRunner(repositoryId);

  // If tests are running, queue this run
  if (runner.isActive()) {
    return queueTestRun(testIds, repositoryId, headless, runnerId, forceVideoRecording);
  }

  // Load and set environment config
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  if (envConfig && envConfig.id) {
    runner.setEnvironmentConfig(envConfig);
    const serverManager = getServerManager();
    serverManager.setConfig(envConfig);
  }

  // Load and set playwright settings (viewport, browser, timeouts, etc.)
  const playwrightSettings = await queries.getPlaywrightSettings(repositoryId);
  if (playwrightSettings) {
    runner.setSettings(playwrightSettings);
  }

  // Get tests to run (filter out soft-deleted tests)
  let tests: Test[];
  if (testIds && testIds.length > 0) {
    tests = await Promise.all(
      testIds.map(id => queries.getTest(id))
    ).then(results => results.filter((t): t is Test => t !== undefined && !t.deletedAt));
  } else if (repositoryId) {
    tests = await queries.getTestsByRepo(repositoryId);
  } else {
    tests = [];
  }

  if (tests.length === 0) {
    throw new Error('No tests to run');
  }

  // Get repo for git info via GitHub API
  const repo = repositoryId ? await queries.getRepository(repositoryId) : null;
  const gitInfo = await getGitInfoFromGitHub(repositoryId ?? repo?.id ?? null);

  // Create test run record
  const run = await queries.createTestRun({
    repositoryId: repositoryId ?? repo?.id,
    gitBranch: gitInfo.branch,
    gitCommit: gitInfo.commit,
    startedAt: new Date(),
    status: 'running',
  });

  // Create job first so we can return the jobId
  const jobId = await createJob('test_run', `Test Run (${tests.length} tests)`, tests.length, repositoryId);

  // Run tests (this happens async)
  runTestsAsync(run.id, tests, repositoryId, headless, jobId, runnerId, forceVideoRecording);

  return { runId: run.id, testCount: tests.length, jobId };
}

async function runTestsAsync(runId: string, tests: Test[], repositoryId?: string | null, headless?: boolean, jobId?: string, runnerId?: string, forceVideoRecording?: boolean) {
  const runner = getRunner(repositoryId);

  // Use provided jobId or create new one (for backwards compatibility)
  const activeJobId = jobId ?? await createJob('test_run', `Test Run (${tests.length} tests)`, tests.length, repositoryId);

  // Get teamId from runner record (not session — session is unavailable in fire-and-forget context)
  let teamId: string | undefined;
  if (runnerId && runnerId !== 'local') {
    const runnerRecord = await queries.getRunnerById(runnerId);
    teamId = runnerRecord?.teamId;
  }

  // Load environment and playwright settings
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  const playwrightSettings = await queries.getPlaywrightSettings(repositoryId);

  try {
    let results;

    if (runnerId && runnerId !== 'local' && teamId) {
      // Resolve setup code to run on the runner (not locally — different server instance)
      const setupInfo = await resolveSetupCodeForRunner(tests);

      // Use executor for agent routing
      results = await executeTests(tests, runId, {
        repositoryId,
        teamId,
        runnerId,
        headless,
        environmentConfig: envConfig,
        playwrightSettings,
        setupInfo,
        forceVideoRecording,
        jobId: activeJobId,
      });
    } else {
      // Local execution
      if (envConfig?.id) {
        runner.setEnvironmentConfig(envConfig);
        getServerManager().setConfig(envConfig);
      }
      if (playwrightSettings) {
        runner.setSettings(playwrightSettings);
      }
      // Clear any stale setup context before standalone run
      runner.clearSetupContext();
      results = await runner.runTests(tests, runId, undefined, undefined, headless, undefined, forceVideoRecording);
    }

    // Clear any stale setup context from previous runs
    runner.clearSetupContext();

    // Save results
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      await queries.createTestResult({
        testRunId: runId,
        testId: result.testId,
        status: result.status,
        screenshotPath: result.screenshotPath,
        screenshots: result.screenshots,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
        videoPath: result.videoPath,
        softErrors: result.softErrors,
      });
      await updateJobProgress(activeJobId, i + 1, tests.length);
    }

    // Update run status
    const hasFailures = results.some(r => r.status === 'failed');
    await queries.updateTestRun(runId, {
      completedAt: new Date(),
      status: hasFailures ? 'failed' : 'passed',
    });
    await completeJob(activeJobId);
  } catch (error) {
    await queries.updateTestRun(runId, {
      completedAt: new Date(),
      status: 'failed',
    });
    await failJob(activeJobId, error instanceof Error ? error.message : 'Test run failed');
  }

  revalidatePath('/run');
  revalidatePath('/tests', 'layout');
  revalidatePath('/');

  // Process next queued test run if any
  processNextQueuedTestRun(repositoryId);
}

export async function getTestRun(runId: string) {
  return queries.getTestRun(runId);
}

export async function getTestRunResults(runId: string) {
  return queries.getTestResultsByRun(runId);
}

export async function getTestRuns() {
  return queries.getTestRuns();
}

export async function getRunStatus(repositoryId?: string | null) {
  const runner = getRunner(repositoryId);
  return {
    isRunning: runner.isActive(),
  };
}

export async function getJobStatus(jobId: string) {
  const job = await queries.getBackgroundJob(jobId);
  return {
    status: job?.status || 'unknown',
    isComplete: job?.status === 'completed' || job?.status === 'failed',
  };
}

async function queueTestRun(
  testIds?: string[],
  repositoryId?: string | null,
  headless?: boolean,
  runnerId?: string,
  forceVideoRecording?: boolean,
) {
  // Get tests to determine label (filter out soft-deleted tests)
  let tests: Test[];
  if (testIds && testIds.length > 0) {
    tests = await Promise.all(
      testIds.map(id => queries.getTest(id))
    ).then(results => results.filter((t): t is Test => t !== undefined && !t.deletedAt));
  } else if (repositoryId) {
    tests = await queries.getTestsByRepo(repositoryId);
  } else {
    tests = [];
  }

  if (tests.length === 0) {
    throw new Error('No tests to run');
  }

  const jobId = await createPendingJob(
    'test_run',
    `Queued Test Run (${tests.length} tests)`,
    tests.length,
    repositoryId,
    { testIds: testIds || null, headless, runnerId, forceVideoRecording }
  );

  return { runId: null, testCount: tests.length, queued: true, jobId };
}

export async function processNextQueuedTestRun(repositoryId?: string | null) {
  const runner = getRunner(repositoryId);

  // Don't process if runner is still active
  if (runner.isActive()) return;

  const pendingJobs = await queries.getPendingTestRunJobs(repositoryId);
  if (pendingJobs.length === 0) return;

  const nextJob = pendingJobs[0];
  const metadata = nextJob.metadata as {
    testIds?: string[] | null;
    headless?: boolean;
    runnerId?: string;
    forceVideoRecording?: boolean;
  } | null;

  // Start the job
  await startJob(nextJob.id);

  // Run the tests
  try {
    await runTests(
      metadata?.testIds || undefined,
      nextJob.repositoryId,
      metadata?.headless,
      metadata?.runnerId,
      metadata?.forceVideoRecording,
    );
  } catch (error) {
    await queries.updateBackgroundJob(nextJob.id, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Failed to start test run',
      completedAt: new Date(),
    });
  }
}
