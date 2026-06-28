import { db } from "../index";
import { backgroundJobs, builds, testResults, testRuns } from "../schema";
import type { NewBackgroundJob, BackgroundJobType } from "../schema";
import {
  eq,
  desc,
  and,
  or,
  gte,
  lt,
  isNull,
  isNotNull,
  inArray,
} from "drizzle-orm";
import { v4 as uuid } from "uuid";

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
    status: "pending",
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

export async function updateBackgroundJob(
  id: string,
  data: Partial<NewBackgroundJob>,
) {
  await db.update(backgroundJobs).set(data).where(eq(backgroundJobs.id, id));
}

export async function getActiveBackgroundJobs() {
  return db
    .select()
    .from(backgroundJobs)
    .where(
      or(
        eq(backgroundJobs.status, "pending"),
        eq(backgroundJobs.status, "running"),
      ),
    )
    .orderBy(desc(backgroundJobs.createdAt));
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
          or(
            eq(backgroundJobs.status, "pending"),
            eq(backgroundJobs.status, "running"),
          ),
          and(
            or(
              eq(backgroundJobs.status, "completed"),
              eq(backgroundJobs.status, "failed"),
            ),
            gte(backgroundJobs.completedAt, since),
          ),
        ),
      ),
    )
    .orderBy(desc(backgroundJobs.createdAt));
}

export async function getChildJobs(parentJobId: string) {
  return db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.parentJobId, parentJobId))
    .orderBy(desc(backgroundJobs.createdAt));
}

export async function getChildJobsByParentIds(parentIds: string[]) {
  if (parentIds.length === 0) return [];
  return db
    .select()
    .from(backgroundJobs)
    .where(inArray(backgroundJobs.parentJobId, parentIds))
    .orderBy(desc(backgroundJobs.createdAt));
}

export async function getBackgroundJob(id: string) {
  const [row] = await db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.id, id));
  return row;
}

export async function deleteBackgroundJob(id: string) {
  await db.delete(backgroundJobs).where(eq(backgroundJobs.parentJobId, id));
  await db.delete(backgroundJobs).where(eq(backgroundJobs.id, id));
}

export async function getPendingBuildJobs(
  repositoryId?: string | null,
  targetRunnerId?: string,
) {
  const conditions = [
    eq(backgroundJobs.status, "pending"),
    eq(backgroundJobs.type, "build_run"),
  ];
  if (repositoryId) {
    conditions.push(eq(backgroundJobs.repositoryId, repositoryId));
  }
  if (targetRunnerId) {
    conditions.push(eq(backgroundJobs.targetRunnerId, targetRunnerId));
  } else {
    // Pool mode: find jobs with no assigned runner (waiting for any available EB)
    conditions.push(isNull(backgroundJobs.targetRunnerId));
  }
  return db
    .select()
    .from(backgroundJobs)
    .where(and(...conditions))
    .orderBy(backgroundJobs.createdAt);
}

export async function getPendingTestRunJobs(
  repositoryId?: string | null,
  targetRunnerId?: string,
) {
  const conditions = [
    eq(backgroundJobs.status, "pending"),
    eq(backgroundJobs.type, "test_run"),
  ];
  if (repositoryId) {
    conditions.push(eq(backgroundJobs.repositoryId, repositoryId));
  }
  if (targetRunnerId) {
    conditions.push(eq(backgroundJobs.targetRunnerId, targetRunnerId));
  } else {
    // Pool mode: find jobs with no assigned runner (waiting for any available EB)
    conditions.push(isNull(backgroundJobs.targetRunnerId));
  }
  return db
    .select()
    .from(backgroundJobs)
    .where(and(...conditions))
    .orderBy(backgroundJobs.createdAt);
}

export async function getRunningJobsForRunner(targetRunnerId: string) {
  return db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.status, "running"),
        eq(backgroundJobs.targetRunnerId, targetRunnerId),
        or(
          eq(backgroundJobs.type, "build_run"),
          eq(backgroundJobs.type, "test_run"),
        ),
      ),
    );
}

export async function getBackgroundJobByBuildId(buildId: string) {
  const jobs = await db
    .select()
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.type, "build_run")))
    .orderBy(desc(backgroundJobs.createdAt));
  return (
    jobs.find((job) => {
      const meta = job.metadata as { buildId?: string } | null;
      return meta?.buildId === buildId;
    }) ?? null
  );
}

// Shown on the build's executorError + the timed-out job's error. The "no
// embedded browser" hint is the dominant cause when a build_run stalls with
// zero progress — the provisioner couldn't claim/launch an EB so no test ever
// ran. Kept generic enough to stay honest for other stall causes.
const JOB_TIMEOUT_ERROR =
  "Job timed out — no progress for 5 minutes. An embedded browser may not have been assigned.";

// Marks one stale/timed-out job as failed and finalizes its build + test run.
// For a build_run we count how many test_results actually landed: zero results
// means the executor never produced anything (clean infra failure) so the build
// gets the sticky `executor_failed` status that the verify board's "Build
// failed — no tests ran" banner keys off; a partial run stays `blocked`.
// Idempotent — safe to call from both the global sweep and the targeted
// per-build reconcile.
async function finalizeTimedOutJob(
  job: typeof backgroundJobs.$inferSelect,
  now: Date,
): Promise<void> {
  await db
    .update(backgroundJobs)
    .set({
      status: "failed",
      error: JOB_TIMEOUT_ERROR,
      completedAt: now,
    })
    .where(eq(backgroundJobs.id, job.id));

  if (job.type !== "build_run" || !job.metadata) return;
  const meta = job.metadata as { buildId?: string; testRunId?: string };

  if (meta.buildId) {
    let writtenResults = 0;
    if (meta.testRunId) {
      const rows = await db
        .select({ id: testResults.id })
        .from(testResults)
        .where(eq(testResults.testRunId, meta.testRunId));
      writtenResults = rows.length;
    }
    await db
      .update(builds)
      .set({
        overallStatus: writtenResults === 0 ? "executor_failed" : "blocked",
        completedAt: now,
        executorError: JOB_TIMEOUT_ERROR,
        executorFailedAt: now,
      })
      .where(eq(builds.id, meta.buildId));
  }
  if (meta.testRunId) {
    await db
      .update(testRuns)
      .set({
        status: "failed",
        completedAt: now,
      })
      .where(eq(testRuns.id, meta.testRunId));
  }
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
        eq(backgroundJobs.status, "running"),
        or(
          // Job has lastActivityAt set and it's stale
          and(
            isNotNull(backgroundJobs.lastActivityAt),
            lt(backgroundJobs.lastActivityAt, threshold),
          ),
          // Job has no lastActivityAt (legacy) and startedAt is stale
          and(
            isNull(backgroundJobs.lastActivityAt),
            lt(backgroundJobs.startedAt, threshold),
          ),
        ),
      ),
    );
  const now = new Date();
  for (const job of staleJobs) {
    await finalizeTimedOutJob(job, now);
  }

  return staleJobs;
}

// Targeted equivalent of markStaleJobsAsCrashed for a single build. The verify
// page polls /api/builds/[buildId]/verify-status, which does NOT run the global
// stale-job sweep (that only fires from the jobs endpoints). Without this, an
// EB-starved build sits at completedAt=null forever and the failure banner
// stays hidden behind the "running" state. Called from verify-status when the
// build is still running so the timeout surfaces on the verify board itself.
// Returns true if it finalized the build's job.
export async function reconcileBuildJobIfStale(
  buildId: string,
  staleThresholdMs = 300000,
): Promise<boolean> {
  const job = await getBackgroundJobByBuildId(buildId);
  if (!job || job.status !== "running") return false;

  const threshold = new Date(Date.now() - staleThresholdMs);
  const lastActivity = job.lastActivityAt ?? job.startedAt;
  // No timestamp at all → can't judge staleness; leave it alone.
  if (!lastActivity || lastActivity >= threshold) return false;

  await finalizeTimedOutJob(job, new Date());
  return true;
}
