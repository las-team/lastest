'use server';

import { revalidatePath } from 'next/cache';
import { getRunner } from '@/lib/playwright/runner';
import { getServerManager } from '@/lib/playwright/server-manager';
import { getBranchInfo } from '@/lib/github/content';
import * as queries from '@/lib/db/queries';
import { v4 as uuid } from 'uuid';
import type { Test } from '@/lib/db/schema';
import { createJob, updateJobProgress, completeJob, failJob } from './jobs';

interface GitInfo {
  branch: string;
  commit: string;
}

async function getGitInfoFromGitHub(repositoryId: string | null): Promise<GitInfo> {
  if (!repositoryId) {
    return { branch: 'unknown', commit: 'unknown' };
  }

  const account = await queries.getGithubAccount();
  const repo = await queries.getRepository(repositoryId);

  if (!account || !repo) {
    return { branch: 'unknown', commit: 'unknown' };
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
  // Get repo for git info via GitHub API
  const repo = repositoryId ? await queries.getRepository(repositoryId) : await queries.getSelectedRepository();
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

export async function runTests(testIds?: string[], repositoryId?: string | null, headless?: boolean) {
  const runner = getRunner(repositoryId);

  if (runner.isActive()) {
    throw new Error('Tests already running');
  }

  // Load and set environment config
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  if (envConfig && envConfig.id) {
    runner.setEnvironmentConfig(envConfig);
    const serverManager = getServerManager();
    serverManager.setConfig(envConfig);
  }

  // Get tests to run
  let tests: Test[];
  if (testIds && testIds.length > 0) {
    tests = await Promise.all(
      testIds.map(id => queries.getTest(id))
    ).then(results => results.filter((t): t is Test => t !== undefined));
  } else if (repositoryId) {
    tests = await queries.getTestsByRepo(repositoryId);
  } else {
    tests = await queries.getTests();
  }

  if (tests.length === 0) {
    throw new Error('No tests to run');
  }

  // Get repo for git info via GitHub API
  const repo = repositoryId ? await queries.getRepository(repositoryId) : await queries.getSelectedRepository();
  const gitInfo = await getGitInfoFromGitHub(repositoryId ?? repo?.id ?? null);

  // Create test run record
  const run = await queries.createTestRun({
    repositoryId: repositoryId ?? repo?.id,
    gitBranch: gitInfo.branch,
    gitCommit: gitInfo.commit,
    startedAt: new Date(),
    status: 'running',
  });

  // Run tests (this happens async)
  runTestsAsync(run.id, tests, repositoryId, headless);

  return { runId: run.id, testCount: tests.length };
}

async function runTestsAsync(runId: string, tests: Test[], repositoryId?: string | null, headless?: boolean) {
  const runner = getRunner(repositoryId);
  const jobId = await createJob('test_run', `Test Run (${tests.length} tests)`, tests.length, repositoryId);

  try {
    const results = await runner.runTests(tests, runId, undefined, undefined, headless);

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
      });
      await updateJobProgress(jobId, i + 1, tests.length);
    }

    // Update run status
    const hasFailures = results.some(r => r.status === 'failed');
    await queries.updateTestRun(runId, {
      completedAt: new Date(),
      status: hasFailures ? 'failed' : 'passed',
    });
    await completeJob(jobId);
  } catch (error) {
    await queries.updateTestRun(runId, {
      completedAt: new Date(),
      status: 'failed',
    });
    await failJob(jobId, error instanceof Error ? error.message : 'Test run failed');
  }

  revalidatePath('/run');
  revalidatePath('/tests', 'layout');
  revalidatePath('/');
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
