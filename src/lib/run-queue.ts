import { getRunner } from '@/lib/playwright/runner';
import { getBranchInfo } from '@/lib/github/content';
import * as queries from '@/lib/db/queries';
import type { Test } from '@/lib/db/schema';

export type QueuedRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CompletedTestResult {
  testId: string;
  status: 'passed' | 'failed' | 'skipped';
  screenshotPath?: string;
}

export interface QueuedRun {
  id: string;
  branch: string;
  repositoryId?: string;
  testIds?: string[];
  status: QueuedRunStatus;
  progress: {
    completed: number;
    total: number;
    currentTestName?: string;
  };
  completedResults: CompletedTestResult[];
  startedAt?: Date;
  completedAt?: Date;
  runId?: string;
  error?: string;
}

class RunQueue {
  private queue: Map<string, QueuedRun> = new Map();
  private isProcessing = false;

  addToQueue(branch: string, repositoryId?: string, testIds?: string[]): QueuedRun {
    const id = `queue-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const queuedRun: QueuedRun = {
      id,
      branch,
      repositoryId,
      testIds,
      status: 'queued',
      progress: { completed: 0, total: 0 },
      completedResults: [],
    };

    this.queue.set(id, queuedRun);
    this.processQueue();

    return queuedRun;
  }

  private async processQueue() {
    if (this.isProcessing) return;

    const runner = getRunner();
    if (runner.isActive()) return;

    const nextItem = Array.from(this.queue.values()).find(
      (item) => item.status === 'queued'
    );

    if (!nextItem) return;

    this.isProcessing = true;
    nextItem.status = 'running';
    nextItem.startedAt = new Date();

    try {
      // Load and set playwright settings (viewport, browser, timeouts, etc.)
      const playwrightSettings = await queries.getPlaywrightSettings(nextItem.repositoryId);
      if (playwrightSettings) {
        runner.setSettings(playwrightSettings);
      }

      // Get tests to run
      let tests: Test[];
      if (nextItem.testIds && nextItem.testIds.length > 0) {
        tests = await Promise.all(
          nextItem.testIds.map((id) => queries.getTest(id))
        ).then((results) => results.filter((t): t is Test => t !== undefined));
      } else if (nextItem.repositoryId) {
        tests = await queries.getTestsByRepo(nextItem.repositoryId);
      } else {
        tests = await queries.getTests();
      }

      if (tests.length === 0) {
        throw new Error('No tests to run');
      }

      nextItem.progress.total = tests.length;

      // Get repo and git info via GitHub API
      const repo = nextItem.repositoryId ? await queries.getRepository(nextItem.repositoryId) : null;
      const account = await queries.getGithubAccount();

      let gitCommit = 'unknown';
      const gitBranch = nextItem.branch || repo?.selectedBranch || repo?.defaultBranch || 'main';

      if (account && repo) {
        const branchInfo = await getBranchInfo(account.accessToken, repo.owner, repo.name, gitBranch);
        if (branchInfo) {
          gitCommit = branchInfo.commit.sha.slice(0, 7);
        }
      }

      // Create test run record
      const run = await queries.createTestRun({
        gitBranch,
        gitCommit,
        repositoryId: nextItem.repositoryId,
        startedAt: new Date(),
        status: 'running',
      });

      nextItem.runId = run.id;

      // Run tests with incremental result saving
      const results = await runner.runTests(
        tests,
        run.id,
        (progress) => {
          nextItem.progress.completed = progress.completed;
          nextItem.progress.currentTestName = progress.currentTestName;
        },
        async (result) => {
          // Save result immediately and track in completedResults
          await queries.createTestResult({
            testRunId: run.id,
            testId: result.testId,
            status: result.status,
            screenshotPath: result.screenshotPath,
            screenshots: result.screenshots,
            errorMessage: result.errorMessage,
            durationMs: result.durationMs,
          });
          nextItem.completedResults.push({
            testId: result.testId,
            status: result.status,
            screenshotPath: result.screenshotPath,
          });
        }
      );

      // Update run status
      const hasFailures = results.some((r) => r.status === 'failed');
      await queries.updateTestRun(run.id, {
        completedAt: new Date(),
        status: hasFailures ? 'failed' : 'passed',
      });

      nextItem.status = 'completed';
      nextItem.completedAt = new Date();
    } catch (error) {
      nextItem.status = 'failed';
      nextItem.completedAt = new Date();
      nextItem.error = error instanceof Error ? error.message : 'Unknown error';

      if (nextItem.runId) {
        await queries.updateTestRun(nextItem.runId, {
          completedAt: new Date(),
          status: 'failed',
        });
      }
    } finally {
      this.isProcessing = false;
      // Process next item in queue
      setTimeout(() => this.processQueue(), 100);
    }
  }

  getStatus(): {
    queue: QueuedRun[];
    activeRun: QueuedRun | null;
  } {
    const items = Array.from(this.queue.values());
    const activeRun = items.find((item) => item.status === 'running') || null;

    // Clean up old completed/failed items (keep last 10)
    const completed = items
      .filter((item) => item.status === 'completed' || item.status === 'failed')
      .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0));

    if (completed.length > 10) {
      completed.slice(10).forEach((item) => this.queue.delete(item.id));
    }

    return {
      queue: items.filter((item) => item.status === 'queued' || item.status === 'running'),
      activeRun,
    };
  }

  getQueuedRun(id: string): QueuedRun | undefined {
    return this.queue.get(id);
  }

  clearCompleted() {
    Array.from(this.queue.entries()).forEach(([id, item]) => {
      if (item.status === 'completed' || item.status === 'failed') {
        this.queue.delete(id);
      }
    });
  }
}

// Singleton instance
let runQueueInstance: RunQueue | null = null;

export function getRunQueue(): RunQueue {
  if (!runQueueInstance) {
    runQueueInstance = new RunQueue();
  }
  return runQueueInstance;
}
