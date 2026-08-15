/**
 * Runtime verification for the scheduling plugin (RFC §9 phase 4, thirteenth
 * plugin) against real postgres and, for the dispatch case, a real EB claim
 * through the pool service.
 *
 * Exercises the same entry point a live cron tick uses
 * (`dispatchDueSchedules`, called from `src/lib/core/scheduler.ts`) rather
 * than replicating its call sequence by hand — the shape
 * `plugins/explorer/src/explorer.integration.test.ts` uses for
 * `dispatchDueExplorerTriggers`, and the previous version of this file
 * (`src/lib/scheduling/scheduler.integration.test.ts`) predates the
 * migration that made `dispatchDueSchedules` an exported, dispatchable
 * function to call directly.
 *
 * Run with `pnpm test:integration`.
 */
import { eq } from "drizzle-orm";
import { getPoolStatus } from "@lastest/pool-service/client";
import { beforeAll, describe, expect, it } from "vitest";
import { PRESET_SCHEDULES, getNextRunTime, isValidCron } from "@lastest/cron";

import { db, sql } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { getPluginRuntime } from "@/lib/core/runtime";

import { dispatchDueSchedules } from "./actions";
import { schedulingBuildSchedules } from "./schema";

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

beforeAll(async () => {
  // Wires the plugin runtime's global slot (`configureScheduling(...)`) —
  // without this, `schedulingWiring()` throws "not wired", same as a
  // scheduler tick would if it fired before the app finished booting.
  await getPluginRuntime();
}, 30_000);

describe("scheduling table rename migration (§0)", () => {
  it("scheduling_build_schedules exists; build_schedules is gone", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any(ARRAY[
        'scheduling_build_schedules', 'build_schedules'
      ])
    `;
    const names = new Set(rows.map((r) => r.table_name));
    expect(names.has("scheduling_build_schedules")).toBe(true);
    expect(names.has("build_schedules")).toBe(false);
  });
});

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

        const [row] = await db
          .insert(schedulingBuildSchedules)
          .values({
            id: crypto.randomUUID(),
            repositoryId: repo.id,
            name: `preset-${key}`,
            enabled: true,
            cronExpression: preset.cron,
            nextRunAt: next,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        expect(row.cronExpression).toBe(preset.cron);
      }
    } finally {
      await db
        .delete(schedulingBuildSchedules)
        .where(eq(schedulingBuildSchedules.repositoryId, repo.id));
      await queries.deleteRepository(repo.id);
      await queries.deleteTeam(team.id);
    }
  });
});

describe("scheduling — due-schedule dispatch (the live cron tick's own call)", () => {
  it("a due schedule fires through dispatchDueSchedules, creates a build, and re-arms", async () => {
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
    const [{ id: scheduleId }] = await db
      .insert(schedulingBuildSchedules)
      .values({
        id: crypto.randomUUID(),
        repositoryId: repo.id,
        name: "due-now",
        enabled: true,
        cronExpression: "*/15 * * * *",
        nextRunAt: pastDue,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    try {
      const fired = await dispatchDueSchedules();
      expect(fired).toBeGreaterThanOrEqual(1);

      const [after] = await db
        .select()
        .from(schedulingBuildSchedules)
        .where(eq(schedulingBuildSchedules.id, scheduleId));
      expect(after?.lastBuildId).toBeTruthy();
      expect(after?.nextRunAt?.getTime()).toBeGreaterThan(pastDue.getTime());
      expect(after?.consecutiveFailures).toBe(0);

      const build = await queries.getBuild(after!.lastBuildId!);
      expect(build?.triggerType).toBe("scheduled");
      const testRun = await queries.getTestRun(build!.testRunId!);
      expect(testRun?.repositoryId).toBe(repo.id);

      // Let the async run either finish or fail before tearing the repo
      // down under it — best-effort, not a hard requirement of this test.
      await expect
        .poll(
          async () => {
            const tr = await queries.getTestRun(build!.testRunId!);
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
      await db
        .delete(schedulingBuildSchedules)
        .where(eq(schedulingBuildSchedules.id, scheduleId));
      await queries.deleteRepository(repo.id);
      await queries.deleteTeam(team.id);
    }
  }, 120_000);
});
