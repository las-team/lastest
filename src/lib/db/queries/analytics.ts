import { db } from '../index';
import { githubIssues, pullRequests, repositories } from '../schema';
import { eq, and, gte, lt, isNotNull, sql } from 'drizzle-orm';

export async function getIssueTimeline(
  repositoryId: string,
) {
  const repo = db
    .select({ owner: repositories.owner, name: repositories.name })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .get();

  if (!repo) return [];

  return db
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
  const mergedPRs = await getMergedPRs(repositoryId, author);

  // Get all issues for this repo
  const totalResult = db
    .select({ count: sql<number>`count(*)` })
    .from(githubIssues)
    .where(eq(githubIssues.repositoryId, repositoryId))
    .get();
  const totalIssues = totalResult?.count ?? 0;

  if (mergedPRs.length === 0) {
    return {
      firstMergedAt: null as Date | null,
      lastMergedAt: null as Date | null,
      issuesBefore: totalIssues,
      issuesAfter: 0,
      beforeRate: 0,
      afterRate: 0,
      percentChange: 0,
      totalMergedPRs: 0,
      totalIssues,
    };
  }

  const firstMergedAt = mergedPRs[0].mergedAt!;
  const lastMergedAt = mergedPRs[mergedPRs.length - 1].mergedAt!;

  // "Before first merge" = issues created before first PR merge
  const beforeResult = db
    .select({ count: sql<number>`count(*)` })
    .from(githubIssues)
    .where(
      and(
        eq(githubIssues.repositoryId, repositoryId),
        lt(githubIssues.createdAt, firstMergedAt),
      ),
    )
    .get();

  // "After first merge" = issues created from first PR merge onward
  const afterResult = db
    .select({ count: sql<number>`count(*)` })
    .from(githubIssues)
    .where(
      and(
        eq(githubIssues.repositoryId, repositoryId),
        gte(githubIssues.createdAt, firstMergedAt),
      ),
    )
    .get();

  const before = beforeResult?.count ?? 0;
  const after = afterResult?.count ?? 0;

  // Calculate weekly rates for fair comparison
  const now = new Date();
  const firstMergedMs = firstMergedAt.getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  // "Before" period: from earliest issue to first merge
  const earliestIssue = db
    .select({ createdAt: githubIssues.createdAt })
    .from(githubIssues)
    .where(eq(githubIssues.repositoryId, repositoryId))
    .orderBy(githubIssues.createdAt)
    .limit(1)
    .get();

  const beforeMs = earliestIssue?.createdAt
    ? firstMergedMs - earliestIssue.createdAt.getTime()
    : 0;
  const afterMs = now.getTime() - firstMergedMs;

  const beforeWeeks = Math.max(1, beforeMs / weekMs);
  const afterWeeks = Math.max(1, afterMs / weekMs);

  const beforeRate = before / beforeWeeks;
  const afterRate = after / afterWeeks;

  // % change in weekly issue rate
  const percentChange = beforeRate > 0
    ? Math.round(((afterRate - beforeRate) / beforeRate) * 100)
    : 0;

  return {
    firstMergedAt,
    lastMergedAt,
    issuesBefore: before,
    issuesAfter: after,
    beforeRate: Math.round(beforeRate * 10) / 10,
    afterRate: Math.round(afterRate * 10) / 10,
    percentChange,
    totalMergedPRs: mergedPRs.length,
    totalIssues,
  };
}
