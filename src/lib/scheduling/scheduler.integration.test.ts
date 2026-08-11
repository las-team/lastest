/**
 * Runtime verification for scheduling (`libs/cron` shim + `scheduler.ts`)
 * against real postgres and, for the regular-run dispatch case, a real EB
 * claim through the pool service.
 *
 * §2.13 of `docs/architecture/core-plugin-refactor-test-plan.md` already
 * confirmed by direct inspection that `src/lib/scheduling/cron.ts` is a
 * byte-identical re-export of `libs/cron`, and that a real due schedule fired
 * on a live tick — but that was an observation, not a committed, re-runnable
 * test. This file is that test.
 *
 * It intentionally does NOT call the unexported `processDueSchedules()`
 * inside `scheduler.ts` — instead it replicates its exact call sequence
 * (`getDueSchedules` → `getNextRunTime` → `createAndRunBuildFromCI` →
 * `markScheduleRun`), which is the same code `scheduler.ts` itself calls, so
 * a regression in any of those functions is caught the same way it would be
 * on a live tick. See `plugins/explorer/src/explorer.integration.test.ts` for
 * the explorer-trigger half of §2.13's dispatch check — that path goes
 * through `ctx.team` resolution (`dispatchDueExplorerTriggers`), which is
 * the part that changed; this file's regular path is the control case that
 * must stay unchanged.
 *
 * Run with `pnpm test:integration`.
 */
import { getPoolStatus } from "@lastest/pool-service/client";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { buildSchedules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as queries from "@/lib/db/queries";
import { createAndRunBuildFromCI } from "@/server/actions/builds";
import { PRESET_SCHEDULES, getNextRunTime, isValidCron } from "./cron";

async function poolHeadroom(): Promise<number> {
  const status = await getPoolStatus();
  return status ? status.max - status.size : 99;
}

/** Minimal single-step test code — signature per CLAUDE.md's "Test code
 *  signature" gotcha. Fast: one navigation, one screenshot. */
const MINIMAL_TEST_CODE = `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await stepLogger?.("open");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: screenshotPath });
}`;

describe("scheduling — preset and custom cron validation", () => {
  it("every preset schedule validates and produces a real schedule row", async () => {
    const team = await queries.createTeam({ name: "sched-preset-team" });
    const repo = await queries.createRepository({
      teamId: team.id,
      provider: "local",
      owner: "sched-preset",
      name: "repo",
      fullName: "sched-preset/repo",
      defaultBranch: "main",
    });

    try {
      for (const [key, preset] of Object.entries(PRESET_SCHEDULES)) {
        expect(isValidCron(preset.cron)).toBe(true);
        const next = getNextRunTime(preset.cron, new Date());
        expect(next.getTime()).toBeGreaterThan(Date.now());

        const { id } = await queries.createBuildSchedule({
          repositoryId: repo.id,
          name: `preset-${key}`,
          enabled: true,
          cronExpression: preset.cron,
          nextRunAt: next,
        });
        const row = await queries.getBuildSchedule(id);
        expect(row?.cronExpression).toBe(preset.cron);
      }
    } finally {
      await queries.deleteRepository(repo.id);
      await queries.deleteTeam(team.id);
    }
  });

  it("a custom cron expression validates and produces a real schedule row", async () => {
    const team = await queries.createTeam({ name: "sched-custom-team" });
    const repo = await queries.createRepository({
      teamId: team.id,
      provider: "local",
      owner: "sched-custom",
      name: "repo",
      fullName: "sched-custom/repo",
      defaultBranch: "main",
    });

    try {
      const custom: string = "17 5 * * 3"; // 05:17 every Wednesday — not a preset
      expect(isValidCron(custom)).toBe(true);
      expect(
        Object.values(PRESET_SCHEDULES).some((p) => p.cron === custom),
      ).toBe(false);
      const next = getNextRunTime(custom, new Date());

      const { id } = await queries.createBuildSchedule({
        repositoryId: repo.id,
        name: "custom-schedule",
        enabled: true,
        cronExpression: custom,
        nextRunAt: next,
      });
      const row = await queries.getBuildSchedule(id);
      expect(row?.cronExpression).toBe(custom);
      expect(row?.nextRunAt?.getTime()).toBe(next.getTime());
    } finally {
      await queries.deleteRepository(repo.id);
      await queries.deleteTeam(team.id);
    }
  });
});

describe("scheduling — regular scheduled-run dispatch (control path, unchanged)", () => {
  it("a due schedule dispatches through the exact sequence scheduler.ts uses, creates a build, and re-arms", async () => {
    await expect
      .poll(poolHeadroom, { timeout: 60_000, interval: 500 })
      .toBeGreaterThanOrEqual(1);

    const team = await queries.createTeam({ name: "sched-dispatch-team" });
    const repo = await queries.createRepository({
      teamId: team.id,
      provider: "local",
      owner: "sched-dispatch",
      name: "repo",
      fullName: "sched-dispatch/repo",
      defaultBranch: "main",
    });
    await queries.createTest(
      {
        repositoryId: repo.id,
        name: "sched-dispatch-probe",
        code: MINIMAL_TEST_CODE,
        targetUrl: "https://example.com",
      },
      "main",
    );

    const pastDue = new Date(Date.now() - 60_000);
    const { id: scheduleId } = await queries.createBuildSchedule({
      repositoryId: repo.id,
      name: "due-now",
      enabled: true,
      cronExpression: "*/15 * * * *",
      nextRunAt: pastDue,
    });

    try {
      // 1. The exact query the scheduler tick calls to find work.
      const due = await queries.getDueSchedules();
      expect(due.map((s) => s.id)).toContain(scheduleId);
      const schedule = due.find((s) => s.id === scheduleId)!;

      // 2. Compute the next fire time BEFORE triggering, same as
      //    processDueSchedules — prevents double-fire on a slow run.
      const nextRunAt = getNextRunTime(schedule.cronExpression, new Date());

      // 3. The actual dispatch call scheduler.ts makes.
      const result = await createAndRunBuildFromCI({
        triggerType: "scheduled",
        repositoryId: schedule.repositoryId,
        runnerId: schedule.runnerId || "auto",
        gitBranch: schedule.gitBranch || undefined,
      });
      expect(result.buildId).toBeTruthy();
      expect(result.testRunId).toBeTruthy();

      const build = await queries.getBuild(result.buildId!);
      expect(build?.triggerType).toBe("scheduled");
      const testRun = await queries.getTestRun(result.testRunId!);
      expect(testRun?.repositoryId).toBe(repo.id);

      // 4. Re-arm, same as processDueSchedules on success.
      await queries.markScheduleRun(scheduleId, result.buildId!, nextRunAt);
      const after = await queries.getBuildSchedule(scheduleId);
      expect(after?.lastBuildId).toBe(result.buildId);
      expect(after?.nextRunAt?.getTime()).toBe(nextRunAt.getTime());
      expect(after?.consecutiveFailures).toBe(0);

      // Let the async run either finish or fail before tearing the repo
      // down under it — best-effort, not a hard requirement of this test.
      await expect
        .poll(
          async () => {
            const tr = await queries.getTestRun(result.testRunId!);
            return tr?.status;
          },
          { timeout: 45_000, interval: 1_000 },
        )
        .not.toBe("running")
        .catch(() => {
          // Still running after 45s — fine, this test is about dispatch,
          // not execution latency. Fall through to cleanup.
        });
    } finally {
      await db.delete(buildSchedules).where(eq(buildSchedules.id, scheduleId));
      await queries.deleteRepository(repo.id);
      await queries.deleteTeam(team.id);
    }
  }, 120_000);
});
