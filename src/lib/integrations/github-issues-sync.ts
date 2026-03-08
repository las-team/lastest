import { db } from '@/lib/db';
import { githubIssues, repositories } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

const SYNC_TTL_MS = 60 * 60 * 1000; // 1 hour

interface GitHubIssueResponse {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  user: { login: string } | null;
  created_at: string;
  closed_at: string | null;
  pull_request?: unknown; // Issues API also returns PRs — filter these out
}

export async function syncGithubIssues(
  repositoryId: string,
  accessToken: string,
  force = false,
): Promise<{ synced: number }> {
  // Check TTL — skip if recently synced
  if (!force) {
    const latest = db
      .select({ syncedAt: githubIssues.syncedAt })
      .from(githubIssues)
      .where(eq(githubIssues.repositoryId, repositoryId))
      .orderBy(githubIssues.syncedAt)
      .limit(1)
      .get();

    if (latest?.syncedAt && Date.now() - latest.syncedAt.getTime() < SYNC_TTL_MS) {
      return { synced: 0 };
    }
  }

  // Get repo owner/name
  const repo = db
    .select({ owner: repositories.owner, name: repositories.name })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .get();

  if (!repo) throw new Error('Repository not found');

  // Fetch all issues from GitHub (paginated) — not just bugs
  const allIssues: GitHubIssueResponse[] = [];
  let page = 1;
  const perPage = 100;

  console.log(`[github-issues-sync] Syncing issues for ${repo.owner}/${repo.name}...`);

  while (true) {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/issues?state=all&per_page=${perPage}&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[github-issues-sync] API error: ${response.status} ${response.statusText} - ${body.slice(0, 200)}`);
      break;
    }

    const issues: GitHubIssueResponse[] = await response.json();
    // Filter out pull requests (GitHub Issues API includes them)
    const realIssues = issues.filter((i) => !i.pull_request);
    allIssues.push(...realIssues);

    if (issues.length < perPage) break;
    page++;
  }

  console.log(`[github-issues-sync] Fetched ${allIssues.length} issues, upserting...`);

  // Upsert into DB
  const now = new Date();
  for (const issue of allIssues) {
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

  console.log(`[github-issues-sync] Done. Synced ${allIssues.length} issues for ${repo.owner}/${repo.name}`);
  return { synced: allIssues.length };
}
