'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { isValidCron, getNextRunTime, describeCron, PRESET_SCHEDULES } from '@/lib/scheduling/cron';
import type { PresetScheduleKey } from '@/lib/scheduling/cron';

export async function createScheduleAction(input: {
  repositoryId: string;
  name: string;
  cronExpression: string;
  preset?: PresetScheduleKey;
  timezone?: string;
  runnerId?: string;
  testIds?: string[];
  suiteId?: string;
  gitBranch?: string;
  maxConsecutiveFailures?: number;
}) {
  await requireRepoAccess(input.repositoryId);

  const cronExpression = input.preset
    ? PRESET_SCHEDULES[input.preset].cron
    : input.cronExpression;

  if (!isValidCron(cronExpression)) {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }

  const nextRunAt = getNextRunTime(cronExpression);

  const result = await queries.createBuildSchedule({
    repositoryId: input.repositoryId,
    name: input.name,
    cronExpression,
    timezone: input.timezone ?? 'UTC',
    runnerId: input.runnerId ?? null,
    testIds: input.testIds ?? null,
    suiteId: input.suiteId ?? null,
    gitBranch: input.gitBranch ?? null,
    nextRunAt,
    maxConsecutiveFailures: input.maxConsecutiveFailures ?? 5,
    enabled: true,
  });

  revalidatePath('/settings');
  return result;
}

export async function updateScheduleAction(id: string, input: {
  repositoryId: string;
  name?: string;
  cronExpression?: string;
  timezone?: string;
  runnerId?: string | null;
  testIds?: string[] | null;
  suiteId?: string | null;
  gitBranch?: string | null;
  maxConsecutiveFailures?: number;
}) {
  await requireRepoAccess(input.repositoryId);

  if (input.cronExpression && !isValidCron(input.cronExpression)) {
    throw new Error(`Invalid cron expression: ${input.cronExpression}`);
  }

  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.cronExpression !== undefined) {
    updates.cronExpression = input.cronExpression;
    updates.nextRunAt = getNextRunTime(input.cronExpression);
  }
  if (input.timezone !== undefined) updates.timezone = input.timezone;
  if (input.runnerId !== undefined) updates.runnerId = input.runnerId;
  if (input.testIds !== undefined) updates.testIds = input.testIds;
  if (input.suiteId !== undefined) updates.suiteId = input.suiteId;
  if (input.gitBranch !== undefined) updates.gitBranch = input.gitBranch;
  if (input.maxConsecutiveFailures !== undefined) updates.maxConsecutiveFailures = input.maxConsecutiveFailures;

  await queries.updateBuildSchedule(id, updates);
  revalidatePath('/settings');
}

export async function deleteScheduleAction(id: string, repositoryId: string) {
  await requireRepoAccess(repositoryId);

  // Verify schedule belongs to this repository (IDOR protection)
  const schedule = await queries.getBuildSchedule(id);
  if (!schedule || schedule.repositoryId !== repositoryId) {
    throw new Error('Schedule not found');
  }

  await queries.deleteBuildSchedule(id);
  revalidatePath('/settings');
}

export async function toggleScheduleAction(id: string, repositoryId: string, enabled: boolean) {
  await requireRepoAccess(repositoryId);

  const schedule = await queries.getBuildSchedule(id);
  if (!schedule) throw new Error('Schedule not found');

  // Verify schedule belongs to this repository (IDOR protection)
  if (schedule.repositoryId !== repositoryId) {
    throw new Error('Schedule not found');
  }

  const updates: Record<string, unknown> = { enabled };
  if (enabled && schedule.cronExpression) {
    // Recompute next run time when re-enabling
    updates.nextRunAt = getNextRunTime(schedule.cronExpression);
    updates.consecutiveFailures = 0;
  }

  await queries.updateBuildSchedule(id, updates);
  revalidatePath('/settings');
}

export async function getSchedulesAction(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  const schedules = await queries.getBuildSchedulesByRepo(repositoryId);
  return schedules.map(s => ({
    ...s,
    cronDescription: describeCron(s.cronExpression),
  }));
}

export async function triggerScheduleNowAction(id: string, repositoryId: string) {
  await requireRepoAccess(repositoryId);

  const schedule = await queries.getBuildSchedule(id);
  if (!schedule) throw new Error('Schedule not found');

  // Verify schedule belongs to this repository (IDOR protection)
  if (schedule.repositoryId !== repositoryId) {
    throw new Error('Schedule not found');
  }

  const { createAndRunBuildFromCI } = await import('@/server/actions/builds');

  const result = await createAndRunBuildFromCI({
    triggerType: 'scheduled',
    repositoryId: schedule.repositoryId,
    runnerId: schedule.runnerId || 'local',
    gitBranch: schedule.gitBranch || undefined,
  });

  const nextRunAt = getNextRunTime(schedule.cronExpression);
  if (result.buildId) {
    await queries.markScheduleRun(schedule.id, result.buildId, nextRunAt);
  }

  revalidatePath('/settings');
  return result;
}
