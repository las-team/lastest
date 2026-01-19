'use server';

import * as queries from '@/lib/db/queries';
import { getRunQueue } from '@/lib/run-queue';
import { revalidatePath } from 'next/cache';

export interface BranchRunInfo {
  branch: string;
  run: Awaited<ReturnType<typeof queries.getLatestRunByBranch>> | null;
  results: Awaited<ReturnType<typeof queries.getTestResultsWithTestInfo>>;
  timestamp: Date | null;
}

export async function getLatestRunForBranch(
  branch: string,
  repositoryId?: string
): Promise<BranchRunInfo> {
  const run = await queries.getLatestRunByBranch(branch, repositoryId);

  if (!run) {
    return {
      branch,
      run: null,
      results: [],
      timestamp: null,
    };
  }

  const results = await queries.getTestResultsWithTestInfo(run.id);

  return {
    branch,
    run,
    results,
    timestamp: run.startedAt,
  };
}

export async function queueRunForBranch(branch: string, testIds?: string[]) {
  const queue = getRunQueue();
  const queuedRun = queue.addToQueue(branch, testIds);

  revalidatePath('/compare');

  return {
    queueId: queuedRun.id,
    status: queuedRun.status,
  };
}

export async function getQueueStatus() {
  const queue = getRunQueue();
  return queue.getStatus();
}

export async function getQueuedRunStatus(queueId: string) {
  const queue = getRunQueue();
  return queue.getQueuedRun(queueId);
}
