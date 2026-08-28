/**
 * Server-side tick loop. Runs a 60-second interval that fires whatever is
 * due: build schedules, QA agent triggers, explorer triggers, launch
 * cohorts.
 *
 * ### Why this lives here and not in a plugin
 *
 * This file used to be `src/lib/scheduling/scheduler.ts`, sitting next to
 * the build-schedule feature by directory convention. Reading its import and
 * consumer lists (recipe §1.6) found the opposite of what the directory
 * suggested: three of its four handlers dispatch *other* features' triggers
 * — `processLaunchCohorts` (`@lastest/plugin-launch/cohorts`) and
 * `dispatchDueExplorerTriggers` (`@lastest/plugin-explorer/actions`, dynamic
 * import) — and `core/jobs`'s own `worker.ts` already documented this file
 * as "the app's scheduler" before this move, in someone else's package.
 * `plugins/launch/src/domain/cohort-engine.ts` calls it exactly that too.
 *
 * A §1.6 "reclassify": nothing here moved into the scheduling plugin except
 * the one handler that was genuinely its own
 * (`processDueBuildSchedules`, now a call into
 * `@lastest/plugin-scheduling/actions`'s `dispatchDueSchedules`) — the same
 * call shape `processLaunchCohorts` and `dispatchDueExplorerTriggers`
 * already used. Everything else is unchanged in shape, only in address.
 *
 * `src/lib/core/` is the composition root (`runtime.ts`'s own doc comment):
 * the one place allowed to import every plugin, because it is where core's
 * ports meet the app's implementations. This file is the same kind of
 * object — a tick loop that knows about every registered timer — so it
 * belongs next to `runtime.ts`, not gated behind a new `CORE_SRC_PATHS`
 * entry the way `ci`'s reclassified OAuth files were (those stayed in place
 * under `src/lib/github`/`src/lib/gitlab`; this file had no legitimate
 * owner to stay in place *as*).
 */

import { processLaunchCohorts } from "@lastest/plugin-launch/cohorts";

let started = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Ensure the scheduler is running. Safe to call multiple times — only starts once.
 * Respects DISABLE_SCHEDULER=true so companion replicas (e.g. an envoy-bypass
 * Deployment) can share a DB with the main app without duplicate schedule ticks.
 */
export function ensureSchedulerStarted() {
  if (started) return;
  if (process.env.DISABLE_SCHEDULER === "true") {
    console.log("[scheduler] Disabled via DISABLE_SCHEDULER=true");
    started = true;
    return;
  }
  started = true;

  intervalId = setInterval(async () => {
    try {
      await processDueBuildSchedules();
    } catch (error) {
      console.error("[scheduler] Error processing due schedules:", error);
    }
    try {
      await processDueQaTriggers();
    } catch (error) {
      console.error("[scheduler] Error processing QA agent triggers:", error);
    }
    try {
      await processDueExplorerTriggers();
    } catch (error) {
      console.error("[scheduler] Error processing explorer triggers:", error);
    }
    try {
      await processLaunchCohorts();
    } catch (error) {
      console.error("[scheduler] Error processing launch cohorts:", error);
    }
    try {
      await processStaleCoverageModels();
    } catch (error) {
      console.error("[scheduler] Error re-syncing coverage models:", error);
    }
  }, 60_000); // Check every 60 seconds

  // Don't keep process alive just for scheduler
  if (intervalId && typeof intervalId === "object" && "unref" in intervalId) {
    intervalId.unref();
  }

  console.log("[scheduler] Build scheduler started (60s interval)");
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  started = false;
}

let schedulesProcessing = false;

/** Fire due build schedules. The plugin's own dispatcher owns the query, the
 *  trigger sequence and re-arming; this only has to wire the runtime first,
 *  the same reason `processDueExplorerTriggers` below does. */
async function processDueBuildSchedules() {
  if (schedulesProcessing) return;
  schedulesProcessing = true;
  try {
    const { getPluginRuntime } = await import("@/lib/core/runtime");
    await getPluginRuntime();
    const { dispatchDueSchedules } =
      await import("@lastest/plugin-scheduling/actions");
    const fired = await dispatchDueSchedules();
    if (fired > 0) {
      console.log(`[scheduler] Triggered ${fired} scheduled build(s)`);
    }
  } finally {
    schedulesProcessing = false;
  }
}

let qaProcessing = false;

/** Fire due QA agent cron triggers. The plugin's own dispatcher owns the
 *  due-trigger query, nextRunAt advancement (BEFORE starting, so a slow run
 *  can't double-fire) and the busy-skip; this only has to wire the runtime
 *  first, the same reason `processDueBuildSchedules` above and
 *  `processDueExplorerTriggers` below do. */
async function processDueQaTriggers() {
  if (qaProcessing) return;
  qaProcessing = true;

  try {
    const { getPluginRuntime } = await import("@/lib/core/runtime");
    await getPluginRuntime();
    const { dispatchDueQaTriggers } =
      await import("@lastest/plugin-qa-agent/actions");
    await dispatchDueQaTriggers();
  } finally {
    qaProcessing = false;
  }
}

let explorerProcessing = false;

/** Fire due explorer cron triggers. The dispatch action owns nextRunAt
 *  advancement, busy-skip, and target-URL resolution. */
async function processDueExplorerTriggers() {
  if (explorerProcessing) return;
  explorerProcessing = true;
  try {
    // The plugin's own dispatcher. Loaded dynamically for the same reason the
    // QA one above is, and because the plugin runtime has to be wired before
    // any of its actions can resolve a scope.
    const { getPluginRuntime } = await import("@/lib/core/runtime");
    await getPluginRuntime();
    const { dispatchDueExplorerTriggers } =
      await import("@lastest/plugin-explorer/actions");
    const fired = await dispatchDueExplorerTriggers();
    if (fired > 0) {
      console.log(`[scheduler] Started ${fired} scheduled explorer session(s)`);
    }
  } finally {
    explorerProcessing = false;
  }
}

let coverageProcessing = false;

/**
 * Keep every confirmed coverage model fresh.
 *
 * Until this existed, `syncCoverage` only ran when a human opened the Coverage
 * page: a nightly CSV refresh or a new data source was invisible to anything
 * scheduled, so a QA agent run planned against a data space that had already
 * moved. Repos with no enabled dimension have no model and are skipped
 * entirely — profiling proposals are not a model.
 *
 * One repo at a time, and only when stale, because a sync re-reads every data
 * source and re-scores every cell; a fleet of repos syncing on the same tick
 * is a self-inflicted load spike.
 */
async function processStaleCoverageModels() {
  if (coverageProcessing) return;
  coverageProcessing = true;

  try {
    // Dynamic for the same reason as the line above: this keeps the coverage
    // model and its query layer out of the scheduler's static import graph.
    const { coverageIsStale } = await import("@/lib/coverage/sync");
    const { startCoverageSyncJob } = await import("@/lib/coverage/sync-job");
    const { getReposWithEnabledCoverageDimensions } =
      await import("@/lib/db/queries/coverage");
    const targets = await getReposWithEnabledCoverageDimensions();

    for (const target of targets) {
      try {
        // Cheap gate first: one snapshot-row read per repo. The tick used to
        // call `ensureFreshCoverage`, which on the FRESH path still computed a
        // full coverage report the scheduler then discarded — every repo, every
        // tick — and on the stale path ran the whole sync (synchronous CSV
        // parse, per-cell UPDATE loop) inline in the web process, sequentially
        // across every tenant's repos. Stale repos are now handed to the
        // `coverage_sync` background job instead, which also dedupes against a
        // sync the user just started from the Coverage page.
        if (
          !(await coverageIsStale(target.repositoryId, target.environmentKey))
        ) {
          continue;
        }
        const { jobId, deduped } = await startCoverageSyncJob(
          target.repositoryId,
          { environmentKey: target.environmentKey },
        );
        if (!deduped) {
          console.log(
            `[scheduler] Enqueued coverage re-sync job ${jobId} for repo ${target.repositoryId}`,
          );
        }
      } catch (error) {
        console.error(
          `[scheduler] Coverage re-sync failed for repo ${target.repositoryId}:`,
          error,
        );
      }
    }
  } finally {
    coverageProcessing = false;
  }
}
