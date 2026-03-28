import { db } from '../index';
import { buildSchedules } from '../schema';
import type { NewBuildSchedule } from '../schema';
import { eq, and, lte } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function createBuildSchedule(data: Omit<NewBuildSchedule, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(buildSchedules).values({
    id,
    ...data,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export async function updateBuildSchedule(id: string, data: Partial<NewBuildSchedule>) {
  await db.update(buildSchedules).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(buildSchedules.id, id));
}

export async function deleteBuildSchedule(id: string) {
  await db.delete(buildSchedules).where(eq(buildSchedules.id, id));
}

export async function getBuildSchedule(id: string) {
  const results = await db.select().from(buildSchedules).where(eq(buildSchedules.id, id));
  return results[0] ?? null;
}

export async function getBuildSchedulesByRepo(repositoryId: string) {
  return db.select().from(buildSchedules).where(eq(buildSchedules.repositoryId, repositoryId));
}

export async function getDueSchedules() {
  const now = new Date();
  return db.select().from(buildSchedules).where(
    and(
      eq(buildSchedules.enabled, true),
      lte(buildSchedules.nextRunAt, now),
    )
  );
}

export async function markScheduleRun(id: string, buildId: string, nextRunAt: Date) {
  await db.update(buildSchedules).set({
    lastRunAt: new Date(),
    lastBuildId: buildId,
    nextRunAt,
    consecutiveFailures: 0,
    updatedAt: new Date(),
  }).where(eq(buildSchedules.id, id));
}

export async function incrementScheduleFailures(id: string) {
  const schedule = await getBuildSchedule(id);
  if (!schedule) return;
  const failures = (schedule.consecutiveFailures ?? 0) + 1;
  const maxFailures = schedule.maxConsecutiveFailures ?? 5;
  await db.update(buildSchedules).set({
    consecutiveFailures: failures,
    enabled: failures >= maxFailures ? false : schedule.enabled,
    updatedAt: new Date(),
  }).where(eq(buildSchedules.id, id));
}
