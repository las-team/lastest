import { and, desc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../index";
import {
  builds,
  publicShares,
  repoAwards,
  repositories,
  tests,
  testRuns,
  visualDiffs,
} from "../schema";
import type { NewRepoAward, RepoAward } from "../schema";

export async function getRepoAward(
  repositoryId: string,
): Promise<RepoAward | undefined> {
  const [row] = await db
    .select()
    .from(repoAwards)
    .where(eq(repoAwards.repositoryId, repositoryId));
  return row;
}

export async function upsertRepoAward(data: NewRepoAward): Promise<RepoAward> {
  await db
    .insert(repoAwards)
    .values(data)
    .onConflictDoUpdate({
      target: repoAwards.repositoryId,
      set: {
        currentTier: data.currentTier,
        highestTier: data.highestTier,
        categories: data.categories,
        proofShareSlug: data.proofShareSlug ?? null,
        lastBuildId: data.lastBuildId ?? null,
        earnedAt: data.earnedAt ?? new Date(),
        lastRecomputedAt: new Date(),
        lastDowngradeAt: data.lastDowngradeAt ?? null,
        lastDowngradeReason: data.lastDowngradeReason ?? null,
      },
    });
  const [row] = await db
    .select()
    .from(repoAwards)
    .where(eq(repoAwards.repositoryId, data.repositoryId));
  return row;
}

/**
 * Resolve a public share slug to its repo award. The badge SVG endpoint uses
 * this — embed URL stays stable, repo state stays live.
 */
export async function getRepoAwardBySlug(slug: string): Promise<{
  share: {
    slug: string;
    targetDomain: string | null;
    repositoryId: string | null;
  };
  repo: { id: string; fullName: string; owner: string; name: string } | null;
  award: RepoAward | null;
} | null> {
  const [shareRow] = await db
    .select({
      slug: publicShares.slug,
      targetDomain: publicShares.targetDomain,
      repositoryId: publicShares.repositoryId,
    })
    .from(publicShares)
    .where(eq(publicShares.slug, slug));
  if (!shareRow) return null;

  const repoId = shareRow.repositoryId;

  let repo: {
    id: string;
    fullName: string;
    owner: string;
    name: string;
  } | null = null;
  if (repoId) {
    const [r] = await db
      .select({
        id: repositories.id,
        fullName: repositories.fullName,
        owner: repositories.owner,
        name: repositories.name,
      })
      .from(repositories)
      .where(eq(repositories.id, repoId));
    repo = r ?? null;
  }

  let award: RepoAward | null = null;
  if (repoId) {
    const [a] = await db
      .select()
      .from(repoAwards)
      .where(eq(repoAwards.repositoryId, repoId));
    award = a ?? null;
  }

  return {
    share: {
      slug: shareRow.slug,
      targetDomain: shareRow.targetDomain,
      repositoryId: repoId,
    },
    repo,
    award,
  };
}

/**
 * Read the last N completed builds for a repository. Walks builds -> testRuns
 * (testRuns owns repositoryId). Newest first.
 */
export interface RepoBuildRow {
  id: string;
  total_tests: number | null;
  passed_count: number | null;
  failed_count: number | null;
  changes_detected: number | null;
  flaky_count: number | null;
  a11y_score: number | null;
  a11y_critical_count: number | null;
  completed_at: Date | null;
}

export async function getRecentCompletedBuildsForRepo(
  repositoryId: string,
  limit: number,
): Promise<RepoBuildRow[]> {
  const rows = await db
    .select({
      id: builds.id,
      total_tests: builds.totalTests,
      passed_count: builds.passedCount,
      failed_count: builds.failedCount,
      changes_detected: builds.changesDetected,
      flaky_count: builds.flakyCount,
      a11y_score: builds.a11yScore,
      a11y_critical_count: builds.a11yCriticalCount,
      completed_at: builds.completedAt,
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
 * Total rejected visual diffs across the repo's build history (any time).
 * Used to detect any confirmed regression ever.
 */
export async function getRejectedDiffCountForRepo(
  repositoryId: string,
): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(visualDiffs)
    .innerJoin(builds, eq(visualDiffs.buildId, builds.id))
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(
      and(
        eq(testRuns.repositoryId, repositoryId),
        eq(visualDiffs.status, "rejected"),
      ),
    );
  return Number(row?.c ?? 0);
}

export async function getRejectedDiffCountForRepoSince(
  repositoryId: string,
  sinceMs: number,
): Promise<number> {
  const since = new Date(sinceMs);
  const [row] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(visualDiffs)
    .innerJoin(builds, eq(visualDiffs.buildId, builds.id))
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(
      and(
        eq(testRuns.repositoryId, repositoryId),
        eq(visualDiffs.status, "rejected"),
        or(
          gte(visualDiffs.approvedAt, since),
          gte(visualDiffs.createdAt, since),
        ),
      ),
    );
  return Number(row?.c ?? 0);
}

/**
 * Most recent public share slug for a repo. Used as the proof link on the badge.
 */
/**
 * Award + repo summary for every repository owned by a team.
 * Repos with no award row yet are returned with award=null so the UI can
 * grey them out as "not yet earned".
 */
export async function getTeamTrophyRoom(teamId: string): Promise<
  Array<{
    repo: {
      id: string;
      fullName: string;
      owner: string;
      name: string;
      testCount: number;
    };
    award: RepoAward | null;
    proofSlug: string | null;
  }>
> {
  // Only include repos that have at least one non-deleted test, so empty/
  // placeholder repos don't fill the trophy room with locked rows.
  const repos = await db
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

  if (repos.length === 0) return [];

  const repoIds = repos.map((r) => r.id);
  const awards = await db
    .select()
    .from(repoAwards)
    .where(
      sql`${repoAwards.repositoryId} IN (${sql.join(
        repoIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  const awardByRepo = new Map(awards.map((a) => [a.repositoryId, a]));

  // Latest public share slug per repo, used as the proof link.
  const shares = await db
    .select({
      repositoryId: publicShares.repositoryId,
      slug: publicShares.slug,
      createdAt: publicShares.createdAt,
    })
    .from(publicShares)
    .where(
      sql`${publicShares.repositoryId} IN (${sql.join(
        repoIds.map((id) => sql`${id}`),
        sql`, `,
      )}) AND ${publicShares.status} = 'public'`,
    )
    .orderBy(desc(publicShares.createdAt));
  const slugByRepo = new Map<string, string>();
  for (const s of shares) {
    if (s.repositoryId && !slugByRepo.has(s.repositoryId)) {
      slugByRepo.set(s.repositoryId, s.slug);
    }
  }

  return repos.map((repo) => ({
    repo,
    award: awardByRepo.get(repo.id) ?? null,
    proofSlug: slugByRepo.get(repo.id) ?? null,
  }));
}

export async function getLatestProofShareSlug(
  repositoryId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ slug: publicShares.slug })
    .from(publicShares)
    .where(
      and(
        eq(publicShares.repositoryId, repositoryId),
        eq(publicShares.status, "public"),
      ),
    )
    .orderBy(desc(publicShares.createdAt))
    .limit(1);
  return row?.slug ?? null;
}
