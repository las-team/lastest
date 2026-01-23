'use server';

import * as queries from '@/lib/db/queries';
import type { BackgroundJobType } from '@/lib/db/schema';

export async function createJob(
  type: BackgroundJobType,
  label: string,
  totalSteps?: number,
  repositoryId?: string | null
) {
  const { id } = await queries.createBackgroundJob({
    type,
    label,
    totalSteps,
    repositoryId,
  });
  await queries.updateBackgroundJob(id, {
    status: 'running',
    startedAt: new Date(),
  });
  return id;
}

export async function updateJobProgress(
  jobId: string,
  completedSteps: number,
  totalSteps?: number
) {
  const progress = totalSteps && totalSteps > 0
    ? Math.round((completedSteps / totalSteps) * 100)
    : 0;
  await queries.updateBackgroundJob(jobId, {
    completedSteps,
    ...(totalSteps !== undefined ? { totalSteps } : {}),
    progress,
  });
}

export async function completeJob(jobId: string) {
  await queries.updateBackgroundJob(jobId, {
    status: 'completed',
    progress: 100,
    completedAt: new Date(),
  });
}

export async function failJob(jobId: string, error: string) {
  await queries.updateBackgroundJob(jobId, {
    status: 'failed',
    error,
    completedAt: new Date(),
  });
}

export async function getActiveJobs() {
  return queries.getRecentBackgroundJobs(10000);
}
