"use server";

import { revalidatePath } from "next/cache";
import type { PluginContext } from "@lastest/contracts";
import {
  describeCron,
  getNextRunTime,
  isValidCron,
  PRESET_SCHEDULES,
  type PresetScheduleKey,
} from "@lastest/cron";

import { orm } from "./data/db";
import * as q from "./data/queries";
import type { SchedulingHost } from "./host";
import { schedulingPlugin } from "./index";
import type { BuildSchedule } from "./schema";
import { schedulingWiring } from "./wiring";

/**
 * Scheduling's server actions.
 *
 * Spike S1 proved a `"use server"` module inside a `transpilePackages`
 * workspace package produces real, dispatchable action ids, so these live in
 * the package with no codegen and no shim. Every export here is declared
 * locally for the same reason `plugins/explorer/src/actions.ts` does: an
 * `export { x } from "…"` re-export inside a `"use server"` file compiles to
 * a module with no exports at all.
 *
 * ### Where authorization went
 *
 * Every user-invoked action used to open with `requireRepoAccess(repositoryId)`
 * and, for updates, `requireScheduleOwnership(id)` — a core helper that read
 * this table directly. That helper is gone: once `build_schedules` became
 * this plugin's own table, keeping it in `src/lib/auth/ownership.ts` would
 * have meant core importing a plugin to read it, exactly the edge recipe
 * §1.6 forbids. `contextFor()` replaces the repo-access half; the ownership
 * half is now the two-line check in `mustOwn` below, since the plugin holds
 * both the row and the caller-authorized `repositoryId` in the same scope.
 */

type SchedulingCtx = PluginContext<"data">;

async function context(
  repositoryId: string,
): Promise<{ ctx: SchedulingCtx; host: SchedulingHost }> {
  const { runtime, host } = schedulingWiring();
  const ctx = (await runtime.contextFor(schedulingPlugin, {
    repositoryId,
  })) as SchedulingCtx;
  return { ctx, host };
}

/** IDOR guard: the row must belong to the repository the caller was just
 *  authorized for, not merely to the plugin's table as a whole. */
async function mustOwn(
  ctx: SchedulingCtx,
  id: string,
  repositoryId: string,
): Promise<BuildSchedule> {
  const schedule = await q.getBuildSchedule(orm(ctx.data), id);
  if (!schedule || schedule.repositoryId !== repositoryId) {
    throw new Error("Schedule not found");
  }
  return schedule;
}

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
  const { ctx } = await context(input.repositoryId);

  const cronExpression = input.preset
    ? PRESET_SCHEDULES[input.preset].cron
    : input.cronExpression;

  if (!isValidCron(cronExpression)) {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }

  const nextRunAt = getNextRunTime(cronExpression);

  const result = await q.createBuildSchedule(orm(ctx.data), {
    repositoryId: input.repositoryId,
    name: input.name,
    cronExpression,
    timezone: input.timezone ?? "UTC",
    runnerId: input.runnerId ?? null,
    testIds: input.testIds ?? null,
    suiteId: input.suiteId ?? null,
    gitBranch: input.gitBranch ?? null,
    nextRunAt,
    maxConsecutiveFailures: input.maxConsecutiveFailures ?? 5,
    enabled: true,
  });

  revalidatePath("/settings");
  return result;
}

// `updateScheduleAction` (rename/re-cron an existing schedule without
// delete+recreate) is not here. Recipe §8's action-id count caught it: the
// build minted ids for 5 of this file's 6 client-facing exports, and the
// missing one was already dead before the migration —
// `schedule-manager-client.tsx` never called it either, there being no edit
// UI, only create/toggle/delete/trigger. Not a re-export trap (§8's other
// zero-id shape), just an unauthenticated-by-default RPC endpoint nobody
// dispatched, the same finding `ci`'s migration made for three of its own
// exports. Deleted rather than kept as unreachable surface area.

export async function deleteScheduleAction(id: string, repositoryId: string) {
  const { ctx } = await context(repositoryId);
  await mustOwn(ctx, id, repositoryId);

  await q.deleteBuildSchedule(orm(ctx.data), id);
  revalidatePath("/settings");
}

export async function toggleScheduleAction(
  id: string,
  repositoryId: string,
  enabled: boolean,
) {
  const { ctx } = await context(repositoryId);
  const schedule = await mustOwn(ctx, id, repositoryId);

  const updates: Record<string, unknown> = { enabled };
  if (enabled && schedule.cronExpression) {
    // Recompute next run time when re-enabling
    updates.nextRunAt = getNextRunTime(schedule.cronExpression);
    updates.consecutiveFailures = 0;
  }

  await q.updateBuildSchedule(orm(ctx.data), id, updates);
  revalidatePath("/settings");
}

export async function getSchedulesAction(repositoryId: string) {
  const { ctx } = await context(repositoryId);
  const schedules = await q.getBuildSchedulesByRepo(
    orm(ctx.data),
    repositoryId,
  );
  return schedules.map((s) => ({
    ...s,
    cronDescription: describeCron(s.cronExpression),
  }));
}

export async function triggerScheduleNowAction(
  id: string,
  repositoryId: string,
) {
  const { ctx, host } = await context(repositoryId);
  const schedule = await mustOwn(ctx, id, repositoryId);

  const result = await host.triggerBuild({
    repositoryId: schedule.repositoryId,
    runnerId: schedule.runnerId || "auto",
    gitBranch: schedule.gitBranch || undefined,
  });

  const nextRunAt = getNextRunTime(schedule.cronExpression);
  if (result.buildId) {
    await q.markScheduleRun(
      orm(ctx.data),
      schedule.id,
      result.buildId,
      nextRunAt,
    );
  }

  revalidatePath("/settings");
  return result;
}

/**
 * Fire due build schedules. Called from the scheduler tick
 * (`src/lib/core/scheduler.ts`) — the same call shape
 * `dispatchDueExplorerTriggers` and `processLaunchCohorts` use.
 *
 * There is no user session here, so this reads and writes through `data`
 * straight from the wiring slot rather than `contextFor()` — a schedule's
 * own `repositoryId` was already authorized when the schedule was created,
 * and re-deriving a `ctx.team`/`ctx.repo` this handler never uses would only
 * add a database round trip per due schedule.
 */
export async function dispatchDueSchedules(): Promise<number> {
  const { host, data } = schedulingWiring();
  const db = orm(data);
  const due = await q.getDueSchedules(db);
  let fired = 0;

  for (const schedule of due) {
    try {
      // Compute next run time BEFORE triggering (prevents double-fire).
      const nextRunAt = getNextRunTime(schedule.cronExpression, new Date());

      const result = await host.triggerBuild({
        repositoryId: schedule.repositoryId,
        runnerId: schedule.runnerId || "auto",
        gitBranch: schedule.gitBranch || undefined,
      });

      if (result.buildId) {
        await q.markScheduleRun(db, schedule.id, result.buildId, nextRunAt);
        fired++;
      }
    } catch {
      await q.incrementScheduleFailures(db, schedule.id);

      // Still advance nextRunAt so a failure doesn't retry immediately.
      try {
        const nextRunAt = getNextRunTime(schedule.cronExpression, new Date());
        await q.updateBuildSchedule(db, schedule.id, { nextRunAt });
      } catch {
        // Ignore — the schedule may have just been disabled by
        // incrementScheduleFailures crossing maxConsecutiveFailures.
      }
    }
  }

  return fired;
}
