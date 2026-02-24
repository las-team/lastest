'use server';

import * as queries from '@/lib/db/queries';
import type { BackgroundJobType } from '@/lib/db/schema';
import { getRunner } from '@/lib/playwright/runner';
import { queueCancelCommandToDB } from '@/app/api/ws/runner/route';

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
  const now = new Date();
  await queries.updateBackgroundJob(id, {
    status: 'running',
    startedAt: now,
    lastActivityAt: now,
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
  const now = new Date();
  await queries.updateBackgroundJob(jobId, {
    status: 'running',
    startedAt: now,
    lastActivityAt: now,
  });
}

export async function updateJobProgress(
  jobId: string,
  completedSteps: number,
  totalSteps?: number,
  parallelInfo?: { activeCount?: number; activeTests?: string[] }
) {
  const progress = totalSteps && totalSteps > 0
    ? Math.round((completedSteps / totalSteps) * 100)
    : 0;

  // Build metadata update for parallel execution info
  const metadataUpdate = parallelInfo ? {
    activeCount: parallelInfo.activeCount ?? 0,
    activeTests: parallelInfo.activeTests ?? [],
  } : undefined;

  // Get existing job to merge metadata
  const existingJob = await queries.getBackgroundJob(jobId);
  const mergedMetadata = existingJob?.metadata
    ? { ...(existingJob.metadata as Record<string, unknown>), ...metadataUpdate }
    : metadataUpdate;

  await queries.updateBackgroundJob(jobId, {
    completedSteps,
    ...(totalSteps !== undefined ? { totalSteps } : {}),
    progress,
    lastActivityAt: new Date(),
    ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
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

export async function createChildJob(
  type: BackgroundJobType,
  label: string,
  parentJobId: string,
  repositoryId?: string | null,
  metadata?: Record<string, unknown>
) {
  const { id } = await queries.createBackgroundJob({
    type,
    label,
    repositoryId,
    metadata,
    parentJobId,
  });
  const now = new Date();
  await queries.updateBackgroundJob(id, {
    status: 'running',
    startedAt: now,
    lastActivityAt: now,
  });
  return id;
}

export async function cancelJob(jobId: string, repositoryId?: string | null, runnerId?: string | null) {
  const job = await queries.getBackgroundJob(jobId);
  if (!job) return { success: false, error: 'Job not found' };

  // If job is running and it's a build or test run, abort the runner
  if (job.status === 'running' && (job.type === 'build_run' || job.type === 'test_run')) {
    const runner = getRunner(repositoryId);
    runner.abort();
    await runner.forceReset();
  }

  // If a remote runner is assigned, send cancel command
  if (runnerId && job.status === 'running') {
    // Extract testRunId from job metadata if available
    const testRunId = (job.metadata as Record<string, unknown>)?.testRunId as string | undefined;
    if (testRunId) {
      await queueCancelCommandToDB(runnerId, testRunId, 'Cancelled by user');
    }
  }

  // Update build/testRun statuses so they don't stay stuck
  if (job.type === 'build_run' && job.status === 'running' && job.metadata) {
    const meta = job.metadata as { buildId?: string; testRunId?: string };
    const now = new Date();
    if (meta.buildId) {
      await queries.updateBuild(meta.buildId, {
        overallStatus: 'blocked',
        completedAt: now,
      });
    }
    if (meta.testRunId) {
      await queries.updateTestRun(meta.testRunId, {
        status: 'failed',
        completedAt: now,
      });
    }
  }

  // Cascade-cancel running/pending child jobs
  const children = await queries.getChildJobs(jobId);
  for (const child of children) {
    if (child.status === 'running' || child.status === 'pending') {
      await queries.updateBackgroundJob(child.id, {
        status: 'failed',
        error: 'Parent job cancelled',
        completedAt: new Date(),
      });
    }
  }

  await queries.updateBackgroundJob(jobId, {
    status: 'failed',
    error: 'Cancelled by user',
    completedAt: new Date(),
  });

  // If this was the active job, process next queued job of the same type
  if (job.status === 'running' && (job.type === 'build_run' || job.type === 'test_run')) {
    // Dynamically import to avoid circular deps
    if (job.type === 'build_run') {
      const { processNextQueuedBuild } = await import('./builds');
      processNextQueuedBuild(repositoryId);
    } else {
      const { processNextQueuedTestRun } = await import('./runs');
      processNextQueuedTestRun(repositoryId);
    }
  }

  return { success: true };
}

export async function dismissJob(jobId: string) {
  const job = await queries.getBackgroundJob(jobId);
  if (!job) return { success: false, error: 'Job not found' };
  if (job.status === 'running' || job.status === 'pending') {
    return { success: false, error: 'Cannot dismiss an active job' };
  }
  await queries.deleteBackgroundJob(jobId);
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
