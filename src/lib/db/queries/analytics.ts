import { db } from '../index';
import { githubIssues, pullRequests, repositories } from '../schema';
import { eq, and, gte, lte, isNotNull, sql } from 'drizzle-orm';

export async function getIssueTimeline(
  repositoryId: string,
  _dateRange?: { from: Date; to: Date },
) {
  const repo = db
    .select({ owner: repositories.owner, name: repositories.name })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .get();

  if (!repo) {
    console.log('[analytics] getIssueTimeline: repo not found for', repositoryId);
    return [];
  }

  // First check raw count
  const rawCount = db
    .select({ count: sql<number>`count(*)` })
    .from(githubIssues)
    .where(eq(githubIssues.repositoryId, repositoryId))
    .get();
  console.log('[analytics] getIssueTimeline: raw issue count for', repositoryId, '=', rawCount?.count);

  const results = db
    .select({
      week: sql<string>`strftime('%Y-%W', datetime(${githubIssues.createdAt}, 'unixepoch'))`.as('week'),
      count: sql<number>`count(*)`.as('count'),
      closedCount: sql<number>`sum(case when ${githubIssues.state} = 'closed' then 1 else 0 end)`.as('closed_count'),
    })
    .from(githubIssues)
    .where(eq(githubIssues.repositoryId, repositoryId))
    .groupBy(sql`strftime('%Y-%W', datetime(${githubIssues.createdAt}, 'unixepoch'))`)
    .orderBy(sql`week`)
    .all();

  console.log('[analytics] getIssueTimeline: got', results.length, 'weeks');
  return results;
}

export async function getMergedPRs(
  repositoryId: string,
  author?: string,
) {
  const repo = db
    .select({ owner: repositories.owner, name: repositories.name })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .get();

  if (!repo) return [];

  const conditions = [
    eq(pullRequests.repoOwner, repo.owner),
    eq(pullRequests.repoName, repo.name),
    isNotNull(pullRequests.mergedAt),
  ];

  if (author) {
    conditions.push(eq(pullRequests.author, author));
  }

  return db
    .select({
      id: pullRequests.id,
      title: pullRequests.title,
      author: pullRequests.author,
      mergedAt: pullRequests.mergedAt,
      githubPrNumber: pullRequests.githubPrNumber,
    })
    .from(pullRequests)
    .where(and(...conditions))
    .orderBy(pullRequests.mergedAt)
    .all();
}

export async function getPRAuthors(repositoryId: string) {
  const repo = db
    .select({ owner: repositories.owner, name: repositories.name })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .get();

  if (!repo) return [];

  return db
    .selectDistinct({ author: pullRequests.author })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.repoOwner, repo.owner),
        eq(pullRequests.repoName, repo.name),
        isNotNull(pullRequests.author),
      ),
    )
    .all()
    .map((r) => r.author!)
    .filter(Boolean);
}

export async function getImpactSummary(
  repositoryId: string,
  author?: string,
) {
  // Get earliest merged PR date as the "adoption" point
  const mergedPRs = await getMergedPRs(repositoryId, author);
  console.log('[analytics] getImpactSummary: mergedPRs count =', mergedPRs.length);
  if (mergedPRs.length === 0) {
    // No merged PRs — show total issues count
    const totalIssues = db
      .select({ count: sql<number>`count(*)` })
      .from(githubIssues)
      .where(eq(githubIssues.repositoryId, repositoryId))
      .get();

    console.log('[analytics] getImpactSummary: totalIssues =', totalIssues?.count);

    return {
      firstMergedAt: null,
      issuesBefore: totalIssues?.count ?? 0,
      issuesAfter: 0,
      percentChange: 0,
      totalMergedPRs: 0,
    };
  }

  const firstMergedAt = mergedPRs[0].mergedAt!;

  const issuesBefore = db
    .select({ count: sql<number>`count(*)` })
    .from(githubIssues)
    .where(
      and(
        eq(githubIssues.repositoryId, repositoryId),
        lte(githubIssues.createdAt, firstMergedAt),
      ),
    )
    .get();

  const issuesAfter = db
    .select({ count: sql<number>`count(*)` })
    .from(githubIssues)
    .where(
      and(
        eq(githubIssues.repositoryId, repositoryId),
        gte(githubIssues.createdAt, firstMergedAt),
      ),
    )
    .get();

  const before = issuesBefore?.count ?? 0;
  const after = issuesAfter?.count ?? 0;

  // Calculate weekly average rates for fair comparison
  const now = new Date();
  const firstMergedTime = firstMergedAt.getTime();

  // Get earliest issue to calculate "before" period
  const earliestIssue = db
    .select({ createdAt: githubIssues.createdAt })
    .from(githubIssues)
    .where(eq(githubIssues.repositoryId, repositoryId))
    .orderBy(githubIssues.createdAt)
    .limit(1)
    .get();

  const beforeWeeks = earliestIssue?.createdAt
    ? Math.max(1, (firstMergedTime - earliestIssue.createdAt.getTime()) / (7 * 24 * 60 * 60 * 1000))
    : 1;
  const afterWeeks = Math.max(1, (now.getTime() - firstMergedTime) / (7 * 24 * 60 * 60 * 1000));

  const beforeRate = before / beforeWeeks;
  const afterRate = after / afterWeeks;
  const percentChange = beforeRate > 0
    ? Math.round(((afterRate - beforeRate) / beforeRate) * 100)
    : 0;

  return {
    firstMergedAt,
    issuesBefore: before,
    issuesAfter: after,
    beforeRate: Math.round(beforeRate * 10) / 10,
    afterRate: Math.round(afterRate * 10) / 10,
    percentChange,
    totalMergedPRs: mergedPRs.length,
  };
}
