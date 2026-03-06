import { db } from '../index';
import {
  backgroundJobs,
  builds,
  testRuns,
} from '../schema';
import type {
  NewBackgroundJob,
  BackgroundJobType,
} from '../schema';
import { eq, desc, and, or, gte, lt, isNull } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// Background Jobs
export async function createBackgroundJob(data: {
  type: BackgroundJobType;
  label: string;
  totalSteps?: number;
  repositoryId?: string | null;
  metadata?: Record<string, unknown>;
  parentJobId?: string | null;
  targetRunnerId?: string | null;
}) {
  const id = uuid();
  const now = new Date();
  await db.insert(backgroundJobs).values({
    id,
    type: data.type,
    status: 'pending',
    label: data.label,
    totalSteps: data.totalSteps ?? null,
    completedSteps: 0,
    progress: 0,
    repositoryId: data.repositoryId ?? null,
    metadata: data.metadata ?? null,
    parentJobId: data.parentJobId ?? null,
    targetRunnerId: data.targetRunnerId ?? null,
    createdAt: now,
  });
  return { id };
}

export async function updateBackgroundJob(id: string, data: Partial<NewBackgroundJob>) {
  await db.update(backgroundJobs).set(data).where(eq(backgroundJobs.id, id));
}

export async function getActiveBackgroundJobs() {
  return db
    .select()
    .from(backgroundJobs)
    .where(or(eq(backgroundJobs.status, 'pending'), eq(backgroundJobs.status, 'running')))
    .orderBy(desc(backgroundJobs.createdAt))
    .all();
}

export async function getRecentBackgroundJobs(sinceMs = 10000) {
  const since = new Date(Date.now() - sinceMs);
  return db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        isNull(backgroundJobs.parentJobId),
        or(
          or(eq(backgroundJobs.status, 'pending'), eq(backgroundJobs.status, 'running')),
          and(
            or(eq(backgroundJobs.status, 'completed'), eq(backgroundJobs.status, 'failed')),
            gte(backgroundJobs.completedAt, since)
          )
        )
      )
    )
    .orderBy(desc(backgroundJobs.createdAt))
    .all();
}

export async function getChildJobs(parentJobId: string) {
  return db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.parentJobId, parentJobId))
    .orderBy(desc(backgroundJobs.createdAt))
    .all();
}

export async function getBackgroundJob(id: string) {
  return db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).get();
}

export async function deleteBackgroundJob(id: string) {
  await db.delete(backgroundJobs).where(eq(backgroundJobs.parentJobId, id));
  await db.delete(backgroundJobs).where(eq(backgroundJobs.id, id));
}

export async function getPendingBuildJobs(repositoryId?: string | null, targetRunnerId?: string) {
  const conditions = [
    eq(backgroundJobs.status, 'pending'),
    eq(backgroundJobs.type, 'build_run'),
  ];
  if (repositoryId) {
    conditions.push(eq(backgroundJobs.repositoryId, repositoryId));
  }
  if (targetRunnerId) {
    conditions.push(eq(backgroundJobs.targetRunnerId, targetRunnerId));
  }
  return db
    .select()
    .from(backgroundJobs)
    .where(and(...conditions))
    .orderBy(backgroundJobs.createdAt)
    .all();
}

export async function getPendingTestRunJobs(repositoryId?: string | null, targetRunnerId?: string) {
  const conditions = [
    eq(backgroundJobs.status, 'pending'),
    eq(backgroundJobs.type, 'test_run'),
  ];
  if (repositoryId) {
    conditions.push(eq(backgroundJobs.repositoryId, repositoryId));
  }
  if (targetRunnerId) {
    conditions.push(eq(backgroundJobs.targetRunnerId, targetRunnerId));
  }
  return db
    .select()
    .from(backgroundJobs)
    .where(and(...conditions))
    .orderBy(backgroundJobs.createdAt)
    .all();
}

export async function getRunningJobsForRunner(targetRunnerId: string) {
  return db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.status, 'running'),
        eq(backgroundJobs.targetRunnerId, targetRunnerId),
        or(eq(backgroundJobs.type, 'build_run'), eq(backgroundJobs.type, 'test_run'))
      )
    )
    .all();
}

export async function getBackgroundJobByBuildId(buildId: string) {
  const jobs = await db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.type, 'build_run'),
      )
    )
    .orderBy(desc(backgroundJobs.createdAt))
    .all();

  return jobs.find(job => {
    const meta = job.metadata as { buildId?: string } | null;
    return meta?.buildId === buildId;
  }) ?? null;
}

export async function markStaleJobsAsCrashed(staleThresholdMs = 300000) {
  const threshold = new Date(Date.now() - staleThresholdMs);
  // Check lastActivityAt first (if set), otherwise fall back to startedAt
  // This prevents killing jobs that are actively making progress
  const staleJobs = await db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.status, 'running'),
        or(
          // Job has lastActivityAt set and it's stale
          and(
            backgroundJobs.lastActivityAt,
            lt(backgroundJobs.lastActivityAt, threshold)
          ),
          // Job has no lastActivityAt (legacy) and startedAt is stale
          and(
            isNull(backgroundJobs.lastActivityAt),
            lt(backgroundJobs.startedAt, threshold)
          )
        )
      )
    )
    .all();

  const now = new Date();
  for (const job of staleJobs) {
    await db.update(backgroundJobs).set({
      status: 'failed',
      error: 'Job timed out (no progress for 5 minutes)',
      completedAt: now,
    }).where(eq(backgroundJobs.id, job.id));

    // Also update associated build and test run if this is a build_run job
    if (job.type === 'build_run' && job.metadata) {
      const meta = job.metadata as { buildId?: string; testRunId?: string };
      if (meta.buildId) {
        await db.update(builds).set({
          overallStatus: 'blocked',
          completedAt: now,
        }).where(eq(builds.id, meta.buildId));
      }
      if (meta.testRunId) {
        await db.update(testRuns).set({
          status: 'failed',
          completedAt: now,
        }).where(eq(testRuns.id, meta.testRunId));
      }
    }
  }

  return staleJobs;
}
