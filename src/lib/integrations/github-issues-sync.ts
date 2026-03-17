import { db } from '@/lib/db';
import { githubIssues, pullRequests, repositories } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const SYNC_TTL_MS = 60 * 60 * 1000; // 1 hour

interface GitHubIssueResponse {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  user: { login: string } | null;
  created_at: string;
  closed_at: string | null;
  pull_request?: unknown;
}

interface GitHubPRResponse {
  number: number;
  title: string;
  state: string;
  merged_at: string | null;
  created_at: string;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
}

async function fetchGitHubPaginated<T>(
  url: string,
  accessToken: string,
  perPage = 100,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;

  while (true) {
    const sep = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${sep}per_page=${perPage}&page=${page}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[github-sync] API error: ${response.status} ${response.statusText} - ${body.slice(0, 200)}`);
      break;
    }

    const items: T[] = await response.json();
    all.push(...items);
    if (items.length < perPage) break;
    page++;
  }

  return all;
}

export async function syncGithubIssues(
  repositoryId: string,
  accessToken: string,
  force = false,
): Promise<{ syncedIssues: number; syncedPRs: number }> {
  // Check TTL
  if (!force) {
    const latest = db
      .select({ syncedAt: githubIssues.syncedAt })
      .from(githubIssues)
      .where(eq(githubIssues.repositoryId, repositoryId))
      .orderBy(githubIssues.syncedAt)
      .limit(1)
      .get();

    if (latest?.syncedAt && Date.now() - latest.syncedAt.getTime() < SYNC_TTL_MS) {
      return { syncedIssues: 0, syncedPRs: 0 };
    }
  }

  const repo = db
    .select({ owner: repositories.owner, name: repositories.name })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .get();

  if (!repo) throw new Error('Repository not found');

  const baseUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}`;
  console.log(`[github-sync] Syncing issues + PRs for ${repo.owner}/${repo.name}...`);

  // Fetch issues and PRs in parallel
  const [allIssues, allPRs] = await Promise.all([
    fetchGitHubPaginated<GitHubIssueResponse>(`${baseUrl}/issues?state=all`, accessToken),
    fetchGitHubPaginated<GitHubPRResponse>(`${baseUrl}/pulls?state=all`, accessToken),
  ]);

  // Filter out PRs from issues endpoint
  const realIssues = allIssues.filter((i) => !i.pull_request);
  console.log(`[github-sync] Fetched ${realIssues.length} issues, ${allPRs.length} PRs`);

  // Upsert issues
  const now = new Date();
  for (const issue of realIssues) {
    const existing = db
      .select({ id: githubIssues.id })
      .from(githubIssues)
      .where(
        and(
          eq(githubIssues.repositoryId, repositoryId),
          eq(githubIssues.githubIssueNumber, issue.number),
        ),
      )
      .get();

    const values = {
      repositoryId,
      githubIssueNumber: issue.number,
      title: issue.title,
      state: issue.state,
      labels: issue.labels.map((l) => l.name),
      author: issue.user?.login ?? null,
      createdAt: new Date(issue.created_at),
      closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
      syncedAt: now,
    };

    if (existing) {
      await db.update(githubIssues).set(values).where(eq(githubIssues.id, existing.id));
    } else {
      await db.insert(githubIssues).values(values);
    }
  }

  // Upsert PRs — match by PR number + repo owner/name
  let syncedPRs = 0;
  for (const pr of allPRs) {
    const existing = db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.repoOwner, repo.owner),
          eq(pullRequests.repoName, repo.name),
          eq(pullRequests.githubPrNumber, pr.number),
        ),
      )
      .get();

    const status = pr.merged_at ? 'merged' : pr.state;

    if (existing) {
      // Update with author + mergedAt if missing
      await db.update(pullRequests).set({
        title: pr.title,
        status,
        author: pr.user?.login ?? null,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        headCommit: pr.head.sha,
        updatedAt: now,
      }).where(eq(pullRequests.id, existing.id));
    } else {
      // Create new PR record from API data
      await db.insert(pullRequests).values({
        id: uuid(),
        provider: 'github',
        githubPrNumber: pr.number,
        repoOwner: repo.owner,
        repoName: repo.name,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        headCommit: pr.head.sha,
        title: pr.title,
        status,
        author: pr.user?.login ?? null,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        createdAt: new Date(pr.created_at),
        updatedAt: now,
      });
    }
    syncedPRs++;
  }

  console.log(`[github-sync] Done. Synced ${realIssues.length} issues, ${syncedPRs} PRs for ${repo.owner}/${repo.name}`);
  return { syncedIssues: realIssues.length, syncedPRs };
}
