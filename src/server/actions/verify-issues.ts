'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { stepComparisons } from '@/lib/db/schema';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess, getCurrentSession } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import type { StepIssueState } from '@/lib/db/schema';
import { searchGitHubIssues, getGitHubIssueDetail, type GitHubIssueListItem, type GitHubIssueDetail } from '@/lib/integrations/github-issues';

interface CreateIssueInput {
  stepComparisonId: string;
  title?: string;
  body?: string;
  /** Whether the case is a regression (auto state) or manual link. */
  state?: 'auto' | 'open';
}

interface IssueResult {
  ok: boolean;
  issueUrl?: string;
  issueNumber?: number;
  state?: StepIssueState;
  error?: string;
}

/**
 * Create a GitHub issue for a verification case and store the link on the
 * step comparison row.
 */
export async function createIssueForCase(input: CreateIssueInput): Promise<IssueResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: 'Not authenticated' };

  const step = await getStep(input.stepComparisonId);
  if (!step) return { ok: false, error: 'Step not found' };

  const build = await queries.getBuild(step.buildId);
  if (!build) return { ok: false, error: 'Build not found' };
  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { ok: false, error: 'No repository on build' };
  await requireRepoAccess(repoId);

  const repo = await queries.getRepository(repoId);
  if (!repo || repo.provider !== 'github') {
    return { ok: false, error: 'Repository is not a GitHub repository' };
  }
  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account?.accessToken) return { ok: false, error: 'GitHub not connected for this team' };

  const test = await queries.getTest(step.testId);
  const title = input.title ?? `[Verify] ${test?.name ?? 'case'} — ${step.stepLabel ?? 'step'}`;
  const body = input.body ?? buildIssueBody({
    reviewerNote: step.reviewerNote ?? null,
    branch: testRun?.gitBranch ?? null,
    commit: testRun?.gitCommit ?? null,
    buildId: build.id,
    testName: test?.name ?? null,
    stepLabel: step.stepLabel ?? null,
    verdict: step.verdict,
    evidence: step.evidence ?? [],
  });

  const labels = ['verify', step.verdict === 'red' ? 'regression' : 'verification'];

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ title, body, labels }),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `GitHub API ${response.status}: ${text.slice(0, 200)}` };
    }
    const issue = (await response.json()) as { html_url: string; number: number };
    const state: StepIssueState = input.state ?? 'auto';
    await db
      .update(stepComparisons)
      .set({ githubIssueUrl: issue.html_url, githubIssueNumber: issue.number, githubIssueState: state })
      .where(eq(stepComparisons.id, input.stepComparisonId));
    revalidatePath(`/verify/${step.buildId}`);
    return { ok: true, issueUrl: issue.html_url, issueNumber: issue.number, state };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

interface LinkIssueInput {
  stepComparisonId: string;
  /** GitHub issue URL like https://github.com/owner/repo/issues/123 */
  issueUrl: string;
}

export async function linkIssueToCase(input: LinkIssueInput): Promise<IssueResult> {
  const step = await getStep(input.stepComparisonId);
  if (!step) return { ok: false, error: 'Step not found' };

  const build = await queries.getBuild(step.buildId);
  const testRun = build?.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { ok: false, error: 'No repository on build' };
  await requireRepoAccess(repoId);

  const match = input.issueUrl.match(/\/issues\/(\d+)(?:[/?#]|$)/);
  if (!match) return { ok: false, error: 'Could not parse issue number from URL' };
  const issueNumber = parseInt(match[1], 10);

  await db
    .update(stepComparisons)
    .set({ githubIssueUrl: input.issueUrl, githubIssueNumber: issueNumber, githubIssueState: 'linked' })
    .where(eq(stepComparisons.id, input.stepComparisonId));
  revalidatePath(`/verify/${step.buildId}`);
  return { ok: true, issueUrl: input.issueUrl, issueNumber, state: 'linked' };
}

export async function closeIssueForCase(stepComparisonId: string): Promise<IssueResult> {
  const step = await getStep(stepComparisonId);
  if (!step?.githubIssueNumber) return { ok: false, error: 'No issue linked' };

  const build = await queries.getBuild(step.buildId);
  const testRun = build?.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { ok: false, error: 'No repository on build' };
  await requireRepoAccess(repoId);
  const repo = await queries.getRepository(repoId);
  if (!repo) return { ok: false, error: 'Repository not found' };
  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account?.accessToken) return { ok: false, error: 'GitHub not connected for this team' };

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/issues/${step.githubIssueNumber}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state: 'closed' }),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `GitHub API ${response.status}: ${text.slice(0, 200)}` };
    }
    await db
      .update(stepComparisons)
      .set({ githubIssueState: 'closed' })
      .where(eq(stepComparisons.id, stepComparisonId));
    revalidatePath(`/verify/${step.buildId}`);
    return { ok: true, state: 'closed' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

async function getStep(stepComparisonId: string) {
  const [row] = await db
    .select()
    .from(stepComparisons)
    .where(eq(stepComparisons.id, stepComparisonId));
  return row;
}

interface IssueBodyInput {
  reviewerNote: string | null;
  branch: string | null;
  commit: string | null;
  buildId: string;
  testName: string | null;
  stepLabel: string | null;
  verdict: string;
  evidence: Array<{ layer: string; signal: string; summary: string }>;
}

function buildIssueBody(input: IssueBodyInput): string {
  const lines: string[] = [];
  // Reviewer's note leads — that's the human framing of what's wrong.
  if (input.reviewerNote && input.reviewerNote.trim().length > 0) {
    lines.push(input.reviewerNote.trim(), '', '---', '');
  }
  lines.push(
    `**Branch:** \`${input.branch ?? 'unknown'}\`${input.commit ? ` @ \`${input.commit.slice(0, 7)}\`` : ''}`,
    `**Build:** \`${input.buildId.slice(0, 8)}\``,
    `**Test:** ${input.testName ?? 'unknown'}`,
    `**Step:** ${input.stepLabel ?? 'unspecified'}`,
    `**Verdict:** \`${input.verdict}\``,
    '',
    '## Evidence',
    '',
  );
  for (const e of input.evidence) {
    lines.push(`- **${e.layer}** (${e.signal}): ${e.summary}`);
  }
  lines.push('', '_Filed automatically by Lastest Verify_');
  return lines.join('\n');
}

/**
 * Search the case's repo for existing GitHub issues. Used by the Browse tab
 * of the issue picker dialog. Returns a slim list — no body, just titles +
 * state + labels — for fast rendering.
 */
export async function searchIssuesForCase(
  stepComparisonId: string,
  query?: string,
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<{ ok: boolean; issues?: GitHubIssueListItem[]; error?: string }> {
  const step = await getStep(stepComparisonId);
  if (!step) return { ok: false, error: 'Step not found' };
  const build = await queries.getBuild(step.buildId);
  const testRun = build?.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { ok: false, error: 'No repository on build' };
  await requireRepoAccess(repoId);
  const repo = await queries.getRepository(repoId);
  if (!repo || repo.provider !== 'github') return { ok: false, error: 'Not a GitHub repository' };
  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account?.accessToken) return { ok: false, error: 'GitHub not connected for this team' };
  const result = await searchGitHubIssues(account.accessToken, repo.owner, repo.name, query, state);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, issues: result.issues };
}

/**
 * Fetch the full title + body + state for the GitHub issue currently linked
 * to this case. Returns null if no issue is linked. Used by the verify
 * IntentPanel to render the issue description inline so reviewers don't have
 * to round-trip to GitHub for context.
 */
export async function fetchLinkedIssueForCase(
  stepComparisonId: string,
): Promise<{ ok: boolean; issue?: GitHubIssueDetail | null; error?: string }> {
  const step = await getStep(stepComparisonId);
  if (!step) return { ok: false, error: 'Step not found' };
  if (!step.githubIssueNumber) return { ok: true, issue: null };
  const build = await queries.getBuild(step.buildId);
  const testRun = build?.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { ok: false, error: 'No repository on build' };
  await requireRepoAccess(repoId);
  const repo = await queries.getRepository(repoId);
  if (!repo || repo.provider !== 'github') return { ok: false, error: 'Not a GitHub repository' };
  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account?.accessToken) return { ok: false, error: 'GitHub not connected for this team' };
  const result = await getGitHubIssueDetail(account.accessToken, repo.owner, repo.name, step.githubIssueNumber);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, issue: result.issue ?? null };
}

/**
 * Save a reviewer note on a step comparison. Surfaces as the lead paragraph
 * of any issue subsequently created from this case.
 */
export async function setReviewerNote(stepComparisonId: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const step = await getStep(stepComparisonId);
  if (!step) return { ok: false, error: 'Step not found' };
  const build = await queries.getBuild(step.buildId);
  if (!build) return { ok: false, error: 'Build not found' };
  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (repoId) await requireRepoAccess(repoId);
  await db
    .update(stepComparisons)
    .set({ reviewerNote: note.trim().length === 0 ? null : note })
    .where(eq(stepComparisons.id, stepComparisonId));
  // No revalidatePath — typing a note shouldn't trigger a server re-render
  // mid-keystroke; the client owns the optimistic state.
  return { ok: true };
}
