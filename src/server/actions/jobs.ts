'use server';

import * as queries from '@/lib/db/queries';
import type { BackgroundJobType } from '@/lib/db/schema';
import { queueCancelCommandToDB } from '@/app/api/ws/runner/route';

export async function isRunnerBusy(targetRunnerId: string): Promise<boolean> {
  const running = await queries.getRunningJobsForRunner(targetRunnerId);
  return running.length > 0;
}

export async function createJob(
  type: BackgroundJobType,
  label: string,
  totalSteps?: number,
  repositoryId?: string | null,
  metadata?: Record<string, unknown>,
  targetRunnerId?: string,
) {
  const { id } = await queries.createBackgroundJob({
    type,
    label,
    totalSteps,
    repositoryId,
    metadata,
    targetRunnerId: targetRunnerId ?? null,
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
  metadata?: Record<string, unknown>,
  targetRunnerId?: string,
) {
  const { id } = await queries.createBackgroundJob({
    type,
    label,
    totalSteps,
    repositoryId,
    metadata,
    targetRunnerId: targetRunnerId ?? null,
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

  // For pending (queued) jobs that haven't started, just delete them entirely
  if (job.status === 'pending') {
    await queries.deleteBackgroundJob(jobId);
    return { success: true };
  }

  // Determine the effective runner — prefer job's stored targetRunnerId, fall back to passed runnerId
  const effectiveRunnerId = job.targetRunnerId || runnerId;

  // If a remote runner is assigned, send cancel command
  if (effectiveRunnerId && effectiveRunnerId !== 'auto' && job.status === 'running') {
    // Extract testRunId from job metadata if available
    const testRunId = (job.metadata as Record<string, unknown>)?.testRunId as string | undefined;
    if (testRunId) {
      await queueCancelCommandToDB(effectiveRunnerId, testRunId, 'Cancelled by user');
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

  // If this was the active job, process next queued job of the same type for the same runner
  if (job.status === 'running' && (job.type === 'build_run' || job.type === 'test_run')) {
    const targetRunner = job.targetRunnerId || 'auto';
    // Dynamically import to avoid circular deps
    if (job.type === 'build_run') {
      const { processNextQueuedBuild } = await import('./builds');
      processNextQueuedBuild(repositoryId, targetRunner);
    } else {
      const { processNextQueuedTestRun } = await import('./runs');
      processNextQueuedTestRun(repositoryId, targetRunner);
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
  const staleJobs = await queries.markStaleJobsAsCrashed(staleThresholdMs);

  // Trigger processNext* for each distinct (repositoryId, targetRunnerId) pair
  if (staleJobs.length > 0) {
    const jobsByRunner = new Map<string, Set<string | null>>();
    for (const j of staleJobs) {
      const rId = j.targetRunnerId || 'auto';
      if (!jobsByRunner.has(rId)) jobsByRunner.set(rId, new Set());
      jobsByRunner.get(rId)!.add(j.repositoryId);
    }
    const { processNextQueuedBuild } = await import('./builds');
    const { processNextQueuedTestRun } = await import('./runs');
    for (const [rId, repoIds] of jobsByRunner) {
      for (const repoId of repoIds) {
        processNextQueuedBuild(repoId, rId);
        processNextQueuedTestRun(repoId, rId);
      }
    }
  }

  return { cleanedUp: staleJobs.length };
}
