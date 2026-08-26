import { and, eq, lte } from "drizzle-orm";

import { schedulingBuildSchedules, type NewBuildSchedule } from "../schema";
import type { SchedulingDb } from "./db";

/** Every read and write this plugin performs, all against its own table. */

export async function createBuildSchedule(
  db: SchedulingDb,
  data: Omit<NewBuildSchedule, "id" | "createdAt" | "updatedAt">,
) {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schedulingBuildSchedules).values({
    id,
    ...data,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export async function updateBuildSchedule(
  db: SchedulingDb,
  id: string,
  data: Partial<NewBuildSchedule>,
) {
  await db
    .update(schedulingBuildSchedules)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(schedulingBuildSchedules.id, id));
}

export async function deleteBuildSchedule(db: SchedulingDb, id: string) {
  await db
    .delete(schedulingBuildSchedules)
    .where(eq(schedulingBuildSchedules.id, id));
}

export async function getBuildSchedule(db: SchedulingDb, id: string) {
  const results = await db
    .select()
    .from(schedulingBuildSchedules)
    .where(eq(schedulingBuildSchedules.id, id));
  return results[0] ?? null;
}

export async function getBuildSchedulesByRepo(
  db: SchedulingDb,
  repositoryId: string,
) {
  return db
    .select()
    .from(schedulingBuildSchedules)
    .where(eq(schedulingBuildSchedules.repositoryId, repositoryId));
}

export async function getDueSchedules(db: SchedulingDb) {
  const now = new Date();
  return db
    .select()
    .from(schedulingBuildSchedules)
    .where(
      and(
        eq(schedulingBuildSchedules.enabled, true),
        lte(schedulingBuildSchedules.nextRunAt, now),
      ),
    );
}

export async function markScheduleRun(
  db: SchedulingDb,
  id: string,
  buildId: string,
  nextRunAt: Date,
) {
  await db
    .update(schedulingBuildSchedules)
    .set({
      lastRunAt: new Date(),
      lastBuildId: buildId,
      nextRunAt,
      consecutiveFailures: 0,
      updatedAt: new Date(),
    })
    .where(eq(schedulingBuildSchedules.id, id));
}

export async function incrementScheduleFailures(db: SchedulingDb, id: string) {
  const schedule = await getBuildSchedule(db, id);
  if (!schedule) return;
  const failures = (schedule.consecutiveFailures ?? 0) + 1;
  const maxFailures = schedule.maxConsecutiveFailures ?? 5;
  await db
    .update(schedulingBuildSchedules)
    .set({
      consecutiveFailures: failures,
      enabled: failures >= maxFailures ? false : schedule.enabled,
      updatedAt: new Date(),
    })
    .where(eq(schedulingBuildSchedules.id, id));
}

export async function deleteBuildSchedulesByRepo(
  db: SchedulingDb,
  repositoryId: string,
) {
  await db
    .delete(schedulingBuildSchedules)
    .where(eq(schedulingBuildSchedules.repositoryId, repositoryId));
}
