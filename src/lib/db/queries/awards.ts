import { and, desc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../index";
import { builds, repositories, tests, testRuns, visualDiffs } from "../schema";

/**
 * Core's fill for `AwardsHost` (`src/lib/core/awards-host.ts`) reads these.
 *
 * The `awards` feature itself — its own table, its tier/category math, its
 * public page and badge endpoint — moved to `@lastest/plugin-awards` (RFC §9
 * phase 4, ninth plugin). What is left here is exactly what a plugin may not
 * do itself under `core-scope.md` §6: read core's `builds`/`tests`/
 * `visualDiffs` tables directly. Same shape as `src/lib/github` after `ci`
 * split off, or `src/lib/db/queries/repositories.ts` for any other plugin's
 * repo lookups — a query module that stayed in `CORE_SRC_PATHS` because its
 * only remaining job is serving a host port.
 */

export interface AwardsRepoBuildRow {
  id: string;
  totalTests: number | null;
  passedCount: number | null;
  failedCount: number | null;
  changesDetected: number | null;
  flakyCount: number | null;
  a11yScore: number | null;
  a11yCriticalCount: number | null;
  completedAt: Date | null;
}

/**
 * Read the last N completed builds for a repository. Walks builds -> testRuns
 * (testRuns owns repositoryId). Newest first.
 */
export async function getRecentCompletedBuildsForRepo(
  repositoryId: string,
  limit: number,
): Promise<AwardsRepoBuildRow[]> {
  const rows = await db
    .select({
      id: builds.id,
      totalTests: builds.totalTests,
      passedCount: builds.passedCount,
      failedCount: builds.failedCount,
      changesDetected: builds.changesDetected,
      flakyCount: builds.flakyCount,
      a11yScore: builds.a11yScore,
      a11yCriticalCount: builds.a11yCriticalCount,
      completedAt: builds.completedAt,
    })
    .from(builds)
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(
      and(
        eq(testRuns.repositoryId, repositoryId),
        isNotNull(builds.completedAt),
      ),
    )
    .orderBy(desc(builds.completedAt))
    .limit(limit);
  return rows;
}

export async function getRepoTestCount(repositoryId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(tests)
    .where(and(eq(tests.repositoryId, repositoryId), isNull(tests.deletedAt)));
  return Number(row?.count ?? 0);
}

/**
 * Count of `visualDiffs.status === 'rejected'` on the repo's build history.
 * `sinceMs` omitted means "ever"; provided means "since this time, matching
 * either `approvedAt` or `createdAt`".
 */
export async function getRejectedDiffCount(
  repositoryId: string,
  sinceMs?: number,
): Promise<number> {
  const since = sinceMs !== undefined ? new Date(sinceMs) : null;
  const [row] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(visualDiffs)
    .innerJoin(builds, eq(visualDiffs.buildId, builds.id))
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(
      and(
        eq(testRuns.repositoryId, repositoryId),
        eq(visualDiffs.status, "rejected"),
        since
          ? or(
              gte(visualDiffs.approvedAt, since),
              gte(visualDiffs.createdAt, since),
            )
          : undefined,
      ),
    );
  return Number(row?.c ?? 0);
}

/**
 * Every repo owned by a team that has at least one non-deleted test —
 * `repositories ⋈ tests` with `HAVING COUNT(tests.id) > 0`. That `HAVING` is
 * an existence predicate, not just a column source (recipe §3.2): repos with
 * zero tests are excluded so the plugin's trophy room doesn't fill with
 * locked rows for placeholder repos.
 */
export async function listReposWithTestsForTeam(teamId: string): Promise<
  Array<{
    id: string;
    fullName: string;
    owner: string;
    name: string;
    testCount: number;
  }>
> {
  return db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      owner: repositories.owner,
      name: repositories.name,
      testCount: sql<number>`COUNT(${tests.id})::int`,
    })
    .from(repositories)
    .innerJoin(tests, eq(tests.repositoryId, repositories.id))
    .where(and(eq(repositories.teamId, teamId), isNull(tests.deletedAt)))
    .groupBy(
      repositories.id,
      repositories.fullName,
      repositories.owner,
      repositories.name,
      repositories.createdAt,
    )
    .having(sql`COUNT(${tests.id}) > 0`)
    .orderBy(desc(repositories.createdAt));
}
