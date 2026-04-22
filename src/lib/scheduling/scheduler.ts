/**
 * Server-side build scheduler.
 * Runs a 60-second interval that checks for due schedules and triggers builds.
 */

import * as queries from '@/lib/db/queries';
import { getNextRunTime } from './cron';

let started = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Ensure the scheduler is running. Safe to call multiple times — only starts once.
 * Respects DISABLE_SCHEDULER=true so companion replicas (e.g. an envoy-bypass
 * Deployment) can share a DB with the main app without duplicate schedule ticks.
 */
export function ensureSchedulerStarted() {
  if (started) return;
  if (process.env.DISABLE_SCHEDULER === 'true') {
    console.log('[scheduler] Disabled via DISABLE_SCHEDULER=true');
    started = true;
    return;
  }
  started = true;

  intervalId = setInterval(async () => {
    try {
      await processDueSchedules();
    } catch (error) {
      console.error('[scheduler] Error processing due schedules:', error);
    }
  }, 60_000); // Check every 60 seconds

  // Don't keep process alive just for scheduler
  if (intervalId && typeof intervalId === 'object' && 'unref' in intervalId) {
    intervalId.unref();
  }

  console.log('[scheduler] Build scheduler started (60s interval)');
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  started = false;
}

let processing = false;

async function processDueSchedules() {
  if (processing) return; // Prevent concurrent ticks
  processing = true;

  try {
    const dueSchedules = await queries.getDueSchedules();

    for (const schedule of dueSchedules) {
      try {
        // Compute next run time BEFORE triggering (prevents double-fire)
        const nextRunAt = getNextRunTime(schedule.cronExpression, new Date());

        // Import dynamically to avoid circular dependencies
        const { createAndRunBuildFromCI } = await import('@/server/actions/builds');

        const result = await createAndRunBuildFromCI({
          triggerType: 'scheduled',
          repositoryId: schedule.repositoryId,
          runnerId: schedule.runnerId || 'local',
          gitBranch: schedule.gitBranch || undefined,
        });

        if (result.buildId) {
          await queries.markScheduleRun(schedule.id, result.buildId, nextRunAt);
        }

        console.log(`[scheduler] Triggered build ${result.buildId} for schedule "${schedule.name}"`);
      } catch (error) {
        console.error(`[scheduler] Failed to run schedule "${schedule.name}":`, error);
        await queries.incrementScheduleFailures(schedule.id);

        // Still advance nextRunAt so we don't retry immediately
        try {
          const nextRunAt = getNextRunTime(schedule.cronExpression, new Date());
          await queries.updateBuildSchedule(schedule.id, { nextRunAt });
        } catch {
          // Ignore — schedule may have been disabled by incrementScheduleFailures
        }
      }
    }
  } finally {
    processing = false;
  }
}
