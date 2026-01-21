'use server';

import { revalidatePath } from 'next/cache';
import { getRunner } from '@/lib/playwright/runner';
import { getServerManager } from '@/lib/playwright/server-manager';
import { getGitInfo } from '@/lib/git/utils';
import * as queries from '@/lib/db/queries';
import { v4 as uuid } from 'uuid';
import type { Test } from '@/lib/db/schema';

export async function createTestRun(testIds?: string[]) {
  const gitInfo = await getGitInfo();

  const run = await queries.createTestRun({
    gitBranch: gitInfo.branch,
    gitCommit: gitInfo.commit,
    startedAt: new Date(),
    status: 'running',
  });

  return run;
}

export async function runTests(testIds?: string[], repositoryId?: string | null) {
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

  // Create test run record
  const gitInfo = await getGitInfo();
  const run = await queries.createTestRun({
    repositoryId: repositoryId ?? undefined,
    gitBranch: gitInfo.branch,
    gitCommit: gitInfo.commit,
    startedAt: new Date(),
    status: 'running',
  });

  // Run tests (this happens async)
  runTestsAsync(run.id, tests, repositoryId);

  return { runId: run.id, testCount: tests.length };
}

async function runTestsAsync(runId: string, tests: Test[], repositoryId?: string | null) {
  const runner = getRunner(repositoryId);

  try {
    const results = await runner.runTests(tests, runId);

    // Save results
    for (const result of results) {
      await queries.createTestResult({
        testRunId: runId,
        testId: result.testId,
        status: result.status,
        screenshotPath: result.screenshotPath,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
      });
    }

    // Update run status
    const hasFailures = results.some(r => r.status === 'failed');
    await queries.updateTestRun(runId, {
      completedAt: new Date(),
      status: hasFailures ? 'failed' : 'passed',
    });

  } catch (error) {
    await queries.updateTestRun(runId, {
      completedAt: new Date(),
      status: 'failed',
    });
  }

  revalidatePath('/run');
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
