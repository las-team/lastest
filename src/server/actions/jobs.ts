'use server';

import * as queries from '@/lib/db/queries';
import type { BackgroundJobType } from '@/lib/db/schema';
import { getRunner } from '@/lib/playwright/runner';

export async function createJob(
  type: BackgroundJobType,
  label: string,
  totalSteps?: number,
  repositoryId?: string | null,
  metadata?: Record<string, unknown>
) {
  const { id } = await queries.createBackgroundJob({
    type,
    label,
    totalSteps,
    repositoryId,
    metadata,
  });
  await queries.updateBackgroundJob(id, {
    status: 'running',
    startedAt: new Date(),
  });
  return id;
}

export async function createPendingJob(
  type: BackgroundJobType,
  label: string,
  totalSteps?: number,
  repositoryId?: string | null,
  metadata?: Record<string, unknown>
) {
  const { id } = await queries.createBackgroundJob({
    type,
    label,
    totalSteps,
    repositoryId,
    metadata,
  });
  return id;
}

export async function startJob(jobId: string) {
  await queries.updateBackgroundJob(jobId, {
    status: 'running',
    startedAt: new Date(),
  });
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

export async function cancelJob(jobId: string, repositoryId?: string | null) {
  const job = await queries.getBackgroundJob(jobId);
  if (!job) return { success: false, error: 'Job not found' };

  // If job is running and it's a build, abort the runner
  if (job.status === 'running' && job.type === 'build_run') {
    const runner = getRunner(repositoryId);
    runner.abort();
    await runner.forceReset();
  }

  await queries.updateBackgroundJob(jobId, {
    status: 'failed',
    error: 'Cancelled by user',
    completedAt: new Date(),
  });

  return { success: true };
}

export async function getActiveJobs() {
  return queries.getRecentBackgroundJobs(10000);
}

export async function cleanupStaleJobs(staleThresholdMs = 300000) {
  const count = await queries.markStaleJobsAsCrashed(staleThresholdMs);

  // Reset runner if jobs were cleaned up or if it's stuck
  if (count > 0) {
    const runner = getRunner();
    await runner.forceReset();
  } else {
    // Also check if runner is stuck without any running jobs
    const runner = getRunner();
    if (runner.isActive()) {
      const activeJobs = await queries.getActiveBackgroundJobs();
      const hasRunningBuild = activeJobs.some(j => j.type === 'build_run' && j.status === 'running');
      if (!hasRunningBuild) {
        await runner.forceReset();
      }
    }
  }

  return { cleanedUp: count };
}
