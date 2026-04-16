'use server';

import { revalidatePath } from 'next/cache';
import { executeTests } from '@/lib/execution/executor';
import { resolveSetupCodeForRunner } from '@/lib/execution/setup-capture';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { getBranchInfo } from '@/lib/github/content';
import * as queries from '@/lib/db/queries';
import type { Test } from '@/lib/db/schema';
import { createJob, createPendingJob, updateJobProgress, completeJob, failJob, isRunnerBusy } from './jobs';

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

  // Storage limit enforcement (off by default)
  if (process.env.ENFORCE_STORAGE_LIMITS === 'true' && repositoryId) {
    const repo = await queries.getRepository(repositoryId);
    if (repo?.teamId) {
      const usage = await queries.getTeamStorageUsage(repo.teamId);
      if (usage && usage.storageUsedBytes >= usage.storageQuotaBytes) {
        throw new Error('Storage limit exceeded. Free up space by deleting old test runs or contact your admin.');
      }
    }
  }

  const targetRunner = runnerId || 'auto';

  // If targeting a specific runner and it's busy, queue this run.
  // For 'auto' mode (pool-managed EBs), check if any pool EB is available.
  if (targetRunner === 'auto' || targetRunner === 'local') {
    const { isPoolBusy } = await import('@/server/actions/embedded-sessions');
    if (await isPoolBusy()) {
      return queueTestRun(testIds, repositoryId, headless, runnerId, forceVideoRecording);
    }
  } else if (await isRunnerBusy(targetRunner)) {
    return queueTestRun(testIds, repositoryId, headless, runnerId, forceVideoRecording);
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
  const jobId = await createJob('test_run', `Test Run (${tests.length} tests)`, tests.length, repositoryId, undefined, targetRunner);

  // Run tests (this happens async)
  runTestsAsync(run.id, tests, repositoryId, headless, jobId, runnerId, forceVideoRecording);

  return { runId: run.id, testCount: tests.length, jobId };
}

async function runTestsAsync(runId: string, tests: Test[], repositoryId?: string | null, headless?: boolean, jobId?: string, runnerId?: string, forceVideoRecording?: boolean) {
  // Use provided jobId or create new one (for backwards compatibility)
  const targetRunner = runnerId || 'auto';
  const activeJobId = jobId ?? await createJob('test_run', `Test Run (${tests.length} tests)`, tests.length, repositoryId, undefined, targetRunner);

  // Get teamId from runner record (not session — session is unavailable in fire-and-forget context)
  let teamId: string | undefined;
  if (runnerId && runnerId !== 'auto') {
    const runnerRecord = await queries.getRunnerById(runnerId);
    teamId = runnerRecord?.teamId;
  }

  // Load environment and playwright settings
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  const playwrightSettings = await queries.getPlaywrightSettings(repositoryId);

  try {
    // Resolve setup code to run on the runner
    const setupInfo = await resolveSetupCodeForRunner(tests);

    const results = await executeTests(tests, runId, {
      repositoryId,
      teamId,
      runnerId: runnerId || 'auto',
      headless,
      environmentConfig: envConfig,
      playwrightSettings,
      setupInfo,
      forceVideoRecording,
      jobId: activeJobId,
    });

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
        consoleErrors: result.consoleErrors,
        networkRequests: result.networkRequests,
        downloads: result.downloads,
        softErrors: result.softErrors,
        networkBodiesPath: result.networkBodiesPath,
        domSnapshot: result.domSnapshot,
        lastReachedStep: result.lastReachedStep,
        totalSteps: result.totalSteps,
      });
      await updateJobProgress(activeJobId, i + 1, tests.length);
    }

    // Update run status
    const hasFailures = results.some(r => r.status === 'failed' || r.status === 'setup_failed');
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

  // Recalculate team storage usage after run completes
  if (repositoryId) {
    const repoForStorage = await queries.getRepository(repositoryId);
    if (repoForStorage?.teamId) {
      const { recalculateTeamStorage } = await import('@/lib/storage/calculator');
      recalculateTeamStorage(repoForStorage.teamId).catch(() => {});
    }
  }

  revalidatePath('/run');
  revalidatePath('/tests', 'layout');
  revalidatePath('/');

  // Process next queued test run for this runner
  processNextQueuedTestRun(repositoryId, targetRunner);
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
  // Check DB for running jobs
  const runningJobs = await queries.getRunningJobsForRunner('auto');
  return {
    isRunning: runningJobs.length > 0,
  };
}

export async function getJobStatus(jobId: string) {
  const job = await queries.getBackgroundJob(jobId);
  return {
    status: job?.status || 'unknown',
    isComplete: job?.status === 'completed' || job?.status === 'failed',
    error: job?.error || undefined,
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

  const targetRunner = runnerId || 'auto';
  const jobId = await createPendingJob(
    'test_run',
    `Queued Test Run (${tests.length} tests)`,
    tests.length,
    repositoryId,
    { testIds: testIds || null, headless, runnerId, forceVideoRecording },
    targetRunner,
  );

  return { runId: null, testCount: tests.length, queued: true, jobId };
}

export async function processNextQueuedTestRun(repositoryId?: string | null, targetRunnerId?: string) {
  const effectiveRunner = targetRunnerId || 'auto';

  // Don't process if this runner is still busy
  if (await isRunnerBusy(effectiveRunner)) return;

  const pendingJobs = await queries.getPendingTestRunJobs(repositoryId, effectiveRunner);
  if (pendingJobs.length === 0) return;

  const nextJob = pendingJobs[0];
  const metadata = nextJob.metadata as {
    testIds?: string[] | null;
    headless?: boolean;
    runnerId?: string;
    forceVideoRecording?: boolean;
  } | null;

  // Complete the queue placeholder — runTests creates its own running job.
  // We must NOT call startJob() here because that marks it 'running', which causes
  // runTests' isRunnerBusy() check to see a running job and re-queue.
  await queries.updateBackgroundJob(nextJob.id, {
    status: 'completed',
    completedAt: new Date(),
  });

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
    console.error('[queue] Failed to start queued test run:', error);
  }
}
