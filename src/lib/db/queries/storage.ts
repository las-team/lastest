import { db } from "../index";
import {
  teams,
  tests,
  testRuns,
  testResults,
  visualDiffs,
  repositories,
} from "../schema";
import { and, eq, asc, gte, inArray, sql } from "drizzle-orm";
import { RUN_ANALYTICS_OTHER_ID } from "@/lib/billing/run-usage";

export async function getTeamStorageUsage(teamId: string) {
  const [team] = await db
    .select({
      storageQuotaBytes: teams.storageQuotaBytes,
      storageUsedBytes: teams.storageUsedBytes,
      storageLastCalculatedAt: teams.storageLastCalculatedAt,
    })
    .from(teams)
    .where(eq(teams.id, teamId));

  if (!team) return null;

  const quotaBytes = team.storageQuotaBytes ?? 10737418240;
  const usedBytes = team.storageUsedBytes ?? 0;

  return {
    storageQuotaBytes: quotaBytes,
    storageUsedBytes: usedBytes,
    storageLastCalculatedAt: team.storageLastCalculatedAt,
    percentUsed:
      quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0,
  };
}

export async function updateTeamStorageUsage(
  teamId: string,
  usedBytes: number,
) {
  await db
    .update(teams)
    .set({
      storageUsedBytes: usedBytes,
      storageLastCalculatedAt: new Date(),
    })
    .where(eq(teams.id, teamId));
}

/**
 * PRIVILEGED: sets a team's storage quota with no auth check of its own.
 * Quota is a paid-plan entitlement — any caller MUST first pass
 * `requireCapability('team:admin')` (or be a trusted system/webhook
 * path). Has no callers today; keep it that way unless the call site is
 * behind an admin guard, or this becomes a tenant-escalation vector.
 */
export async function updateTeamStorageQuota(
  teamId: string,
  quotaBytes: number,
) {
  await db
    .update(teams)
    .set({ storageQuotaBytes: quotaBytes })
    .where(eq(teams.id, teamId));
}

const DEFAULT_RUN_QUOTA = 500;

function currentUsageMonth(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function getTeamRunUsage(teamId: string) {
  const [team] = await db
    .select({
      monthlyRunQuota: teams.monthlyRunQuota,
      runsThisMonth: teams.runsThisMonth,
      runMinutesThisMonth: teams.runMinutesThisMonth,
      usageMonth: teams.usageMonth,
      runUsageLastCalculatedAt: teams.runUsageLastCalculatedAt,
    })
    .from(teams)
    .where(eq(teams.id, teamId));

  if (!team) return null;

  const month = currentUsageMonth();
  const sameMonth = team.usageMonth === month;
  const quota = team.monthlyRunQuota ?? DEFAULT_RUN_QUOTA;
  const runs = sameMonth ? (team.runsThisMonth ?? 0) : 0;
  const minutes = sameMonth ? (team.runMinutesThisMonth ?? 0) : 0;

  return {
    monthlyRunQuota: quota,
    runsThisMonth: runs,
    runMinutesThisMonth: minutes,
    usageMonth: sameMonth ? team.usageMonth : month,
    runUsageLastCalculatedAt: team.runUsageLastCalculatedAt,
    // Quota is denominated in run-minutes (plans.ts / Stripe metadata),
    // so the percentage must measure minutes used, not the run count.
    percentUsed: quota > 0 ? Math.round((minutes / quota) * 100) : 0,
  };
}

/**
 * Atomically increment monthly run counters for a team. Resets counters when
 * usage_month differs from the current UTC month. Safe under concurrent runs
 * because the increment is decided in SQL via CASE on usage_month.
 */
export async function recordTeamRunCompletion(
  teamId: string,
  durationMs: number,
): Promise<void> {
  const month = currentUsageMonth();
  const minutes = Math.max(0, durationMs) / 60_000;
  await db
    .update(teams)
    .set({
      runsThisMonth: sql`CASE WHEN ${teams.usageMonth} = ${month} THEN COALESCE(${teams.runsThisMonth}, 0) + 1 ELSE 1 END`,
      runMinutesThisMonth: sql`CASE WHEN ${teams.usageMonth} = ${month} THEN COALESCE(${teams.runMinutesThisMonth}, 0) + ${minutes} ELSE ${minutes} END`,
      usageMonth: month,
      runUsageLastCalculatedAt: new Date(),
    })
    .where(eq(teams.id, teamId));
}

/**
 * PRIVILEGED: sets a team's monthly run quota with no auth check of its
 * own. Same contract as {@link updateTeamStorageQuota} — only call from
 * behind `requireCapability('team:admin')` or a trusted billing/webhook
 * path (the plan-sync in `webhook-sync.ts` is the legitimate writer).
 */
export async function updateTeamRunQuota(teamId: string, quota: number) {
  await db
    .update(teams)
    .set({ monthlyRunQuota: quota })
    .where(eq(teams.id, teamId));
}

// ── Run usage analytics (per-project / per-test run-minute breakdown) ──────
//
// Billing metric: sum(test_results.duration_ms) over COMPLETED runs, converted
// to minutes, attributed to the run's repository (and test). Powers the
// "Run usage analytics" card. Top repos are kept individually; the tail is
// aggregated into a single non-expandable "Other" bucket to match the design.

/** How many top repositories are shown individually before bucketing to "Other". */
const RUN_ANALYTICS_TOP_REPOS = 4;
/** Run statuses that count toward billed run-minutes (excludes in-flight runs). */
const COMPLETED_RUN_STATUSES = ["passed", "failed"] as const;

export interface RunUsageAnalyticsTest {
  id: string;
  name: string;
  minutes: number;
  runs: number;
}

export interface RunUsageAnalyticsRepo {
  /** Repository id, or RUN_ANALYTICS_OTHER_ID for the aggregated tail. */
  id: string;
  name: string;
  minutes: number;
  testCount: number;
  /** All tests sorted desc by run-minutes (empty for the aggregated "Other" bucket). */
  tests: RunUsageAnalyticsTest[];
}

export interface RunUsageAnalyticsDay {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  /** Run-minutes per repo (bucket) id for that day. */
  minutesByRepo: Record<string, number>;
}

export interface RunUsageAnalytics {
  days: number;
  rangeStart: string;
  rangeEnd: string;
  totalMinutes: number;
  /** Sorted desc by minutes; tail collapsed into an "Other" bucket. */
  repos: RunUsageAnalyticsRepo[];
  /** One entry per calendar day in the window (zero-filled). */
  series: RunUsageAnalyticsDay[];
}

function utcDayKey(d: Date): string {
  return (
    `${d.getUTCFullYear()}-` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getUTCDate()).padStart(2, "0")}`
  );
}

function buildDaySeries(
  startDay: Date,
  days: number,
  fill: (key: string) => Record<string, number>,
): RunUsageAnalyticsDay[] {
  const out: RunUsageAnalyticsDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDay.getTime() + i * 86_400_000);
    const key = utcDayKey(d);
    out.push({ date: key, minutesByRepo: fill(key) });
  }
  return out;
}

export async function getTeamRunUsageAnalytics(
  teamId: string,
): Promise<RunUsageAnalytics> {
  const now = new Date();
  // Window aligned to the run-minute billing cycle rather than a rolling 30
  // days: from the 1st of the current UTC month (when the monthly counters +
  // quota reset — see getTeamRunUsage / recordTeamRunCompletion) through
  // today. `days` is the day-of-month elapsed, so the chart, the monthly
  // run-minute counter, and the projection all cover the same period.
  const startDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const days = now.getUTCDate();

  const empty: RunUsageAnalytics = {
    days,
    rangeStart: utcDayKey(startDay),
    rangeEnd: utcDayKey(now),
    totalMinutes: 0,
    repos: [],
    series: buildDaySeries(startDay, days, () => ({})),
  };

  const teamRepos = await db
    .select({ id: repositories.id, fullName: repositories.fullName })
    .from(repositories)
    .where(eq(repositories.teamId, teamId));
  if (teamRepos.length === 0) return empty;

  const repoIds = teamRepos.map((r) => r.id);
  const repoName = new Map(teamRepos.map((r) => [r.id, r.fullName]));

  // duration_ms → minutes. pg returns numeric/bigint aggregates as strings,
  // so every value is coerced with Number() below.
  const minutesExpr = sql<number>`COALESCE(SUM(${testResults.durationMs}), 0) / 60000.0`;
  const windowFilter = and(
    inArray(testRuns.repositoryId, repoIds),
    gte(testRuns.startedAt, startDay),
    inArray(testRuns.status, [...COMPLETED_RUN_STATUSES]),
  );

  const [dailyRows, testRows] = await Promise.all([
    db
      .select({
        repositoryId: testRuns.repositoryId,
        day: sql<string>`to_char(date_trunc('day', ${testRuns.startedAt}), 'YYYY-MM-DD')`,
        minutes: minutesExpr,
      })
      .from(testResults)
      .innerJoin(testRuns, eq(testResults.testRunId, testRuns.id))
      .where(windowFilter)
      .groupBy(
        testRuns.repositoryId,
        sql`date_trunc('day', ${testRuns.startedAt})`,
      ),
    db
      .select({
        repositoryId: testRuns.repositoryId,
        testId: testResults.testId,
        testName: tests.name,
        minutes: minutesExpr,
        runs: sql<number>`COUNT(DISTINCT ${testResults.testRunId})`,
      })
      .from(testResults)
      .innerJoin(testRuns, eq(testResults.testRunId, testRuns.id))
      .leftJoin(tests, eq(testResults.testId, tests.id))
      .where(windowFilter)
      .groupBy(testRuns.repositoryId, testResults.testId, tests.name),
  ]);

  // Per-repo totals from the daily rows (covers results with no test_id too).
  const repoMinutes = new Map<string, number>();
  for (const row of dailyRows) {
    if (!row.repositoryId) continue;
    repoMinutes.set(
      row.repositoryId,
      (repoMinutes.get(row.repositoryId) ?? 0) + Number(row.minutes),
    );
  }
  if (repoMinutes.size === 0) return empty;

  // Per-repo test lists (skip null test_id rows — deleted/API results).
  const repoTests = new Map<string, RunUsageAnalyticsTest[]>();
  for (const row of testRows) {
    if (!row.repositoryId || !row.testId) continue;
    const list = repoTests.get(row.repositoryId) ?? [];
    list.push({
      id: row.testId,
      name: row.testName ?? "(deleted test)",
      minutes: Number(row.minutes),
      runs: Number(row.runs),
    });
    repoTests.set(row.repositoryId, list);
  }

  const rankedRepos: RunUsageAnalyticsRepo[] = [...repoMinutes.entries()]
    .map(([id, minutes]) => {
      const tlist = (repoTests.get(id) ?? []).sort(
        (a, b) => b.minutes - a.minutes,
      );
      return {
        id,
        name: repoName.get(id) ?? id,
        minutes,
        testCount: tlist.length,
        tests: tlist,
      };
    })
    .sort((a, b) => b.minutes - a.minutes);

  // Collapse the tail into a single non-expandable "Other" bucket.
  const otherRepoIds = new Set<string>();
  let repos = rankedRepos;
  if (rankedRepos.length > RUN_ANALYTICS_TOP_REPOS + 1) {
    const top = rankedRepos.slice(0, RUN_ANALYTICS_TOP_REPOS);
    const rest = rankedRepos.slice(RUN_ANALYTICS_TOP_REPOS);
    rest.forEach((r) => otherRepoIds.add(r.id));
    repos = [
      ...top,
      {
        id: RUN_ANALYTICS_OTHER_ID,
        name: "Other",
        minutes: rest.reduce((s, r) => s + r.minutes, 0),
        testCount: rest.reduce((s, r) => s + r.testCount, 0),
        tests: [],
      },
    ];
  }

  // Zero-filled daily series, remapping tail repos into the "Other" bucket.
  const perDay = new Map<string, Record<string, number>>();
  for (const row of dailyRows) {
    if (!row.repositoryId) continue;
    const bucket = otherRepoIds.has(row.repositoryId)
      ? RUN_ANALYTICS_OTHER_ID
      : row.repositoryId;
    const inner = perDay.get(row.day) ?? {};
    inner[bucket] = (inner[bucket] ?? 0) + Number(row.minutes);
    perDay.set(row.day, inner);
  }

  return {
    days,
    rangeStart: utcDayKey(startDay),
    rangeEnd: utcDayKey(now),
    totalMinutes: repos.reduce((s, r) => s + r.minutes, 0),
    repos,
    series: buildDaySeries(startDay, days, (key) => perDay.get(key) ?? {}),
  };
}

export async function getOldestTestRunsForTeam(teamId: string, limit: number) {
  return db
    .select({
      id: testRuns.id,
      repositoryId: testRuns.repositoryId,
      startedAt: testRuns.startedAt,
    })
    .from(testRuns)
    .innerJoin(repositories, eq(testRuns.repositoryId, repositories.id))
    .where(eq(repositories.teamId, teamId))
    .orderBy(asc(testRuns.startedAt))
    .limit(limit);
}

export async function getTestResultFilePaths(testRunId: string) {
  const results = await db
    .select({
      screenshotPath: testResults.screenshotPath,
      screenshots: testResults.screenshots,
      videoPath: testResults.videoPath,
      diffPath: testResults.diffPath,
      networkBodiesPath: testResults.networkBodiesPath,
      id: testResults.id,
    })
    .from(testResults)
    .where(eq(testResults.testRunId, testRunId));

  const resultIds = results.map((r) => r.id);
  const paths: string[] = [];

  // Collect paths from test results
  for (const r of results) {
    if (r.screenshotPath) paths.push(r.screenshotPath);
    if (r.videoPath) paths.push(r.videoPath);
    if (r.diffPath) paths.push(r.diffPath);
    if (r.networkBodiesPath) paths.push(r.networkBodiesPath);
    if (r.screenshots) {
      for (const s of r.screenshots) {
        if (s.path) paths.push(s.path);
      }
    }
  }

  // Collect paths from visual diffs
  if (resultIds.length > 0) {
    const diffs = await db
      .select({
        baselineImagePath: visualDiffs.baselineImagePath,
        currentImagePath: visualDiffs.currentImagePath,
        diffImagePath: visualDiffs.diffImagePath,
        plannedImagePath: visualDiffs.plannedImagePath,
        plannedDiffImagePath: visualDiffs.plannedDiffImagePath,
        mainBaselineImagePath: visualDiffs.mainBaselineImagePath,
        mainDiffImagePath: visualDiffs.mainDiffImagePath,
      })
      .from(visualDiffs)
      .where(inArray(visualDiffs.testResultId, resultIds));

    for (const d of diffs) {
      if (d.baselineImagePath) paths.push(d.baselineImagePath);
      if (d.currentImagePath) paths.push(d.currentImagePath);
      if (d.diffImagePath) paths.push(d.diffImagePath);
      if (d.plannedImagePath) paths.push(d.plannedImagePath);
      if (d.plannedDiffImagePath) paths.push(d.plannedDiffImagePath);
      if (d.mainBaselineImagePath) paths.push(d.mainBaselineImagePath);
      if (d.mainDiffImagePath) paths.push(d.mainDiffImagePath);
    }
  }

  return paths;
}

export async function deleteTestRunAndResults(testRunId: string) {
  const paths = await getTestResultFilePaths(testRunId);

  // Get result IDs for cascading deletes
  const results = await db
    .select({ id: testResults.id })
    .from(testResults)
    .where(eq(testResults.testRunId, testRunId));

  const resultIds = results.map((r) => r.id);

  // Delete visual diffs first (FK to testResults)
  if (resultIds.length > 0) {
    await db
      .delete(visualDiffs)
      .where(inArray(visualDiffs.testResultId, resultIds));
  }

  // Delete test results
  await db.delete(testResults).where(eq(testResults.testRunId, testRunId));

  // Delete the test run
  await db.delete(testRuns).where(eq(testRuns.id, testRunId));

  return paths;
}
